import { riskRowSchema, riskWithProjectRowSchema } from '@/db/schemas';
import type { SqlExecutor } from '@/lib/db';
import type { Risk, RiskCategory, RiskLevel, RiskStatus, RiskWithProject } from '@/types';
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
  'title',
  'description',
  'category',
  'likelihood',
  'impact',
  'level',
  'status',
  'owner',
  'mitigation_plan',
  'due_date',
  'resolved_at',
] as const;

export interface RiskQuery {
  projectIds?: readonly string[];
  statuses?: readonly RiskStatus[];
  levels?: readonly RiskLevel[];
  categories?: readonly RiskCategory[];
  search?: string;
}

function conditions(query: RiskQuery): SqlFragment[] {
  const search = query.search?.trim() ?? '';
  return [
    inClause('r.project_id', query.projectIds ?? []),
    inClause('r.status', query.statuses ?? []),
    inClause('r.level', query.levels ?? []),
    inClause('r.category', query.categories ?? []),
    search === ''
      ? { sql: '', params: [] }
      : {
          sql: "(r.title LIKE ? ESCAPE '\\' OR r.description LIKE ? ESCAPE '\\')",
          params: [likeParam(search), likeParam(search)],
        },
  ];
}

export function createRiskRepository(db: SqlExecutor) {
  return {
    async findById(id: string): Promise<Risk | null> {
      return parseOptional(
        riskRowSchema,
        await db.select('SELECT * FROM risks WHERE id = ?', [id]),
      );
    },
    async findByQuery(query: RiskQuery = {}): Promise<RiskWithProject[]> {
      const where = composeWhere(conditions(query));
      const rows = await db.select(
        `SELECT r.*, p.name AS project_name, p.color AS project_color FROM risks r JOIN projects p ON p.id = r.project_id${where.sql}
         ORDER BY CASE r.status
            WHEN 'open' THEN 0
            WHEN 'monitoring' THEN 1
            WHEN 'mitigated' THEN 2
            ELSE 3
          END,
          CASE r.level WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
           r.due_date IS NULL, r.due_date ASC, r.updated_at DESC`,
        where.params,
      );
      return parseRows(riskWithProjectRowSchema, rows);
    },
    async countOpenByProject(projectId: string): Promise<number> {
      const rows = await db.select<{ n: number }[]>(
        "SELECT COUNT(*) AS n FROM risks WHERE project_id = ? AND status IN ('open', 'monitoring')",
        [projectId],
      );
      return rows[0]?.n ?? 0;
    },
    async insert(risk: Risk): Promise<void> {
      await db.execute(
        `INSERT INTO risks (id, project_id, title, description, category, likelihood, impact, level, status, owner,
          mitigation_plan, due_date, resolved_at, is_sample, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          risk.id,
          risk.project_id,
          risk.title,
          risk.description,
          risk.category,
          risk.likelihood,
          risk.impact,
          risk.level,
          risk.status,
          risk.owner,
          risk.mitigation_plan,
          risk.due_date,
          risk.resolved_at,
          risk.is_sample,
          risk.created_at,
          risk.updated_at,
        ],
      );
    },
    async update(id: string, patch: Partial<Risk>, now: string): Promise<number> {
      return runUpdate(db, buildUpdate('risks', UPDATABLE, patch, id, now));
    },
    async deleteById(id: string): Promise<number> {
      return (await db.execute('DELETE FROM risks WHERE id = ?', [id])).rowsAffected;
    },
  };
}

export type RiskRepository = ReturnType<typeof createRiskRepository>;
