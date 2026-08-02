import { describe, expect, it } from 'vitest';
import { buildWidgetAgenda, sevenDayRange, taskCoversDate } from '@/features/widget/widgetModel';
import { makeMeeting, makeMilestone, makeProject, makeTask } from '../helpers/fixtures';
import type { CalendarData } from '@/features/calendar/calendarModel';
import type { TaskWithProject } from '@/types';

function task(overrides: Partial<TaskWithProject> = {}): TaskWithProject {
  return {
    ...makeTask(),
    project_name: '项目',
    project_color: '#2563eb',
    project_status: 'active',
    ...overrides,
  };
}

function data(overrides: Partial<CalendarData> = {}): CalendarData {
  return { tasks: [], meetings: [], milestones: [], projects: [makeProject({ id: 'p1' })], ...overrides };
}

describe('widget calendar model', () => {
  it('uses today plus the next seven days', () => {
    const dates = sevenDayRange('2026-08-02');
    expect(dates).toHaveLength(8);
    expect(dates.at(-1)).toBe('2026-08-09');
  });

  it('includes a task across every covered date without duplicates', () => {
    const agenda = buildWidgetAgenda(
      data({ tasks: [task({ id: 'task', start_date: '2026-08-01', due_date: '2026-08-04' })] }),
      '2026-08-02',
    );
    expect(agenda.slice(0, 3).every((day) => day.bars.filter((bar) => bar.id === 'task').length === 1)).toBe(true);
    expect(agenda[3]?.bars).toHaveLength(0);
  });

  it('uses the shared date-only task coverage rules', () => {
    const scheduled = task({ start_date: '2026-08-02', due_date: '2026-08-03' });
    expect(taskCoversDate(scheduled, '2026-08-02')).toBe(true);
    expect(taskCoversDate(scheduled, '2026-08-04')).toBe(false);
  });

  it('shows today milestones and ordinary and recurring meeting instances', () => {
    const agenda = buildWidgetAgenda(
      data({
        meetings: [
          makeMeeting({ id: 'meeting', date: '2026-08-02', topic: '今日会议' }),
          makeMeeting({
            id: 'occurrence',
            date: '2026-08-02',
            topic: '重复会议',
            source_rule_id: 'rule',
            source_occurrence_date: '2026-08-02',
          }),
        ],
        milestones: [makeMilestone({ id: 'milestone', date: '2026-08-02', name: '今日里程碑' })],
      }),
      '2026-08-02',
    );
    expect(agenda[0]?.bars.map((bar) => bar.type)).toEqual(['meeting', 'meeting', 'milestone']);
  });

  it('sorts mixed items stably and excludes items outside the range', () => {
    const agenda = buildWidgetAgenda(
      data({
        tasks: [task({ id: 'task', due_date: '2026-08-02', title: '任务' })],
        meetings: [makeMeeting({ id: 'meeting', date: '2026-08-02', topic: '会议' })],
        milestones: [makeMilestone({ id: 'milestone', date: '2026-08-02', name: '里程碑' })],
      }),
      '2026-08-02',
    );
    expect(agenda[0]?.bars.map((bar) => bar.type)).toEqual(['meeting', 'milestone', 'task']);
    expect(agenda[7]?.bars).toHaveLength(0);
  });
});
