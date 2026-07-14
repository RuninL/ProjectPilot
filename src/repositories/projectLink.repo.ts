import { projectLinkRowSchema } from '@/db/schemas';
import type { SqlExecutor } from '@/lib/db';
import type { ProjectLink } from '@/types';
import { buildUpdate, parseOptional, parseRows, runUpdate } from './_shared';

const UPDATABLE = ['label', 'link_type', 'target'] as const;

export function createProjectLinkRepository(db: SqlExecutor) {
  return {
    async findByProject(projectId: string): Promise<ProjectLink[]> {
      const rows = await db.select(
        'SELECT * FROM project_links WHERE project_id = ? ORDER BY created_at ASC',
        [projectId],
      );
      return parseRows(projectLinkRowSchema, rows);
    },

    async findById(id: string): Promise<ProjectLink | null> {
      const rows = await db.select('SELECT * FROM project_links WHERE id = ?', [id]);
      return parseOptional(projectLinkRowSchema, rows);
    },

    async insert(link: ProjectLink): Promise<void> {
      await db.execute(
        `INSERT INTO project_links
          (id, project_id, label, link_type, target, is_sample, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          link.id,
          link.project_id,
          link.label,
          link.link_type,
          link.target,
          link.is_sample,
          link.created_at,
          link.updated_at,
        ],
      );
    },

    async update(id: string, patch: Partial<ProjectLink>, now: string): Promise<number> {
      return runUpdate(db, buildUpdate('project_links', UPDATABLE, patch, id, now));
    },

    async deleteById(id: string): Promise<number> {
      const result = await db.execute('DELETE FROM project_links WHERE id = ?', [id]);
      return result.rowsAffected;
    },
  };
}

export type ProjectLinkRepository = ReturnType<typeof createProjectLinkRepository>;
