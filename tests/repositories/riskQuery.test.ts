import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectRepository, createRiskRepository } from '@/repositories';
import { makeProject, makeRisk } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb;

beforeEach(async () => {
  db = createTestDb();
  const projects = createProjectRepository(db.executor);
  const risks = createRiskRepository(db.executor);
  await projects.insert(makeProject({ id: 'p1', name: '项目一' }));
  await projects.insert(makeProject({ id: 'p2', name: '项目二' }));
  await risks.insert(
    makeRisk({
      id: 'closed-critical',
      title: '已关闭严重风险',
      likelihood: 'high',
      impact: 'high',
      level: 'critical',
      status: 'closed',
      resolved_at: '2026-07-15T00:00:00Z',
      due_date: '2026-07-10',
    }),
  );
  await risks.insert(
    makeRisk({
      id: 'open-low',
      title: '开放低风险',
      category: 'scope',
      likelihood: 'low',
      impact: 'high',
      level: 'low',
      due_date: '2026-07-12',
    }),
  );
  await risks.insert(
    makeRisk({
      id: 'open-high',
      title: '接口延迟',
      description: '需要回归验证',
      category: 'technical',
      likelihood: 'high',
      impact: 'medium',
      level: 'high',
      due_date: '2026-07-20',
    }),
  );
  await risks.insert(
    makeRisk({
      id: 'monitoring-critical',
      project_id: 'p2',
      title: '监控中严重风险',
      category: 'external',
      likelihood: 'high',
      impact: 'high',
      level: 'critical',
      status: 'monitoring',
    }),
  );
});

afterEach(() => {
  db.close();
});

describe('risk query filtering and ordering', () => {
  it('prioritizes open then monitoring risks before resolved risks, with level order inside each status', async () => {
    const risks = await createRiskRepository(db.executor).findByQuery();

    expect(risks.map((risk) => risk.id)).toEqual([
      'open-high',
      'open-low',
      'monitoring-critical',
      'closed-critical',
    ]);
  });

  it('combines project, status, level, category and literal search filters', async () => {
    const repository = createRiskRepository(db.executor);

    expect(
      (
        await repository.findByQuery({ projectIds: ['p1'], statuses: ['open'], levels: ['high'] })
      ).map((risk) => risk.id),
    ).toEqual(['open-high']);
    expect(
      (await repository.findByQuery({ categories: ['external'] })).map((risk) => risk.id),
    ).toEqual(['monitoring-critical']);
    expect((await repository.findByQuery({ search: '回归验证' })).map((risk) => risk.id)).toEqual([
      'open-high',
    ]);
    expect((await repository.findByQuery({ search: '%' })).map((risk) => risk.id)).toEqual([]);
  });
});
