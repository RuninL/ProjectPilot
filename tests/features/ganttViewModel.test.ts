import { describe, expect, it } from 'vitest';
import {
  buildGanttViewModel,
  GANTT_ROW_HEIGHT,
  type GanttMilestone,
  type GanttTaskRow,
  type GanttTask,
} from '@/features/gantt/ganttViewModel';
import type { GraphEdgeInput } from '@/services/dependencyGraph';

/** Geometry only — no React, no DOM. Dates in, pixels out. */

const TODAY = '2026-08-12';

function task(id: string, overrides: Partial<GanttTask> = {}): GanttTask {
  return {
    id,
    title: `任务 ${id}`,
    status: 'todo',
    start_date: null,
    due_date: null,
    archived_at: null,
    parent_task_id: null,
    ...overrides,
  };
}

function build(params: {
  tasks: readonly GanttTask[];
  dependencies?: readonly GraphEdgeInput[];
  conflicts?: readonly { edgeId: string; successorId: string }[];
  risks?: readonly { taskId: string; blockedBy: readonly string[] }[];
  scale?: 'week' | 'month' | 'quarter';
  today?: string;
  milestones?: readonly GanttMilestone[];
}) {
  return buildGanttViewModel({
    tasks: params.tasks,
    dependencies: params.dependencies ?? [],
    conflicts: (params.conflicts ?? []).map((conflict) => ({
      edgeId: conflict.edgeId,
      predecessorId: 'ignored',
      successorId: conflict.successorId,
      predecessorDueDate: '2026-08-10',
      successorStartDate: '2026-08-01',
    })),
    blockedRisks: params.risks ?? [],
    scale: params.scale ?? 'month',
    today: params.today ?? TODAY,
    ...(params.milestones === undefined ? {} : { milestones: params.milestones }),
  });

  describe('buildGanttViewModel — milestones', () => {
    const milestone = (id: string, overrides: Partial<GanttMilestone> = {}): GanttMilestone => ({
      id,
      name: `里程碑 ${id}`,
      date: '2026-08-16',
      status: 'upcoming',
      linked_task_id: null,
      ...overrides,
    });

    it('renders milestones as distinct rows at their date coordinate and extends the range', () => {
      const model = build({
        tasks: [task('a', { start_date: '2026-08-03' })],
        milestones: [milestone('m', { date: '2026-10-03' })],
      });
      const row = model.rows.find((item) => item.kind === 'milestone');

      expect(row).toMatchObject({ kind: 'milestone', milestoneId: 'm', date: '2026-10-03' });
      expect(row?.kind === 'milestone' && row.x).toBe(63 * model.dayWidth);
      expect(model.rangeEnd).toBe('2026-10-31');
    });

    it('builds a valid non-empty model for a project containing only milestones', () => {
      const model = build({ tasks: [], milestones: [milestone('m')] });

      expect(model.isEmpty).toBe(false);
      expect(model.rows[0]).toMatchObject({ kind: 'milestone', milestoneId: 'm' });
      expect(model.links).toEqual([]);
    });

    it('places linked milestones after the linked task subtree and unlinked milestones by date and name', () => {
      const model = build({
        tasks: [
          task('parent', { start_date: '2026-08-01' }),
          task('child', { start_date: '2026-08-02', parent_task_id: 'parent' }),
        ],
        milestones: [
          milestone('attached', { linked_task_id: 'parent', name: '关联' }),
          milestone('later', { date: '2026-08-20', name: '乙' }),
          milestone('earlier', { date: '2026-08-19', name: '甲' }),
        ],
      });

      expect(model.rows.map((row) => (row.kind === 'task' ? row.taskId : row.milestoneId))).toEqual(
        ['parent', 'child', 'attached', 'earlier', 'later'],
      );
    });

    it('safely degrades an unavailable linked task without adding dependency links', () => {
      const model = build({
        tasks: [task('a', { start_date: '2026-08-03' })],
        milestones: [milestone('missing', { linked_task_id: 'gone', status: 'cancelled' })],
      });
      const row = model.rows.find((item) => item.kind === 'milestone');

      expect(row).toMatchObject({
        linkedTaskId: 'gone',
        linkedTaskTitle: null,
        status: 'cancelled',
      });
      expect(model.links).toEqual([]);
    });
  });
}

function taskRow(
  row: ReturnType<typeof build>['rows'][number] | undefined,
): GanttTaskRow | undefined {
  return row?.kind === 'task' ? row : undefined;
}

describe('buildGanttViewModel — empty and undated projects', () => {
  it('marks a project with no tasks as empty but still draws a range around today', () => {
    const model = build({ tasks: [] });

    expect(model.isEmpty).toBe(true);
    expect(model.rows).toEqual([]);
    expect(model.rangeStart).toBe('2026-08-01');
    expect(model.rangeEnd).toBe('2026-08-31');
    expect(model.ticks).toHaveLength(1);
    expect(model.todayX).not.toBeNull();
  });

  it('lists tasks without a start date instead of dropping them silently', () => {
    const model = build({ tasks: [task('a'), task('b', { due_date: '2026-08-20' })] });

    expect(model.isEmpty).toBe(true);
    expect(model.undated.map((entry) => entry.taskId)).toEqual(['a', 'b']);
  });

  it('excludes archived tasks from both the bars and the undated notice', () => {
    const model = build({
      tasks: [
        task('live', { start_date: '2026-08-03' }),
        task('gone', { archived_at: '2026-07-01T00:00:00Z' }),
      ],
    });

    expect(model.rows.filter((row) => row.kind === 'task').map((row) => row.taskId)).toEqual([
      'live',
    ]);
    expect(model.undated).toEqual([]);
  });
});

describe('buildGanttViewModel — bars', () => {
  it('places a bar at its start date with an inclusive width', () => {
    const model = build({
      tasks: [task('a', { start_date: '2026-08-03', due_date: '2026-08-05' })],
    });
    const row = taskRow(model.rows[0]);

    expect(model.rangeStart).toBe('2026-08-01');
    expect(row?.bar.x).toBe(2 * model.dayWidth);
    expect(row?.bar.width).toBe(3 * model.dayWidth);
    expect(row?.singleDay).toBe(false);
  });

  it('draws a single-day bar when the due date is missing', () => {
    const model = build({ tasks: [task('a', { start_date: '2026-08-03' })] });
    const row = taskRow(model.rows[0]);

    expect(row?.singleDay).toBe(true);
    expect(row?.bar.width).toBe(model.dayWidth);
    expect(row?.endDate).toBe('2026-08-03');
  });

  it('clamps a due date that precedes the start date to a single day', () => {
    const model = build({
      tasks: [task('a', { start_date: '2026-08-10', due_date: '2026-08-01' })],
    });

    expect(taskRow(model.rows[0])?.endDate).toBe('2026-08-10');
    expect(taskRow(model.rows[0])?.bar.width).toBe(model.dayWidth);
  });

  it('stacks rows in input order at a fixed row height', () => {
    const model = build({
      tasks: [
        task('a', { start_date: '2026-08-03' }),
        task('b', { start_date: '2026-08-04' }),
        task('c', { start_date: '2026-08-05' }),
      ],
    });

    expect(model.rows.map((row) => row.rowIndex)).toEqual([0, 1, 2]);
    expect(model.rows.map((row) => row.y)).toEqual([0, GANTT_ROW_HEIGHT, GANTT_ROW_HEIGHT * 2]);
    expect(model.height).toBe(GANTT_ROW_HEIGHT * 3);
  });

  it('flags conflicted successors and names blocked upstream tasks by title', () => {
    const model = build({
      tasks: [
        task('a', { start_date: '2026-08-03', status: 'blocked', title: '设计' }),
        task('b', { start_date: '2026-08-04', title: '开发' }),
      ],
      dependencies: [{ id: 'e1', predecessor_id: 'a', successor_id: 'b' }],
      conflicts: [{ edgeId: 'e1', successorId: 'b' }],
      risks: [{ taskId: 'b', blockedBy: ['a'] }],
    });
    const successor = taskRow(model.rows[1]);

    expect(successor?.hasConflict).toBe(true);
    expect(successor?.blockedBy).toEqual(['设计']);
    expect(taskRow(model.rows[0])?.hasConflict).toBe(false);
  });
});

describe('buildGanttViewModel — scales and ticks', () => {
  it('pads the range to whole months and labels each month', () => {
    const model = build({
      tasks: [task('a', { start_date: '2026-08-03', due_date: '2026-10-02' })],
      scale: 'month',
    });

    expect(model.rangeStart).toBe('2026-08-01');
    expect(model.rangeEnd).toBe('2026-10-31');
    expect(model.ticks.map((tick) => tick.label)).toEqual(['2026年8月', '2026年9月', '2026年10月']);
    expect(model.ticks[0]?.x).toBe(0);
    expect(model.ticks[1]?.x).toBe(31 * model.dayWidth);
  });

  it('pads the range to whole weeks starting Monday and labels each week', () => {
    const model = build({
      tasks: [task('a', { start_date: '2026-08-12', due_date: '2026-08-18' })],
      scale: 'week',
    });

    // 2026-08-10 is a Monday; padding two days back lands in that week.
    expect(model.rangeStart).toBe('2026-08-10');
    expect(model.rangeEnd).toBe('2026-08-23');
    expect(model.ticks.map((tick) => tick.label)).toEqual(['8月10日', '8月17日']);
    expect(model.ticks[0]?.width).toBe(7 * model.dayWidth);
  });

  it('pads the range to whole quarters and labels each quarter', () => {
    const model = build({
      tasks: [task('a', { start_date: '2026-08-12', due_date: '2026-11-01' })],
      scale: 'quarter',
    });

    expect(model.rangeStart).toBe('2026-07-01');
    expect(model.rangeEnd).toBe('2026-12-31');
    expect(model.ticks.map((tick) => tick.label)).toEqual(['2026 Q3', '2026 Q4']);
  });

  it('uses a narrower day for coarser scales but keeps the same dates', () => {
    const tasks = [task('a', { start_date: '2026-08-03', due_date: '2026-08-20' })];
    const week = build({ tasks, scale: 'week' });
    const quarter = build({ tasks, scale: 'quarter' });

    expect(week.dayWidth).toBeGreaterThan(quarter.dayWidth);
    expect(taskRow(week.rows[0])?.startDate).toBe(taskRow(quarter.rows[0])?.startDate);
    expect(week.width).toBeGreaterThan(0);
    expect(quarter.width).toBeGreaterThan(0);
  });

  it('crosses a year boundary without losing days', () => {
    const model = build({
      tasks: [task('a', { start_date: '2026-12-20', due_date: '2027-01-10' })],
      scale: 'month',
      today: '2026-12-25',
    });

    expect(model.rangeStart).toBe('2026-12-01');
    expect(model.rangeEnd).toBe('2027-01-31');
    expect(taskRow(model.rows[0])?.bar.width).toBe(22 * model.dayWidth);
  });
});

describe('buildGanttViewModel — today line', () => {
  it('positions the today marker inside the range', () => {
    const model = build({
      tasks: [task('a', { start_date: '2026-08-10', due_date: '2026-08-20' })],
      today: '2026-08-15',
    });

    expect(model.todayX).toBe(14 * model.dayWidth);
  });

  it('focuses the latest data boundary when today is later than the project range', () => {
    const model = build({
      tasks: [task('a', { start_date: '2026-05-04', due_date: '2026-05-08' })],
      today: '2026-08-12',
    });

    expect(model.rangeStart).toBe('2026-05-01');
    expect(model.rangeEnd).toBe('2026-05-31');
    expect(model.todayX).toBeNull();
    expect(model.focusX).toBe(model.width);
  });

  it('focuses the earliest data boundary when today is earlier than the project range', () => {
    const model = build({
      tasks: [task('a', { start_date: '2026-11-04', due_date: '2026-11-08' })],
      today: '2026-08-12',
    });

    expect(model.rangeStart).toBe('2026-11-01');
    expect(model.todayX).toBeNull();
    expect(model.focusX).toBe(0);
  });
});

describe('buildGanttViewModel — dependency links', () => {
  it('draws an elbow from the predecessor end to the successor start', () => {
    const model = build({
      tasks: [
        task('a', { start_date: '2026-08-03', due_date: '2026-08-05' }),
        task('b', { start_date: '2026-08-10', due_date: '2026-08-12' }),
      ],
      dependencies: [{ id: 'e1', predecessor_id: 'a', successor_id: 'b' }],
    });
    const link = model.links[0];
    const from = taskRow(model.rows[0]);
    const to = taskRow(model.rows[1]);

    expect(model.links).toHaveLength(1);
    expect(link?.points).toHaveLength(4);
    expect(link?.points[0]).toEqual({
      x: (from?.bar.x ?? 0) + (from?.bar.width ?? 0),
      y: (from?.bar.y ?? 0) + (from?.bar.height ?? 0) / 2,
    });
    expect(link?.points[3]).toEqual({
      x: to?.bar.x,
      y: (to?.bar.y ?? 0) + (to?.bar.height ?? 0) / 2,
    });
    expect(link?.hasConflict).toBe(false);
  });

  it('marks a link as conflicted when its edge is in the conflict list', () => {
    const model = build({
      tasks: [
        task('a', { start_date: '2026-08-10', due_date: '2026-08-20' }),
        task('b', { start_date: '2026-08-12' }),
      ],
      dependencies: [{ id: 'e1', predecessor_id: 'a', successor_id: 'b' }],
      conflicts: [{ edgeId: 'e1', successorId: 'b' }],
    });

    expect(model.links[0]?.hasConflict).toBe(true);
  });

  it('skips links whose endpoints are not drawn', () => {
    const model = build({
      tasks: [task('a', { start_date: '2026-08-03' }), task('undated')],
      dependencies: [{ id: 'e1', predecessor_id: 'a', successor_id: 'undated' }],
    });

    expect(model.links).toEqual([]);
    expect(model.undated.map((entry) => entry.taskId)).toEqual(['undated']);
  });
});

describe('buildGanttViewModel — performance', () => {
  it('lays out about 1000 tasks and their links quickly', () => {
    const count = 1000;
    const tasks: GanttTask[] = Array.from({ length: count }, (_, index) =>
      task(`n${String(index)}`, {
        start_date: `2026-08-${String((index % 28) + 1).padStart(2, '0')}`,
        due_date: '2026-09-15',
      }),
    );
    const dependencies: GraphEdgeInput[] = Array.from({ length: count - 1 }, (_, index) => ({
      id: `e${String(index)}`,
      predecessor_id: `n${String(index)}`,
      successor_id: `n${String(index + 1)}`,
    }));
    const milestones: GanttMilestone[] = Array.from({ length: 100 }, (_, index) => ({
      id: `m${String(index)}`,
      name: `里程碑 ${String(index)}`,
      date: `2026-09-${String((index % 28) + 1).padStart(2, '0')}`,
      status: 'upcoming',
      linked_task_id: index % 2 === 0 ? `n${String(index)}` : null,
    }));

    const started = performance.now();
    const model = buildGanttViewModel({
      tasks,
      dependencies,
      conflicts: [],
      blockedRisks: [],
      milestones,
      scale: 'month',
      today: TODAY,
    });
    const elapsed = performance.now() - started;

    expect(model.rows).toHaveLength(count + milestones.length);
    expect(model.links).toHaveLength(count - 1);
    expect(model.height).toBe((count + milestones.length) * GANTT_ROW_HEIGHT);
    // Generous ceiling; the measured run is far below it.
    expect(elapsed).toBeLessThan(1500);
  });
});
