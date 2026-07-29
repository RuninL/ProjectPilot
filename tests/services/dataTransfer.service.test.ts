import { createDataTransferService } from '@/features/settings/services/dataTransfer.service';
import {
  createDataTransferRepository,
  type DatabaseSnapshot,
} from '@/repositories/dataTransfer.repo';
import { createTestDb, NOW, type TestDb } from '../helpers/testDb';

function snapshot(projectId = 'project-1'): DatabaseSnapshot {
  return {
    projects: [
      {
        id: projectId,
        name: '项目一',
        description: '完整数据',
        status: 'active',
        color: '#2563EB',
        start_date: '2026-07-01',
        target_end_date: '2026-12-31',
        archived_at: null,
        is_sample: 0,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    meetings: [
      {
        id: `meeting-${projectId}`,
        project_id: projectId,
        topic: '周会',
        date: '2026-07-14',
        start_time: '09:30',
        attendees: '["张三","李四"]',
        agenda: '议程',
        notes: '纪要',
        decisions: '决定',
        risks: '风险',
        is_sample: 0,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    tasks: [
      {
        id: `task-root-${projectId}`,
        project_id: projectId,
        parent_task_id: null,
        title: '父任务',
        description: '描述',
        status: 'in_progress',
        priority: 'high',
        start_date: '2026-07-01',
        due_date: '2026-07-20',
        progress: 50,
        estimated_hours: 8,
        actual_hours: 4,
        completed_at: null,
        archived_at: null,
        source_meeting_id: `meeting-${projectId}`,
        is_sample: 0,
        created_at: NOW,
        updated_at: NOW,
      },
      {
        id: `task-child-${projectId}`,
        project_id: projectId,
        parent_task_id: `task-root-${projectId}`,
        title: '子任务',
        description: '',
        status: 'todo',
        priority: 'medium',
        start_date: null,
        due_date: '2026-07-19',
        progress: 0,
        estimated_hours: null,
        actual_hours: null,
        completed_at: null,
        archived_at: null,
        source_meeting_id: null,
        is_sample: 0,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    taskDependencies: [
      {
        id: `dependency-${projectId}`,
        predecessor_id: `task-root-${projectId}`,
        successor_id: `task-child-${projectId}`,
        dep_type: 'FS',
        lag_days: 0,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    milestones: [
      {
        id: `milestone-${projectId}`,
        project_id: projectId,
        linked_task_id: `task-child-${projectId}`,
        name: '发布',
        description: '',
        date: '2026-07-31',
        status: 'upcoming',
        achieved_at: null,
        is_sample: 0,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    actionItems: [
      {
        id: `action-${projectId}`,
        meeting_id: `meeting-${projectId}`,
        content: '跟进',
        owner: '张三',
        due_date: '2026-07-18',
        status: 'in_progress',
        converted_task_id: `task-child-${projectId}`,
        converted_at: NOW,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    projectLinks: [
      {
        id: `link-${projectId}`,
        project_id: projectId,
        label: '资料',
        link_type: 'url',
        target: 'https://example.com',
        is_sample: 0,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    risks: [
      {
        id: `risk-${projectId}`,
        project_id: projectId,
        title: '延期',
        description: '',
        category: 'schedule',
        likelihood: 'medium',
        impact: 'high',
        level: 'high',
        status: 'open',
        owner: '李四',
        mitigation_plan: '跟进',
        due_date: '2026-07-25',
        resolved_at: null,
        is_sample: 0,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    appSettings: [{ key: 'theme', value: 'dark', created_at: NOW, updated_at: NOW }],
  };
}

function serviceFor(db: TestDb) {
  const repository = createDataTransferRepository(db.executor);
  return {
    repository,
    service: createDataTransferService({
      repository,
      runBatch: async (statements) => db.runBatch(statements),
    }),
  };
}

async function seed(db: TestDb, data: DatabaseSnapshot): Promise<void> {
  const repository = createDataTransferRepository(db.executor);
  db.runBatch(repository.buildInsertStatements(data));
}

describe('dataTransfer.service', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('导出包含版本、统计和全部实体字段', async () => {
    await seed(db, snapshot());
    const { service } = serviceFor(db);
    const file = await service.exportData('0.1.0', NOW);

    expect(file.schemaVersion).toBe(1);
    expect(file.exportedAt).toBe(NOW);
    expect(file.appVersion).toBe('0.1.0');
    expect(file.statistics).toEqual({
      projects: 1,
      meetings: 1,
      tasks: 2,
      taskDependencies: 1,
      milestones: 1,
      actionItems: 1,
      projectLinks: 1,
      risks: 1,
      appSettings: 1,
    });
    expect(file.data).toEqual(snapshot());
  });

  it('JSON 导出后替换导入可无损往返', async () => {
    await seed(db, snapshot());
    const { service } = serviceFor(db);
    const exported = await service.exportData('0.1.0', NOW);

    const target = createTestDb();
    try {
      const targetPair = serviceFor(target);
      await targetPair.service.importData(exported, 'replace');
      expect(await targetPair.repository.readSnapshot()).toEqual(snapshot());
    } finally {
      target.close();
    }
  });

  it.each([
    ['缺少字段', (raw: Record<string, unknown>) => delete raw.data],
    ['字段类型错误', (raw: Record<string, unknown>) => (raw.statistics = '错误')],
    ['版本不兼容', (raw: Record<string, unknown>) => (raw.schemaVersion = 2)],
  ])('Zod 拒绝%s', async (_label, mutate) => {
    await seed(db, snapshot());
    const { service } = serviceFor(db);
    const file = await service.exportData('0.1.0', NOW);
    const raw = JSON.parse(JSON.stringify(file)) as Record<string, unknown>;
    mutate(raw);
    expect(() => service.parseImport(JSON.stringify(raw))).toThrow(/导入校验失败/);
  });

  it('Zod 拒绝非法枚举和非法日期', async () => {
    await seed(db, snapshot());
    const { service } = serviceFor(db);
    const file = await service.exportData('0.1.0', NOW);
    const raw = JSON.parse(JSON.stringify(file)) as {
      data: { tasks: { status: string; due_date: string }[] };
    };
    const first = raw.data.tasks[0];
    if (first === undefined) {
      throw new Error('测试数据缺少任务');
    }
    first.status = 'unknown';
    first.due_date = '2026-02-30';
    expect(() => service.parseImport(JSON.stringify(raw))).toThrow(/导入校验失败/);
  });

  it('合并模式对所有实体统一跳过同 ID', async () => {
    await seed(db, snapshot());
    const { service, repository } = serviceFor(db);
    const file = await service.exportData('0.1.0', NOW);
    const result = await service.importData(file, 'merge');

    expect(result.inserted).toEqual({
      projects: 0,
      meetings: 0,
      tasks: 0,
      taskDependencies: 0,
      milestones: 0,
      actionItems: 0,
      projectLinks: 0,
      risks: 0,
      appSettings: 0,
    });
    expect(result.skipped).toEqual(file.statistics);
    expect(await repository.readSnapshot()).toEqual(snapshot());
  });

  it('替换模式清空旧数据并重建', async () => {
    await seed(db, snapshot('old'));
    const source = createTestDb();
    try {
      await seed(source, snapshot('new'));
      const exported = await serviceFor(source).service.exportData('0.1.0', NOW);
      const { service, repository } = serviceFor(db);
      await service.importData(exported, 'replace');
      expect(await repository.readSnapshot()).toEqual(snapshot('new'));
    } finally {
      source.close();
    }
  });

  it('批处理中途失败时整体回滚', async () => {
    await seed(db, snapshot('old'));
    const repository = createDataTransferRepository(db.executor);
    const before = await repository.readSnapshot();
    const service = createDataTransferService({
      repository,
      runBatch: async (statements) => {
        const firstInsert = statements.find((statement) =>
          statement.sql.startsWith('INSERT INTO projects'),
        );
        if (firstInsert === undefined) {
          throw new Error('测试未找到项目插入语句');
        }
        return db.runBatch([...statements, firstInsert]);
      },
    });
    const source = createTestDb();
    try {
      await seed(source, snapshot('new'));
      const file = await serviceFor(source).service.exportData('0.1.0', NOW);
      await expect(service.importData(file, 'replace')).rejects.toThrow();
      expect(await repository.readSnapshot()).toEqual(before);
    } finally {
      source.close();
    }
  });

  it('拒绝成环依赖', async () => {
    await seed(db, snapshot());
    const { service } = serviceFor(db);
    const file = await service.exportData('0.1.0', NOW);
    file.data.taskDependencies.push({
      id: 'dependency-cycle',
      predecessor_id: 'task-child-project-1',
      successor_id: 'task-root-project-1',
      dep_type: 'FS',
      lag_days: 0,
      created_at: NOW,
      updated_at: NOW,
    });
    file.statistics.taskDependencies += 1;
    expect(() => service.parseImport(JSON.stringify(file))).toThrow(/任务依赖存在环/);
  });

  it('拒绝超过两层的任务', async () => {
    await seed(db, snapshot());
    const { service } = serviceFor(db);
    const file = await service.exportData('0.1.0', NOW);
    file.data.tasks.push({
      ...file.data.tasks[1]!,
      id: 'task-third-level',
      parent_task_id: 'task-child-project-1',
    });
    file.statistics.tasks += 1;
    expect(() => service.parseImport(JSON.stringify(file))).toThrow(/最多两层/);
  });

  it('拒绝 converted_task_id 重复关联', async () => {
    await seed(db, snapshot());
    const { service } = serviceFor(db);
    const file = await service.exportData('0.1.0', NOW);
    file.data.actionItems.push({
      ...file.data.actionItems[0]!,
      id: 'action-duplicate',
    });
    file.statistics.actionItems += 1;
    expect(() => service.parseImport(JSON.stringify(file))).toThrow(/多个行动项/);
  });
});
