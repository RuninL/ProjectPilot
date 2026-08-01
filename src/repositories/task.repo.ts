import { taskRowSchema, taskWithProjectRowSchema } from '@/db/schemas';
import type { BatchStatement } from '@/lib/commands';
import type { SqlExecutor } from '@/lib/db';
import type { Task, TaskPriority, TaskStatus, TaskWithProject } from '@/types';
import {
  buildUpdate,
  composeWhere,
  inClause,
  likeParam,
  parseOptional,
  parseRows,
  runUpdate,
  type SqlFragment,
} from './_shared';

const UPDATABLE = [
  'parent_task_id',
  'title',
  'description',
  'status',
  'priority',
  'start_date',
  'due_date',
  'progress',
  'estimated_hours',
  'actual_hours',
  'completed_at',
  'archived_at',
  'archived_source',
  'source_meeting_id',
  'source_rule_id',
  'source_occurrence_date',
] as const;

const INSERT_COLUMNS = `(id, project_id, parent_task_id, title, description, status, priority,
     start_date, due_date, progress, estimated_hours, actual_hours,
     completed_at, archived_at, archived_source, source_meeting_id, source_rule_id,
     source_occurrence_date, is_sample, created_at, updated_at)`;

const INSERT_SQL = `INSERT INTO tasks ${INSERT_COLUMNS}
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Same insert, but it inserts nothing unless the source action item is still
 * unconverted. This is what makes a duplicate conversion orphan-free rather than
 * merely detectable: the guard is evaluated inside the same transaction as the
 * matching `action_items` update, so a second concurrent attempt writes zero rows
 * instead of committing a task nobody points at. Checking an affected-row count
 * after the fact could not achieve this — by then the batch has committed.
 */
const CONVERSION_INSERT_SQL = `INSERT INTO tasks ${INSERT_COLUMNS}
   SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM action_items WHERE id = ? AND converted_at IS NULL)`;

function insertParams(task: Task): unknown[] {
  return [
    task.id,
    task.project_id,
    task.parent_task_id,
    task.title,
    task.description,
    task.status,
    task.priority,
    task.start_date,
    task.due_date,
    task.progress,
    task.estimated_hours,
    task.actual_hours,
    task.completed_at,
    task.archived_at,
    task.archived_source,
    task.source_meeting_id,
    task.source_rule_id,
    task.source_occurrence_date,
    task.is_sample,
    task.created_at,
    task.updated_at,
  ];
}

export type TaskSort = 'due_date' | 'priority' | 'created_at' | 'title';

/**
 * Three task views:
 *  - active:   not archived AND the owning project is not archived;
 *  - archived: archived (manually or by a project archive);
 *  - all:      every task.
 */
export type TaskScope = 'active' | 'archived' | 'all';

export interface TaskQuery {
  projectIds?: readonly string[];
  statuses?: readonly TaskStatus[];
  priorities?: readonly TaskPriority[];
  search?: string;
  dueFrom?: string;
  dueTo?: string;
  /** Archived tasks are hidden everywhere unless explicitly requested. */
  includeArchived?: boolean;
  /** Overrides `includeArchived` when present. */
  scope?: TaskScope;
  sort?: TaskSort;
  participantIds?: readonly string[];
}

// Fixed whitelist: callers choose a key, never the ORDER BY text.
// `due_date IS NULL` first keeps undated tasks at the end — SQLite sorts NULL first.
const TASK_ORDER_BY: Record<TaskSort, string> = {
  due_date: 't.due_date IS NULL, t.due_date ASC, t.created_at ASC',
  priority:
    "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END," +
    ' t.due_date IS NULL, t.due_date ASC',
  created_at: 't.created_at DESC',
  title: 't.title ASC',
};

function taskConditions(query: TaskQuery): SqlFragment[] {
  const search = query.search?.trim() ?? '';
  const scopeCondition = (): SqlFragment => {
    if (query.scope === 'active') {
      // Excludes archived tasks AND live tasks whose project is archived.
      return { sql: 't.archived_at IS NULL AND p.archived_at IS NULL', params: [] };
    }
    if (query.scope === 'archived') {
      return { sql: 't.archived_at IS NOT NULL', params: [] };
    }
    if (query.scope === 'all' || query.includeArchived === true) {
      return { sql: '', params: [] };
    }
    return { sql: 't.archived_at IS NULL', params: [] };
  };
  return [
    scopeCondition(),
    inClause('t.project_id', query.projectIds ?? []),
    inClause('t.status', query.statuses ?? []),
    inClause('t.priority', query.priorities ?? []),
    query.dueFrom === undefined
      ? { sql: '', params: [] }
      : { sql: 't.due_date IS NOT NULL AND t.due_date >= ?', params: [query.dueFrom] },
    query.dueTo === undefined
      ? { sql: '', params: [] }
      : { sql: 't.due_date IS NOT NULL AND t.due_date <= ?', params: [query.dueTo] },
    search === ''
      ? { sql: '', params: [] }
      : {
          sql: "(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')",
          params: [likeParam(search), likeParam(search)],
        },
    query.participantIds === undefined || query.participantIds.length === 0
      ? { sql: '', params: [] }
      : {
          sql: `EXISTS (
            SELECT 1 FROM task_participants participant_filter
             WHERE participant_filter.task_id = t.id
               AND participant_filter.person_id IN (${query.participantIds.map(() => '?').join(', ')})
          )`,
          params: [...query.participantIds],
        },
  ];
}

export function createTaskRepository(db: SqlExecutor) {
  return {
    async findByProject(projectId: string): Promise<Task[]> {
      const rows = await db.select(
        'SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC',
        [projectId],
      );
      return parseRows(taskRowSchema, rows);
    },

    /** Non-archived tasks of a project used for the completion rate. */
    async findActiveByProject(projectId: string): Promise<Task[]> {
      const rows = await db.select(
        'SELECT * FROM tasks WHERE project_id = ? AND archived_at IS NULL ORDER BY created_at ASC',
        [projectId],
      );
      return parseRows(taskRowSchema, rows);
    },

    async findChildren(parentTaskId: string): Promise<Task[]> {
      const rows = await db.select(
        'SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at ASC',
        [parentTaskId],
      );
      return parseRows(taskRowSchema, rows);
    },

    /** Direct child count, including archived children — used to block deletion. */
    async countChildren(parentTaskId: string): Promise<number> {
      const rows = await db.select('SELECT COUNT(*) AS n FROM tasks WHERE parent_task_id = ?', [
        parentTaskId,
      ]);
      return readCount(rows);
    },

    async countByProject(projectId: string): Promise<number> {
      const rows = await db.select('SELECT COUNT(*) AS n FROM tasks WHERE project_id = ?', [
        projectId,
      ]);
      return readCount(rows);
    },

    async findById(id: string): Promise<Task | null> {
      const rows = await db.select('SELECT * FROM tasks WHERE id = ?', [id]);
      return parseOptional(taskRowSchema, rows);
    },

    async findByIds(ids: readonly string[]): Promise<Task[]> {
      if (ids.length === 0) return [];
      const rows = await db.select(
        `SELECT * FROM tasks WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY id ASC`,
        [...ids],
      );
      return parseRows(taskRowSchema, rows);
    },

    /** Cross-project task list joined with the project name/color for display. */
    async findByQuery(query: TaskQuery = {}): Promise<TaskWithProject[]> {
      const where = composeWhere(taskConditions(query));
      const orderBy = TASK_ORDER_BY[query.sort ?? 'due_date'];
      const rows = await db.select(
        `SELECT t.*, p.name AS project_name, p.color AS project_color, p.status AS project_status
           FROM tasks t
           JOIN projects p ON p.id = t.project_id${where.sql}
          ORDER BY ${orderBy}`,
        where.params,
      );
      return parseRows(taskWithProjectRowSchema, rows);
    },

    /**
     * Open tasks relevant to the desktop companion's business day: overdue,
     * due today, starting today, or spanning today. Kept as one scoped query
     * so opening the small window never scans the entire task table.
     */
    async findForCompanionToday(date: string): Promise<TaskWithProject[]> {
      const rows = await db.select(
        `SELECT t.*, p.name AS project_name, p.color AS project_color, p.status AS project_status
           FROM tasks t
           JOIN projects p ON p.id = t.project_id
          WHERE t.archived_at IS NULL
            AND t.status NOT IN ('done', 'cancelled')
            AND (
              (t.due_date IS NOT NULL AND t.due_date <= ?)
              OR t.start_date = ?
              OR (
                t.start_date IS NOT NULL
                AND t.due_date IS NOT NULL
                AND t.start_date <= ?
                AND t.due_date >= ?
              )
            )
          ORDER BY
            CASE WHEN t.due_date < ? THEN 0 ELSE 1 END,
            t.due_date IS NULL,
            t.due_date ASC,
            t.start_date ASC,
            t.created_at ASC`,
        [date, date, date, date, date],
      );
      return parseRows(taskWithProjectRowSchema, rows);
    },

    /** Tasks whose date interval intersects `[from, to]`, for the calendar. */
    async findInDateRange(from: string, to: string): Promise<TaskWithProject[]> {
      const rows = await db.select(
        `SELECT t.*, p.name AS project_name, p.color AS project_color, p.status AS project_status
           FROM tasks t
           JOIN projects p ON p.id = t.project_id
          WHERE t.archived_at IS NULL
            AND (
              (t.start_date IS NOT NULL AND t.due_date IS NOT NULL
                AND t.start_date <= ? AND t.due_date >= ?)
              OR (t.start_date IS NOT NULL AND t.start_date BETWEEN ? AND ?)
              OR (t.due_date IS NOT NULL AND t.due_date BETWEEN ? AND ?)
              OR (t.start_date IS NOT NULL AND t.due_date IS NULL
                AND t.start_date BETWEEN ? AND ?)
              OR (t.start_date IS NULL AND t.due_date IS NOT NULL
                AND t.due_date BETWEEN ? AND ?)
            )
          ORDER BY t.due_date IS NULL, t.due_date ASC, t.created_at ASC`,
        [to, from, from, to, from, to, from, to, from, to],
      );
      return parseRows(taskWithProjectRowSchema, rows);
    },

    /** Non-archived tasks without either date, displayed in Calendar's unscheduled section. */
    async findUndated(): Promise<TaskWithProject[]> {
      const rows = await db.select(
        `SELECT t.*, p.name AS project_name, p.color AS project_color, p.status AS project_status
          FROM tasks t
          JOIN projects p ON p.id = t.project_id
          WHERE t.archived_at IS NULL
           AND t.start_date IS NULL
           AND t.due_date IS NULL
          ORDER BY t.created_at ASC`,
      );
      return parseRows(taskWithProjectRowSchema, rows);
    },

    async insert(task: Task): Promise<void> {
      await db.execute(INSERT_SQL, insertParams(task));
    },

    /** Same insert, as a statement for an atomic multi-row batch. */
    buildInsert(task: Task): BatchStatement {
      return { sql: INSERT_SQL, params: insertParams(task) };
    },

    /** Insert conditional on `actionItemId` still being unconverted. */
    buildInsertForConversion(task: Task, actionItemId: string): BatchStatement {
      return { sql: CONVERSION_INSERT_SQL, params: [...insertParams(task), actionItemId] };
    },

    async update(id: string, patch: Partial<Task>, now: string): Promise<number> {
      return runUpdate(db, buildUpdate('tasks', UPDATABLE, patch, id, now));
    },

    /** Same update, as a statement so a bulk edit is one transaction. */
    buildUpdateStatement(id: string, patch: Partial<Task>, now: string): BatchStatement | null {
      return buildUpdate('tasks', UPDATABLE, patch, id, now);
    },

    /** Archive every live task of a project — the cascade of a project archive. */
    buildArchiveProjectTasks(projectId: string, now: string): BatchStatement {
      return {
        sql: `UPDATE tasks
                 SET archived_at = ?, archived_source = 'project', updated_at = ?
               WHERE project_id = ? AND archived_at IS NULL`,
        params: [now, now, projectId],
      };
    },

    /**
     * Restore only the tasks a project archive auto-archived. Manually
     * archived tasks (before or after the project archive) keep
     * archived_source = 'manual' and are deliberately left untouched.
     */
    buildRestoreProjectArchivedTasks(projectId: string, now: string): BatchStatement {
      return {
        sql: `UPDATE tasks
                 SET archived_at = NULL, archived_source = NULL, updated_at = ?
               WHERE project_id = ? AND archived_at IS NOT NULL AND archived_source = 'project'`,
        params: [now, projectId],
      };
    },

    /** How many tasks a "restore project and tasks" choice would restore. */
    async countProjectArchivedTasks(projectId: string): Promise<number> {
      const rows = await db.select(
        `SELECT COUNT(*) AS n FROM tasks
          WHERE project_id = ? AND archived_at IS NOT NULL AND archived_source = 'project'`,
        [projectId],
      );
      return readCount(rows);
    },

    async deleteById(id: string): Promise<number> {
      const result = await db.execute('DELETE FROM tasks WHERE id = ?', [id]);
      return result.rowsAffected;
    },

    buildDelete(id: string): BatchStatement {
      return { sql: 'DELETE FROM tasks WHERE id = ?', params: [id] };
    },
  };
}

function readCount(rows: unknown): number {
  const first = (rows as { n?: unknown }[])[0];
  return typeof first?.n === 'number' ? first.n : 0;
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
