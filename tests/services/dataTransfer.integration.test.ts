import { createDataTransferService } from '@/features/settings/services/dataTransfer.service';
import type {
  EntityCounts,
  ProjectPilotExport,
} from '@/features/settings/data/dataTransfer.schema';
import type { DatabaseSnapshot } from '@/repositories/dataTransfer.repo';
import {
  cloneSnapshot,
  createCompleteExport,
  createCompleteSnapshot,
  createTransferHarness,
  seedSnapshot,
} from '../helpers/dataTransferFixture';

const ZERO_COUNTS: EntityCounts = {
  projects: 0,
  meetings: 0,
  tasks: 0,
  taskDependencies: 0,
  milestones: 0,
  actionItems: 0,
  projectLinks: 0,
  risks: 0,
  appSettings: 0,
};

function countSnapshot(snapshot: DatabaseSnapshot): EntityCounts {
  return {
    projects: snapshot.projects.length,
    meetings: snapshot.meetings.length,
    tasks: snapshot.tasks.length,
    taskDependencies: snapshot.taskDependencies.length,
    milestones: snapshot.milestones.length,
    actionItems: snapshot.actionItems.length,
    projectLinks: snapshot.projectLinks.length,
    risks: snapshot.risks.length,
    appSettings: snapshot.appSettings.length,
  };
}

function sortedSnapshot(snapshot: DatabaseSnapshot): DatabaseSnapshot {
  const byId = <T extends { id: string }>(rows: readonly T[]) =>
    [...rows].sort((left, right) => left.id.localeCompare(right.id));
  return {
    projects: byId(snapshot.projects),
    meetings: byId(snapshot.meetings),
    tasks: byId(snapshot.tasks),
    taskDependencies: byId(snapshot.taskDependencies),
    milestones: byId(snapshot.milestones),
    actionItems: byId(snapshot.actionItems),
    projectLinks: byId(snapshot.projectLinks),
    risks: byId(snapshot.risks),
    appSettings: [...snapshot.appSettings].sort((left, right) => left.key.localeCompare(right.key)),
  };
}

function prefixedSnapshot(prefix: string): DatabaseSnapshot {
  const snapshot = cloneSnapshot();
  const projectId = (id: string) => `${prefix}-${id}`;
  const meetingId = (id: string) => `${prefix}-${id}`;
  const taskId = (id: string) => `${prefix}-${id}`;

  return {
    projects: snapshot.projects.map((row) => ({ ...row, id: projectId(row.id) })),
    meetings: snapshot.meetings.map((row) => ({
      ...row,
      id: meetingId(row.id),
      project_id: row.project_id === null ? null : projectId(row.project_id),
    })),
    tasks: snapshot.tasks.map((row) => ({
      ...row,
      id: taskId(row.id),
      project_id: projectId(row.project_id),
      parent_task_id: row.parent_task_id === null ? null : taskId(row.parent_task_id),
      source_meeting_id: row.source_meeting_id === null ? null : meetingId(row.source_meeting_id),
    })),
    taskDependencies: snapshot.taskDependencies.map((row) => ({
      ...row,
      id: `${prefix}-${row.id}`,
      predecessor_id: taskId(row.predecessor_id),
      successor_id: taskId(row.successor_id),
    })),
    milestones: snapshot.milestones.map((row) => ({
      ...row,
      id: `${prefix}-${row.id}`,
      project_id: projectId(row.project_id),
      linked_task_id: row.linked_task_id === null ? null : taskId(row.linked_task_id),
    })),
    actionItems: snapshot.actionItems.map((row) => ({
      ...row,
      id: `${prefix}-${row.id}`,
      meeting_id: meetingId(row.meeting_id),
      converted_task_id: row.converted_task_id === null ? null : taskId(row.converted_task_id),
    })),
    projectLinks: snapshot.projectLinks.map((row) => ({
      ...row,
      id: `${prefix}-${row.id}`,
      project_id: projectId(row.project_id),
    })),
    risks: snapshot.risks.map((row) => ({
      ...row,
      id: `${prefix}-${row.id}`,
      project_id: projectId(row.project_id),
    })),
    appSettings: snapshot.appSettings.map((row) => ({ ...row, key: `${prefix}-${row.key}` })),
  };
}

function fileFor(snapshot: DatabaseSnapshot): ProjectPilotExport {
  return {
    schemaVersion: 1,
    exportedAt: '2026-07-14T00:00:00Z',
    appVersion: '0.1.0',
    statistics: countSnapshot(snapshot),
    data: snapshot,
  };
}

describe('数据交换真实 SQLite 集成', () => {
  it('完整数据替换往返逐表逐字段无损', async () => {
    const source = createTransferHarness();
    const target = createTransferHarness();
    try {
      seedSnapshot(source.db);
      const before = await source.repository.readSnapshot();
      const exported = await source.service.exportData('0.1.0', undefined, true);

      await target.service.importData(exported, 'replace');
      const after = await target.repository.readSnapshot();

      expect(after).toEqual(before);
      expect(after.taskDependencies).toEqual(before.taskDependencies);
      const converted = after.actionItems.find((row) => row.id === 'action-converted');
      expect(converted).toMatchObject({
        converted_task_id: 'task-converted',
        converted_at: '2026-07-14T09:45:00Z',
      });
      expect(after.appSettings.find((row) => row.key === 'theme')?.value).toBe('dark');
    } finally {
      source.db.close();
      target.db.close();
    }
  });

  it('execute_batch 中途失败时只调用一次且事务完整回滚', async () => {
    const target = createTransferHarness();
    const source = createTransferHarness();
    try {
      seedSnapshot(target.db, prefixedSnapshot('old'));
      seedSnapshot(source.db);
      const before = await target.repository.readSnapshot();
      const exported = await createCompleteExport(source.db);
      const runBatch = vi.fn((statements: Parameters<typeof target.db.runBatch>[0]) => {
        const middle = Math.floor(statements.length / 2);
        const broken = { sql: 'INSERT INTO projects (id) VALUES (?)', params: ['broken'] };
        return Promise.resolve(
          target.db.runBatch([...statements.slice(0, middle), broken, ...statements.slice(middle)]),
        );
      });
      const service = createDataTransferService({ repository: target.repository, runBatch });

      await expect(service.importData(exported, 'replace')).rejects.toThrow();

      expect(runBatch).toHaveBeenCalledTimes(1);
      expect(await target.repository.readSnapshot()).toEqual(before);
      expect(
        target.db.raw
          .prepare(
            `SELECT COUNT(*) AS count
             FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
             WHERE p.id IS NULL`,
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        target.db.raw
          .prepare(
            `SELECT COUNT(*) AS count
             FROM action_items a LEFT JOIN meetings m ON m.id = a.meeting_id
             WHERE m.id IS NULL`,
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      target.db.close();
      source.db.close();
    }
  });

  it('合并时同 ID 内容不同也保持现有记录', async () => {
    const harness = createTransferHarness();
    try {
      seedSnapshot(harness.db);
      const before = await harness.repository.readSnapshot();
      const incoming = cloneSnapshot(before);
      const firstProject = incoming.projects[0];
      const firstTask = incoming.tasks[0];
      if (firstProject === undefined || firstTask === undefined) {
        throw new Error('完整夹具缺少项目或任务');
      }
      firstProject.name = '不应覆盖的名称';
      firstTask.title = '不应覆盖的标题';

      const result = await harness.service.importData(fileFor(incoming), 'merge');

      expect(result.inserted).toEqual(ZERO_COUNTS);
      expect(result.skipped).toEqual(countSnapshot(incoming));
      expect(await harness.repository.readSnapshot()).toEqual(before);
    } finally {
      harness.db.close();
    }
  });

  it('合并全新 ID 后新增完整数据且原数据不变', async () => {
    const harness = createTransferHarness();
    try {
      seedSnapshot(harness.db);
      const before = await harness.repository.readSnapshot();
      const incoming = prefixedSnapshot('new');

      const result = await harness.service.importData(fileFor(incoming), 'merge');
      const after = await harness.repository.readSnapshot();

      expect(result.inserted).toEqual(countSnapshot(incoming));
      expect(result.skipped).toEqual(ZERO_COUNTS);
      for (const project of before.projects) {
        expect(after.projects).toContainEqual(project);
      }
      for (const task of incoming.tasks) {
        expect(after.tasks).toContainEqual(task);
      }
    } finally {
      harness.db.close();
    }
  });

  it('混合合并准确报告跳过与新增数量', async () => {
    const harness = createTransferHarness();
    try {
      seedSnapshot(harness.db);
      const existing = createCompleteSnapshot();
      const added = prefixedSnapshot('mixed');
      const mixed: DatabaseSnapshot = {
        projects: [...existing.projects, ...added.projects],
        meetings: [...existing.meetings, ...added.meetings],
        tasks: [...existing.tasks, ...added.tasks],
        taskDependencies: [...existing.taskDependencies, ...added.taskDependencies],
        milestones: [...existing.milestones, ...added.milestones],
        actionItems: [...existing.actionItems, ...added.actionItems],
        projectLinks: [...existing.projectLinks, ...added.projectLinks],
        risks: [...existing.risks, ...added.risks],
        appSettings: [...existing.appSettings, ...added.appSettings],
      };

      const result = await harness.service.importData(fileFor(mixed), 'merge');

      expect(result.skipped).toEqual(countSnapshot(existing));
      expect(result.inserted).toEqual(countSnapshot(added));
    } finally {
      harness.db.close();
    }
  });

  it('替换清库语句遵循外键反向顺序且插入遵循拓扑顺序', () => {
    const harness = createTransferHarness();
    try {
      const clearSql = harness.repository.buildClearStatements().map((statement) => statement.sql);
      expect(clearSql).toEqual([
        'DELETE FROM task_dependencies',
        'DELETE FROM action_items',
        'DELETE FROM milestones',
        'DELETE FROM project_links',
        'DELETE FROM risks',
        'DELETE FROM tasks',
        'DELETE FROM meetings',
        'DELETE FROM projects',
        'DELETE FROM app_settings',
      ]);

      const inserts = harness.repository.buildInsertStatements(createCompleteSnapshot());
      const sql = inserts.map((statement) => statement.sql);
      const lastProject = sql.reduce(
        (last, statement, index) => (statement.includes('INSERT INTO projects') ? index : last),
        -1,
      );
      const firstMeeting = sql.findIndex((statement) => statement.includes('INSERT INTO meetings'));
      const taskIndexes = sql
        .map((statement, index) => (statement.includes('INSERT INTO tasks') ? index : -1))
        .filter((index) => index >= 0);
      const firstDependency = sql.findIndex((statement) =>
        statement.includes('INSERT INTO task_dependencies'),
      );

      expect(lastProject).toBeLessThan(firstMeeting);
      expect(Math.max(...taskIndexes)).toBeLessThan(firstDependency);
      expect(inserts[firstMeeting]?.params?.[0]).toBe('meeting-project');
      expect(taskIndexes.map((index) => inserts[index]?.params?.[0])).toEqual([
        'task-root',
        'task-converted',
        'task-sample',
        'task-child',
      ]);
    } finally {
      harness.db.close();
    }
  });

  it('替换后不存在旧数据残留', async () => {
    const harness = createTransferHarness();
    try {
      seedSnapshot(harness.db, prefixedSnapshot('old'));
      await harness.service.importData(fileFor(createCompleteSnapshot()), 'replace');
      const after = await harness.repository.readSnapshot();

      expect(sortedSnapshot(after)).toEqual(sortedSnapshot(createCompleteSnapshot()));
      expect(JSON.stringify(after)).not.toContain('old-');
    } finally {
      harness.db.close();
    }
  });

  it('默认导出排除全部示例行和关联行且无外键悬空', async () => {
    const harness = createTransferHarness();
    try {
      seedSnapshot(harness.db);
      const exported = await harness.service.exportData('0.1.0');

      expect(exported.data.projects.map((row) => row.id)).toEqual(['project-real']);
      expect(exported.data.meetings.map((row) => row.id)).toEqual(['meeting-project']);
      expect(exported.data.tasks.map((row) => row.id)).toEqual([
        'task-root',
        'task-converted',
        'task-child',
      ]);
      expect(exported.data.actionItems.map((row) => row.id)).toEqual([
        'action-converted',
        'action-project',
      ]);
      expect(exported.statistics).toEqual(countSnapshot(exported.data));

      const empty = createTransferHarness();
      try {
        await empty.service.importData(exported, 'replace');
        expect(await empty.repository.readSnapshot()).toEqual(exported.data);
      } finally {
        empty.db.close();
      }
    } finally {
      harness.db.close();
    }
  });

  it('勾选包含示例数据时完整保留 is_sample 与统计', async () => {
    const harness = createTransferHarness();
    try {
      seedSnapshot(harness.db);
      const exported = await harness.service.exportData('0.1.0', undefined, true);

      expect(sortedSnapshot(exported.data)).toEqual(sortedSnapshot(createCompleteSnapshot()));
      expect(exported.data.projects.some((row) => row.is_sample === 1)).toBe(true);
      expect(exported.data.tasks.some((row) => row.is_sample === 1)).toBe(true);
      expect(exported.statistics).toEqual(countSnapshot(createCompleteSnapshot()));
    } finally {
      harness.db.close();
    }
  });

  it('合并预览的预计跳过与实际结果一致且预览不写库', async () => {
    const harness = createTransferHarness();
    try {
      seedSnapshot(harness.db);
      const file = await createCompleteExport(harness.db);
      const before = await harness.repository.readSnapshot();

      const preview = await harness.service.previewImport(file, 'merge');

      expect(preview.inserted).toEqual(ZERO_COUNTS);
      expect(preview.skipped).toEqual(file.statistics);
      expect(preview.deleted).toEqual(ZERO_COUNTS);
      expect(harness.runBatch).not.toHaveBeenCalled();
      expect(await harness.repository.readSnapshot()).toEqual(before);

      const result = await harness.service.importData(file, 'merge');
      expect(result.inserted).toEqual(preview.inserted);
      expect(result.skipped).toEqual(preview.skipped);
    } finally {
      harness.db.close();
    }
  });

  it('替换预览准确展示将删除和将新增的数量', async () => {
    const harness = createTransferHarness();
    try {
      seedSnapshot(harness.db);
      const file = fileFor(prefixedSnapshot('preview'));
      const before = await harness.repository.readSnapshot();

      const preview = await harness.service.previewImport(file, 'replace');

      expect(preview.deleted).toEqual(countSnapshot(before));
      expect(preview.inserted).toEqual(file.statistics);
      expect(preview.skipped).toEqual(ZERO_COUNTS);
      expect(await harness.repository.readSnapshot()).toEqual(before);
      expect(harness.runBatch).not.toHaveBeenCalled();
    } finally {
      harness.db.close();
    }
  });
});
