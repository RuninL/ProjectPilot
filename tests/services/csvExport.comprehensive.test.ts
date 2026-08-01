import { createCsv } from '@/features/settings/services/csvExport';
import type { DatabaseSnapshot } from '@/repositories/dataTransfer.repo';
import { cloneSnapshot, createTransferHarness, seedSnapshot } from '../helpers/dataTransferFixture';

function row<K extends 'tasks' | 'milestones' | 'risks'>(
  snapshot: DatabaseSnapshot,
  entity: K,
  index: number,
): DatabaseSnapshot[K][number] {
  const value = snapshot[entity][index];
  if (value === undefined) {
    throw new Error(`完整夹具缺少 ${entity}[${String(index)}]`);
  }
  return value;
}

describe('CSV 导出完整覆盖', () => {
  it('逐字节验证 UTF-8 BOM 且记录换行全部为 CRLF', async () => {
    const harness = createTransferHarness();
    try {
      seedSnapshot(harness.db);
      const csv = createCsv('tasks', await harness.repository.readSnapshot(), null);
      const bytes = new TextEncoder().encode(csv);

      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(csv).toMatch(/\r\n/);
      expect(csv.replaceAll('\r\n', '')).not.toContain('\n');
      expect(csv.endsWith('\r\n')).toBe(true);
    } finally {
      harness.db.close();
    }
  });

  it('逗号、双引号和字段内换行按 RFC 4180 转义', async () => {
    const harness = createTransferHarness();
    try {
      const snapshot = cloneSnapshot();
      const task = row(snapshot, 'tasks', 0);
      task.title = '含,逗号';
      task.description = '含"双引号"\n与换行';
      seedSnapshot(harness.db, snapshot);

      const csv = createCsv('tasks', await harness.repository.readSnapshot(), null);

      expect(csv).toContain('"含,逗号"');
      expect(csv).toContain('"含""双引号""\n与换行"');
    } finally {
      harness.db.close();
    }
  });

  it.each([
    ['=', '=1+1'],
    ['+', '+SUM(A1:A2)'],
    ['-', '-1+2'],
    ['@', '@命令'],
  ])('%s 开头字段被中和以防公式注入', async (_prefix, title) => {
    const harness = createTransferHarness();
    try {
      const snapshot = cloneSnapshot();
      row(snapshot, 'tasks', 0).title = title;
      seedSnapshot(harness.db, snapshot);

      const csv = createCsv('tasks', await harness.repository.readSnapshot(), null);

      expect(csv).toContain(`'${title}`);
    } finally {
      harness.db.close();
    }
  });

  it('逐一映射任务状态、优先级、里程碑状态、风险等级与状态', async () => {
    const harness = createTransferHarness();
    try {
      const snapshot = cloneSnapshot();
      const taskTemplate = row(snapshot, 'tasks', 0);
      const taskStatuses = [
        'todo',
        'in_progress',
        'blocked',
        'postponed',
        'done',
        'cancelled',
      ] as const;
      const priorities = ['low', 'medium', 'high', 'urgent'] as const;
      snapshot.tasks = taskStatuses.map((status, index) => ({
        ...taskTemplate,
        id: `csv-task-${status}`,
        parent_task_id: null,
        title: `状态 ${status}`,
        status,
        priority: priorities[index % priorities.length] ?? 'medium',
        completed_at: status === 'done' ? '2026-07-18T08:00:00Z' : null,
      }));
      snapshot.taskDependencies = [];
      snapshot.taskParticipants = [];
      snapshot.taskMeetings = [];
      snapshot.actionItems = snapshot.actionItems.map((item) => ({
        ...item,
        converted_task_id: null,
        converted_at: null,
      }));

      const milestoneTemplate = row(snapshot, 'milestones', 0);
      const milestoneStatuses = ['upcoming', 'achieved', 'missed', 'cancelled'] as const;
      snapshot.milestones = milestoneStatuses.map((status) => ({
        ...milestoneTemplate,
        id: `csv-milestone-${status}`,
        linked_task_id: null,
        name: `里程碑 ${status}`,
        status,
        achieved_at: status === 'achieved' ? '2026-07-18T08:00:00Z' : null,
      }));

      const riskTemplate = row(snapshot, 'risks', 0);
      const riskVariants = [
        ['low', 'low', 'low', 'open', null],
        ['medium', 'medium', 'medium', 'monitoring', null],
        ['high', 'medium', 'high', 'mitigated', '2026-07-18T08:00:00Z'],
        ['high', 'high', 'critical', 'closed', '2026-07-18T08:00:00Z'],
      ] as const;
      snapshot.risks = riskVariants.map(
        ([likelihood, impact, level, status, resolved_at], index) => ({
          ...riskTemplate,
          id: `csv-risk-${String(index)}`,
          title: `风险 ${String(index)}`,
          likelihood,
          impact,
          level,
          status,
          resolved_at,
        }),
      );
      snapshot.projectLinks = snapshot.projectLinks.map((link) => ({ ...link, task_id: null }));
      snapshot.taskProgressUpdates = [];
      snapshot.taskChecklistItems = [];
      seedSnapshot(harness.db, snapshot);
      const persisted = await harness.repository.readSnapshot();

      const taskCsv = createCsv('tasks', persisted, null);
      for (const label of ['待办', '进行中', '受阻', '已推迟', '已完成', '已取消']) {
        expect(taskCsv).toContain(label);
      }
      for (const label of ['低', '中', '高', '紧急']) {
        expect(taskCsv).toContain(label);
      }

      const milestoneCsv = createCsv('milestones', persisted, null);
      for (const label of ['待达成', '已达成', '已错过', '已取消']) {
        expect(milestoneCsv).toContain(label);
      }

      const riskCsv = createCsv('risks', persisted, null);
      for (const label of ['低', '中', '高', '严重']) {
        expect(riskCsv).toContain(label);
      }
      for (const label of ['开放', '监控中', '已缓解', '已关闭']) {
        expect(riskCsv).toContain(label);
      }
    } finally {
      harness.db.close();
    }
  });

  it.each([
    ['tasks', '任务 ID'],
    ['milestones', '里程碑 ID'],
    ['risks', '风险 ID'],
  ] as const)('%s 空库仍输出合法中文表头', async (entity, header) => {
    const harness = createTransferHarness();
    try {
      const csv = createCsv(entity, await harness.repository.readSnapshot(), null);
      expect(csv.startsWith(`\uFEFF${header},`)).toBe(true);
      expect(csv.split('\r\n')).toHaveLength(2);
    } finally {
      harness.db.close();
    }
  });

  it('任务父任务列与来源会议列在有值和无值时均准确', async () => {
    const harness = createTransferHarness();
    try {
      seedSnapshot(harness.db);
      const csv = createCsv('tasks', await harness.repository.readSnapshot(), null);
      const lines = csv.split('\r\n');
      const root = lines.find((line) => line.startsWith('task-root,'));
      const child = lines.find((line) => line.startsWith('task-child,'));

      expect(root).toContain(',,父任务,');
      expect(root).toContain(',meeting-project,');
      expect(child).toContain(',task-root,子任务,');
      expect(child).toContain(',,否,');
    } finally {
      harness.db.close();
    }
  });
});
