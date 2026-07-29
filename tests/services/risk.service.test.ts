import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectRepository, createRiskRepository } from '@/repositories';
import { createRiskService, type RiskService } from '@/services/risk.service';
import type { RiskInput } from '@/services/schemas';
import { makeProject } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb;
let service: RiskService;

function input(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    project_id: 'p1',
    title: '供应商接口延迟',
    description: '',
    category: 'technical',
    likelihood: 'high',
    impact: 'medium',
    status: 'open',
    owner: '张三',
    mitigation_plan: '',
    due_date: null,
    ...overrides,
  };
}

beforeEach(async () => {
  db = createTestDb();
  const projects = createProjectRepository(db.executor);
  service = createRiskService({ risks: createRiskRepository(db.executor), projects });
  await projects.insert(makeProject({ id: 'p1' }));
});

afterEach(() => {
  db.close();
});

describe('risk lifecycle service', () => {
  it('calculates the persisted level when creating a risk', async () => {
    const risk = await service.createRisk(input());

    expect(risk.level).toBe('high');
    expect(risk.resolved_at).toBeNull();
  });

  it('rejects an illegal status change through updateRisk instead of bypassing the state machine', async () => {
    const risk = await service.createRisk(input());

    await expect(service.updateRisk(risk.id, input({ status: 'mitigated' }))).rejects.toThrow(
      '当前风险状态不允许这样变更',
    );
    expect((await service.getRisk(risk.id)).status).toBe('open');
    expect((await service.getRisk(risk.id)).resolved_at).toBeNull();
  });

  it('permits legal transitions and maintains resolved_at entering and leaving resolved states', async () => {
    const risk = await service.createRisk(input());
    const monitoring = await service.updateRisk(risk.id, input({ status: 'monitoring' }));
    const mitigated = await service.setStatus(risk.id, 'mitigated');
    const reopened = await service.setStatus(risk.id, 'open');

    expect(monitoring.status).toBe('monitoring');
    expect(monitoring.resolved_at).toBeNull();
    expect(mitigated.status).toBe('mitigated');
    expect(mitigated.resolved_at).not.toBeNull();
    expect(reopened.status).toBe('open');
    expect(reopened.resolved_at).toBeNull();
  });

  it('rejects an invalid direct setStatus transition', async () => {
    const risk = await service.createRisk(input());

    await expect(service.setStatus(risk.id, 'mitigated')).rejects.toThrow(
      '当前风险状态不允许这样变更',
    );
  });
});
