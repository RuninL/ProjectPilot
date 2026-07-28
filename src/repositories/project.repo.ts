import { projectRowSchema } from '@/db/schemas';
import type { BatchStatement } from '@/lib/commands';
import type { SqlExecutor } from '@/lib/db';
import type { Project } from '@/types';
import { buildUpdate, parseOptional, parseRows, runUpdate } from './_shared';

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
