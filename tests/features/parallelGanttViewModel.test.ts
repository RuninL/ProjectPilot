import { describe, expect, it } from 'vitest';
import { buildParallelGanttViewModel } from '@/features/gantt/parallelGanttViewModel';
import { makeProject, makeTask } from '../helpers/fixtures';

const filters = { statuses: [], hideCompleted: false, hidePostponed: false } as const;

describe('buildParallelGanttViewModel', () => {
  it('places projects on one shared timeline across month and year boundaries', () => {
    const model = buildParallelGanttViewModel({
      projects: [
        makeProject({ id: 'a', start_date: '2026-12-30', target_end_date: '2027-01-02' }),
        makeProject({ id: 'b', start_date: '2027-01-20', target_end_date: '2027-02-03' }),
      ],
      tasks: [],
      today: '2027-01-01',
      filters,
    });

    expect(model.rows).toHaveLength(2);
    expect(model.rangeStart).toBe('2026-12-01');
    expect(model.rangeEnd).toBe('2027-02-28');
    expect(model.ticks.map((tick) => tick.key)).toEqual(['2026-12-01', '2027-01-01', '2027-02-01']);
    expect(model.todayX).toBeGreaterThan(0);
  });

  it('switches between week, month, and quarter layouts without clipping edge dates', () => {
    const project = makeProject({
      id: 'edge',
      start_date: '2026-08-03',
      target_end_date: '2026-08-31',
    });
    const week = buildParallelGanttViewModel({
      projects: [project],
      tasks: [],
      today: '2026-08-12',
      filters,
      scale: 'week',
    });
    const month = buildParallelGanttViewModel({
      projects: [project],
      tasks: [],
      today: '2026-08-12',
      filters,
      scale: 'month',
    });
    const quarter = buildParallelGanttViewModel({
      projects: [project],
      tasks: [],
      today: '2026-08-12',
      filters,
      scale: 'quarter',
    });

    expect(week.ticks.map((tick) => tick.label)).toContain('8月3日');
    expect(month.ticks.map((tick) => tick.label)).toEqual(['2026年8月', '2026年9月']);
    expect(quarter.ticks.map((tick) => tick.label)).toEqual(['2026 Q3']);
    for (const model of [week, month, quarter]) {
      const row = model.rows[0];
      expect(model.rangeStart < (row?.startDate ?? '')).toBe(true);
      expect(model.rangeEnd > (row?.endDate ?? '')).toBe(true);
      expect((row?.x ?? 0) + (row?.width ?? 0)).toBeLessThan(model.width);
    }
  });

  it('uses task dates then today as explicit missing-date fallbacks', () => {
    const model = buildParallelGanttViewModel({
      projects: [
        makeProject({ id: 'tasks', name: '任务推算' }),
        makeProject({ id: 'today', name: '完全无日期' }),
      ],
      tasks: [
        makeTask({
          id: 't',
          project_id: 'tasks',
          start_date: '2026-08-03',
          due_date: '2026-08-09',
        }),
      ],
      today: '2026-07-30',
      filters,
    });

    expect(model.rows[0]).toMatchObject({
      startDate: '2026-08-03',
      endDate: '2026-08-09',
    });
    expect(model.rows[0]?.fallback).toContain('按任务日期推算');
    expect(model.rows[1]).toMatchObject({
      startDate: '2026-07-30',
      endDate: '2026-07-30',
    });
    expect(model.rows[1]?.fallback).toContain('按可用日期或今天显示');
  });

  it('supports status filtering and independently hides completed and postponed projects', () => {
    const projects = [
      makeProject({ id: 'active', status: 'active' }),
      makeProject({ id: 'completed', status: 'completed' }),
      makeProject({ id: 'postponed', status: 'postponed' }),
    ];
    const hidden = buildParallelGanttViewModel({
      projects,
      tasks: [],
      today: '2026-07-30',
      filters: { statuses: [], hideCompleted: true, hidePostponed: true },
    });
    const selected = buildParallelGanttViewModel({
      projects,
      tasks: [],
      today: '2026-07-30',
      filters: { statuses: ['postponed'], hideCompleted: false, hidePostponed: false },
    });

    expect(hidden.rows.map((row) => row.projectId)).toEqual(['active']);
    expect(selected.rows.map((row) => row.projectId)).toEqual(['postponed']);
  });

  it('renders very short and very long projects without zero-width bars', () => {
    const model = buildParallelGanttViewModel({
      projects: [
        makeProject({ id: 'short', start_date: '2026-07-30', target_end_date: '2026-07-30' }),
        makeProject({ id: 'long', start_date: '2020-01-01', target_end_date: '2030-12-31' }),
      ],
      tasks: [],
      today: '2026-07-30',
      filters,
    });

    expect(model.rows[0]?.width).toBe(model.dayWidth);
    expect(model.rows[1]?.width).toBeGreaterThan(model.rows[0]?.width ?? 0);
  });

  it.each(['week', 'month', 'quarter'] as const)(
    'focuses today inside the %s timeline using local date-only coordinates',
    (scale) => {
      const model = buildParallelGanttViewModel({
        projects: [
          makeProject({ id: scale, start_date: '2026-08-01', target_end_date: '2026-09-30' }),
        ],
        tasks: [],
        today: '2026-08-19',
        filters,
        scale,
      });

      expect(model.todayX).not.toBeNull();
      expect(model.focusX).toBe(model.todayX);
    },
  );

  it('clamps focus to the nearest project-data edge when today is outside the range', () => {
    const past = buildParallelGanttViewModel({
      projects: [
        makeProject({ id: 'past', start_date: '2026-01-01', target_end_date: '2026-01-31' }),
      ],
      tasks: [],
      today: '2026-08-19',
      filters,
    });
    const future = buildParallelGanttViewModel({
      projects: [
        makeProject({ id: 'future', start_date: '2027-01-01', target_end_date: '2027-01-31' }),
      ],
      tasks: [],
      today: '2026-08-19',
      filters,
    });

    expect(past.todayX).toBeNull();
    expect(past.focusX).toBe(past.width);
    expect(future.todayX).toBeNull();
    expect(future.focusX).toBe(0);
  });
});
