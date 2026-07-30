import { projectLinkRowSchema, projectLinkWithProjectRowSchema } from '@/db/schemas';
import type { SqlExecutor } from '@/lib/db';
import type { LinkType, ProjectLink, ProjectLinkWithProject } from '@/types';
import {
  buildUpdate,
  composeWhere,
  likeParam,
  parseOptional,
  parseRows,
  runUpdate,
  type SqlFragment,
} from './_shared';

const UPDATABLE = ['label', 'link_type', 'target', 'description'] as const;

export interface ProjectLinkQuery {
  search?: string;
  projectId?: string;
  linkType?: LinkType;
}

function projectLinkConditions(query: ProjectLinkQuery): SqlFragment[] {
  const search = query.search?.trim() ?? '';
  return [
    search === ''
      ? { sql: '', params: [] }
      : {
          sql: "(pl.label LIKE ? ESCAPE '\\' OR pl.description LIKE ? ESCAPE '\\')",
          params: [likeParam(search), likeParam(search)],
        },
    query.projectId === undefined || query.projectId === ''
      ? { sql: '', params: [] }
      : { sql: 'pl.project_id = ?', params: [query.projectId] },
    query.linkType === undefined
      ? { sql: '', params: [] }
      : { sql: 'pl.link_type = ?', params: [query.linkType] },
  ];
}

export function createProjectLinkRepository(db: SqlExecutor) {
  return {
    async findByProject(projectId: string): Promise<ProjectLink[]> {
      const rows = await db.select(
        'SELECT * FROM project_links WHERE project_id = ? ORDER BY created_at ASC',
        [projectId],
      );
      return parseRows(projectLinkRowSchema, rows);
    },

    async findAllWithProject(query: ProjectLinkQuery = {}): Promise<ProjectLinkWithProject[]> {
      const where = composeWhere(projectLinkConditions(query));
      const rows = await db.select(
        `SELECT pl.*, p.name AS project_name, p.color AS project_color
           FROM project_links pl
           JOIN projects p ON p.id = pl.project_id
           ${where.sql}
          ORDER BY pl.created_at DESC, pl.label ASC`,
        where.params,
      );
      return parseRows(projectLinkWithProjectRowSchema, rows);
    },

    async findById(id: string): Promise<ProjectLink | null> {
      const rows = await db.select('SELECT * FROM project_links WHERE id = ?', [id]);
      return parseOptional(projectLinkRowSchema, rows);
    },

    async insert(link: ProjectLink): Promise<void> {
      await db.execute(
        `INSERT INTO project_links
          (id, project_id, label, link_type, target, description, is_sample, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          link.id,
          link.project_id,
          link.label,
          link.link_type,
          link.target,
          link.description,
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
