import { projectRowSchema } from '@/db/schemas';
import type { BatchStatement } from '@/lib/commands';
import type { SqlExecutor } from '@/lib/db';
import type { Project, ProjectStatus } from '@/types';
import {
  buildUpdate,
  composeWhere,
  likeParam,
  parseOptional,
  parseRows,
  runUpdate,
  type SqlFragment,
} from './_shared';

const UPDATABLE = [
  'name',
  'description',
  'status',
  'color',
  'start_date',
  'target_end_date',
  'archived_at',
] as const;

const INSERT_SQL = `INSERT INTO projects
    (id, name, description, status, color, start_date, target_end_date,
     archived_at, is_sample, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertParams(project: Project): unknown[] {
  return [
    project.id,
    project.name,
    project.description,
    project.status,
    project.color,
    project.start_date,
    project.target_end_date,
    project.archived_at,
    project.is_sample,
    project.created_at,
    project.updated_at,
  ];
}

/** Archive state selector; `archived_at IS NULL` is the single source of truth. */
export type ProjectScope = 'active' | 'archived' | 'all';
export type ProjectSort = 'updated_at' | 'name' | 'target_end_date';

export interface ProjectQuery {
  search?: string;
  status?: ProjectStatus;
  scope?: ProjectScope;
  sort?: ProjectSort;
}

// Fixed whitelist: the caller picks a key, never the ORDER BY text itself.
// NULL target dates are pinned last, since SQLite orders NULL first by default.
const PROJECT_ORDER_BY: Record<ProjectSort, string> = {
  updated_at: 'updated_at DESC',
  name: 'name ASC',
  target_end_date: 'target_end_date IS NULL, target_end_date ASC, name ASC',
};

const SCOPE_CONDITION: Record<ProjectScope, string> = {
  active: 'archived_at IS NULL',
  archived: 'archived_at IS NOT NULL',
  all: '',
};

function projectConditions(query: ProjectQuery): SqlFragment[] {
  const search = query.search?.trim() ?? '';
  return [
    { sql: SCOPE_CONDITION[query.scope ?? 'active'], params: [] },
    query.status === undefined
      ? { sql: '', params: [] }
      : { sql: 'status = ?', params: [query.status] },
    search === ''
      ? { sql: '', params: [] }
      : {
          sql: "(name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')",
          params: [likeParam(search), likeParam(search)],
        },
  ];
}

export function createProjectRepository(db: SqlExecutor) {
  return {
    async findAll(): Promise<Project[]> {
      const rows = await db.select('SELECT * FROM projects ORDER BY created_at DESC');
      return parseRows(projectRowSchema, rows);
    },

    async findActive(): Promise<Project[]> {
      const rows = await db.select(
        'SELECT * FROM projects WHERE archived_at IS NULL ORDER BY created_at DESC',
      );
      return parseRows(projectRowSchema, rows);
    },

    async findById(id: string): Promise<Project | null> {
      const rows = await db.select('SELECT * FROM projects WHERE id = ?', [id]);
      return parseOptional(projectRowSchema, rows);
    },

    async findByQuery(query: ProjectQuery = {}): Promise<Project[]> {
      const where = composeWhere(projectConditions(query));
      const orderBy = PROJECT_ORDER_BY[query.sort ?? 'updated_at'];
      const rows = await db.select(
        `SELECT * FROM projects${where.sql} ORDER BY ${orderBy}`,
        where.params,
      );
      return parseRows(projectRowSchema, rows);
    },

    async insert(project: Project): Promise<void> {
      await db.execute(INSERT_SQL, insertParams(project));
    },

    /** Same insert, as a statement for an atomic multi-row batch. */
    buildInsert(project: Project): BatchStatement {
      return { sql: INSERT_SQL, params: insertParams(project) };
    },

    async update(id: string, patch: Partial<Project>, now: string): Promise<number> {
      return runUpdate(db, buildUpdate('projects', UPDATABLE, patch, id, now));
    },

    async deleteById(id: string): Promise<number> {
      const result = await db.execute('DELETE FROM projects WHERE id = ?', [id]);
      return result.rowsAffected;
    },
  };
}

export type ProjectRepository = ReturnType<typeof createProjectRepository>;
