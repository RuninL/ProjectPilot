import { nowIso } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/uuid';
import {
  getRepositories,
  type ProjectRepository,
  type RiskQuery,
  type RiskRepository,
} from '@/repositories';
import type { Risk, RiskStatus } from '@/types';
import { calculateRiskLevel } from './riskLevel';
import { riskInputSchema, type RiskInput } from './schemas';

export interface RiskServiceDeps {
  risks: RiskRepository;
  projects: ProjectRepository;
}

export function createRiskService(deps: RiskServiceDeps) {
  async function requireRisk(id: string): Promise<Risk> {
    const risk = await deps.risks.findById(id);
    if (risk === null) throw new AppError('not_found', '风险不存在或已被删除');
    return risk;
  }
  async function requireProject(projectId: string): Promise<void> {
    if ((await deps.projects.findById(projectId)) === null) {
      throw new AppError('validation', '所属项目不存在或已被删除');
    }
  }
  function resolvedAt(status: RiskStatus, existing: Risk | null, now: string): string | null {
    return status === 'mitigated' || status === 'closed' ? (existing?.resolved_at ?? now) : null;
  }
  return {
    listRisks: (query: RiskQuery = {}) => deps.risks.findByQuery(query),
    async createRisk(input: RiskInput): Promise<Risk> {
      const parsed = riskInputSchema.parse(input);
      await requireProject(parsed.project_id);
      const now = nowIso();
      const risk: Risk = {
        id: newId(),
        project_id: parsed.project_id,
        title: parsed.title,
        description: parsed.description,
        category: parsed.category,
        likelihood: parsed.likelihood,
        impact: parsed.impact,
        level: calculateRiskLevel(parsed.likelihood, parsed.impact),
        status: parsed.status,
        owner: parsed.owner,
        mitigation_plan: parsed.mitigation_plan,
        due_date: parsed.due_date,
        resolved_at: resolvedAt(parsed.status, null, now),
        is_sample: 0,
        created_at: now,
        updated_at: now,
      };
      await deps.risks.insert(risk);
      return risk;
    },
    async updateRisk(id: string, input: RiskInput): Promise<Risk> {
      const existing = await requireRisk(id);
      const parsed = riskInputSchema.parse(input);
      if (parsed.project_id !== existing.project_id)
        throw new AppError('validation', '风险不能移动到其他项目');
      const now = nowIso();
      await deps.risks.update(
        id,
        {
          title: parsed.title,
          description: parsed.description,
          category: parsed.category,
          likelihood: parsed.likelihood,
          impact: parsed.impact,
          level: calculateRiskLevel(parsed.likelihood, parsed.impact),
          status: parsed.status,
          owner: parsed.owner,
          mitigation_plan: parsed.mitigation_plan,
          due_date: parsed.due_date,
          resolved_at: resolvedAt(parsed.status, existing, now),
        },
        now,
      );
      return requireRisk(id);
    },
    async setStatus(id: string, status: RiskStatus): Promise<Risk> {
      const existing = await requireRisk(id);
      const allowed: Record<RiskStatus, readonly RiskStatus[]> = {
        open: ['monitoring', 'closed'],
        monitoring: ['mitigated', 'closed'],
        mitigated: ['open'],
        closed: ['open'],
      };
      if (!allowed[existing.status].includes(status)) {
        throw new AppError('validation', '当前风险状态不允许这样变更');
      }
      const now = nowIso();
      await deps.risks.update(id, { status, resolved_at: resolvedAt(status, existing, now) }, now);
      return requireRisk(id);
    },
    async deleteRisk(id: string): Promise<void> {
      await requireRisk(id);
      await deps.risks.deleteById(id);
    },
  };
}

export type RiskService = ReturnType<typeof createRiskService>;
export async function getRiskService(): Promise<RiskService> {
  const repos = await getRepositories();
  return createRiskService({ risks: repos.risks, projects: repos.projects });
}
