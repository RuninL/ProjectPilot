import { taskRowSchema } from '@/db/schemas';
import type { BatchStatement } from '@/lib/commands';
import type { SqlExecutor } from '@/lib/db';
import type { Task } from '@/types';
import { buildUpdate, parseOptional, parseRows, runUpdate } from './_shared';

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
] as const;

const INSERT_SQL = `INSERT INTO tasks
    (id, project_id, parent_task_id, title, description, status, priority,
     start_date, due_date, progress, estimated_hours, actual_hours,
     is_sample, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
    task.is_sample,
    task.created_at,
    task.updated_at,
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

    async findChildren(parentTaskId: string): Promise<Task[]> {
      const rows = await db.select(
        'SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at ASC',
        [parentTaskId],
      );
      return parseRows(taskRowSchema, rows);
    },

    async findById(id: string): Promise<Task | null> {
      const rows = await db.select('SELECT * FROM tasks WHERE id = ?', [id]);
      return parseOptional(taskRowSchema, rows);
    },

    async insert(task: Task): Promise<void> {
      await db.execute(INSERT_SQL, insertParams(task));
    },

    /** Same insert, as a statement for an atomic multi-row batch. */
    buildInsert(task: Task): BatchStatement {
      return { sql: INSERT_SQL, params: insertParams(task) };
    },

    async update(id: string, patch: Partial<Task>, now: string): Promise<number> {
      return runUpdate(db, buildUpdate('tasks', UPDATABLE, patch, id, now));
    },

    async deleteById(id: string): Promise<number> {
      const result = await db.execute('DELETE FROM tasks WHERE id = ?', [id]);
      return result.rowsAffected;
    },
  };
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
