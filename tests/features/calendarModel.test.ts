import { describe, expect, it } from 'vitest';
import {
  buildCalendarMonth,
  buildCalendarColorBar,
  CALENDAR_GRID_DAYS,
  DEFAULT_CALENDAR_BAR_COLOR,
  gridDayCount,
  monthGridRange,
  monthOf,
  shiftMonth,
  safeCalendarColor,
  type CalendarData,
} from '@/features/calendar/calendarModel';
import type { TaskWithProject } from '@/types';
import { makeMeeting, makeMilestone, makeProject, makeTask } from '../helpers/fixtures';

const TODAY = '2026-07-14';

function withProject(task: Partial<TaskWithProject> = {}): TaskWithProject {
  return {
    ...makeTask(),
    project_name: '示例项目',
    project_color: '#2563EB',
    project_status: 'active',
    ...task,
  };
}

function data(overrides: Partial<CalendarData> = {}): CalendarData {
  return {
    tasks: [],
    meetings: [],
    milestones: [],
    projects: [makeProject({ id: 'p1', name: '示例项目', color: '#2563EB' })],
    ...overrides,
  };
}

function dayOf(month: ReturnType<typeof buildCalendarMonth>, date: string) {
  const day = month.weeks.flat().find((candidate) => candidate.date === date);
  if (day === undefined) {
    throw new Error(`${date} 不在 ${month.month} 的网格内`);
  }
  return day;
}

describe('month arithmetic', () => {
  it('reads the month out of a date', () => {
    expect(monthOf('2026-07-14')).toBe('2026-07');
  });

  it('steps forward and backward across year boundaries', () => {
    expect(shiftMonth('2026-07', 1)).toBe('2026-08');
    expect(shiftMonth('2026-07', -1)).toBe('2026-06');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-01', -13)).toBe('2024-12');
    expect(shiftMonth('2026-07', 12)).toBe('2027-07');
    expect(shiftMonth('2026-07', 0)).toBe('2026-07');
  });

  it('rejects a malformed month rather than guessing', () => {
    expect(() => shiftMonth('2026-7', 1)).toThrow('无效月份：2026-7');
    expect(() => shiftMonth('2026-07-14', 1)).toThrow('无效月份');
  });
});

describe('grid range', () => {
  it('always spans exactly six Monday-first weeks', () => {
    for (const month of ['2026-02', '2026-07', '2027-01', '2028-02']) {
      expect(gridDayCount(month)).toBe(CALENDAR_GRID_DAYS);
      expect(gridDayCount(month)).toBe(42);
    }
  });

  it('starts on the Monday on or before the first of the month', () => {
    // 2026-07-01 is a Wednesday.
    expect(monthGridRange('2026-07')).toStrictEqual({ from: '2026-06-29', to: '2026-08-09' });
    // 2026-06-01 is itself a Monday.
    expect(monthGridRange('2026-06')).toStrictEqual({ from: '2026-06-01', to: '2026-07-12' });
  });
});

describe('buildCalendarMonth', () => {
  it('marks today and only today', () => {
    const month = buildCalendarMonth('2026-07', data(), TODAY);

    const todays = month.weeks.flat().filter((day) => day.isToday);
    expect(todays).toHaveLength(1);
    expect(todays[0]?.date).toBe(TODAY);
  });

  describe('colour-bar timeline model', () => {
    it('uses inclusive task intervals and single-day fallback dates', () => {
      const model = buildCalendarColorBar(
        data({
          tasks: [
            withProject({ id: 'span', start_date: '2026-07-03', due_date: '2026-07-08' }),
            withProject({ id: 'start', start_date: '2026-07-10', due_date: null }),
            withProject({ id: 'due', start_date: null, due_date: '2026-07-12' }),
          ],
        }),
        '2026-07-01',
        '2026-07-31',
      );

      const bars = model.lanes.flat();
      expect(bars.find((bar) => bar.taskId === 'span')).toMatchObject({
        displayStart: '2026-07-03',
        displayEnd: '2026-07-08',
      });
      expect(bars.find((bar) => bar.taskId === 'start')).toMatchObject({
        displayStart: '2026-07-10',
        displayEnd: '2026-07-10',
      });
      expect(bars.find((bar) => bar.taskId === 'due')).toMatchObject({
        displayStart: '2026-07-12',
        displayEnd: '2026-07-12',
      });
    });

    it('clips visible intervals, preserves a cross-week task identity, and packs overlaps into lanes', () => {
      const source = data({
        tasks: [
          withProject({ id: 'cross', start_date: '2026-06-20', due_date: '2026-07-08' }),
          withProject({ id: 'overlap', start_date: '2026-07-08', due_date: '2026-07-10' }),
          withProject({ id: 'separate', start_date: '2026-07-11', due_date: '2026-07-12' }),
        ],
      });
      const model = buildCalendarColorBar(source, '2026-07-01', '2026-07-31');
      const bars = model.lanes.flat();

      expect(bars.find((bar) => bar.taskId === 'cross')).toMatchObject({
        id: 'task-bar:cross',
        displayStart: '2026-07-01',
        displayEnd: '2026-07-08',
      });
      expect(bars.find((bar) => bar.taskId === 'cross')).toHaveProperty('lane', 0);
      expect(bars.find((bar) => bar.taskId === 'overlap')).toHaveProperty('lane', 1);
      expect(bars.find((bar) => bar.taskId === 'separate')).toHaveProperty('lane', 0);
    });

    it('is deterministic, exposes unscheduled tasks, and safely handles inverted dates', () => {
      const source = data({
        tasks: [
          withProject({ id: 'undated', start_date: null, due_date: null }),
          withProject({ id: 'inverted', start_date: '2026-07-20', due_date: '2026-07-10' }),
          withProject({ id: 'same-a', title: '甲', start_date: '2026-07-03', due_date: '2026-07-04' }),
          withProject({ id: 'same-b', title: '乙', start_date: '2026-07-03', due_date: '2026-07-04' }),
        ],
      });
      const first = buildCalendarColorBar(source, '2026-07-01', '2026-07-31');
      const second = buildCalendarColorBar(source, '2026-07-01', '2026-07-31');

      expect(first.lanes).toEqual(second.lanes);
      expect(first.unscheduledTasks.map((task) => task.id)).toEqual(['undated']);
      expect(first.lanes.flat().find((bar) => bar.taskId === 'inverted')).toMatchObject({
        displayStart: '2026-07-20',
        displayEnd: '2026-07-20',
      });
    });

    it('falls back to the safe default for missing or unsafe project colours', () => {
      expect(safeCalendarColor(null)).toBe(DEFAULT_CALENDAR_BAR_COLOR);
      expect(safeCalendarColor('url(javascript:alert(1))')).toBe(DEFAULT_CALENDAR_BAR_COLOR);
      expect(safeCalendarColor('#2563eb')).toBe('#2563eb');
    });
  });

  it('labels the month in Simplified Chinese', () => {
    expect(buildCalendarMonth('2026-07', data(), TODAY).label).toBe('2026年7月');
    expect(buildCalendarMonth('2026-12', data(), TODAY).label).toBe('2026年12月');
  });

  it('flags leading and trailing days as outside the month', () => {
    const month = buildCalendarMonth('2026-07', data(), TODAY);

    expect(dayOf(month, '2026-06-30').inMonth).toBe(false);
    expect(dayOf(month, '2026-07-01').inMonth).toBe(true);
    expect(dayOf(month, '2026-07-31').inMonth).toBe(true);
    expect(dayOf(month, '2026-08-01').inMonth).toBe(false);
    expect(month.weeks.flat().filter((day) => day.inMonth)).toHaveLength(31);
  });

  it('is empty for a month with nothing in it', () => {
    const month = buildCalendarMonth('2026-07', data(), TODAY);

    expect(month.entryCount).toBe(0);
    expect(month.weeks.flat().every((day) => day.entries.length === 0)).toBe(true);
  });

  it('puts all three kinds on the same day, each with its own text label', () => {
    const month = buildCalendarMonth(
      '2026-07',
      data({
        tasks: [withProject({ id: 't1', title: '写文档', due_date: TODAY })],
        meetings: [makeMeeting({ id: 'm1', date: TODAY, topic: '周会', start_time: '09:30' })],
        milestones: [makeMilestone({ id: 'ms1', date: TODAY, name: '第一阶段' })],
      }),
      TODAY,
    );

    const day = dayOf(month, TODAY);
    expect(day.entries.map((entry) => entry.kind)).toEqual(['meeting', 'milestone', 'task']);
    // Type is carried by text, never by colour alone.
    expect(day.entries.map((entry) => entry.kindLabel)).toEqual(['会议', '里程碑', '任务截止']);
    expect(day.entries.map((entry) => entry.title)).toEqual(['周会', '第一阶段', '写文档']);
    expect(new Set(day.entries.map((entry) => entry.key)).size).toBe(3);
    expect(month.entryCount).toBe(3);
  });

  it('links each kind to its own detail target', () => {
    const month = buildCalendarMonth(
      '2026-07',
      data({
        tasks: [withProject({ id: 't1', due_date: TODAY })],
        meetings: [makeMeeting({ id: 'm1', date: TODAY })],
        milestones: [makeMilestone({ id: 'ms1', project_id: 'p1', date: TODAY })],
      }),
      TODAY,
    );

    expect(dayOf(month, TODAY).entries.map((entry) => entry.href)).toEqual([
      '/meetings/m1',
      '/projects/p1#project-milestones',
      '/tasks?taskId=t1',
    ]);
  });

  it('shows a task on both its start and due day', () => {
    const month = buildCalendarMonth(
      '2026-07',
      data({
        tasks: [withProject({ id: 't1', start_date: '2026-07-06', due_date: '2026-07-20' })],
      }),
      TODAY,
    );

    expect(dayOf(month, '2026-07-06').entries.map((e) => e.kindLabel)).toEqual(['任务开始']);
    expect(dayOf(month, '2026-07-20').entries.map((e) => e.kindLabel)).toEqual(['任务截止']);
    expect(month.entryCount).toBe(2);
  });

  it('collapses a single-day task into one entry', () => {
    const month = buildCalendarMonth(
      '2026-07',
      data({ tasks: [withProject({ id: 't1', start_date: TODAY, due_date: TODAY })] }),
      TODAY,
    );

    expect(dayOf(month, TODAY).entries).toHaveLength(1);
    expect(month.entryCount).toBe(1);
  });

  it('shows an undated end of a task on the date it does have', () => {
    const month = buildCalendarMonth(
      '2026-07',
      data({
        tasks: [
          withProject({ id: 'a', start_date: '2026-07-06', due_date: null }),
          withProject({ id: 'b', start_date: null, due_date: '2026-07-08' }),
          withProject({ id: 'c', start_date: null, due_date: null }),
        ],
      }),
      TODAY,
    );

    expect(dayOf(month, '2026-07-06').entries).toHaveLength(1);
    expect(dayOf(month, '2026-07-08').entries).toHaveLength(1);
    expect(month.entryCount).toBe(2);
  });

  it('renders adjacent-month entries in the grid without counting them as this month', () => {
    const month = buildCalendarMonth(
      '2026-07',
      data({
        meetings: [
          makeMeeting({ id: 'before', date: '2026-06-30', topic: '上月' }),
          makeMeeting({ id: 'after', date: '2026-08-03', topic: '下月' }),
        ],
      }),
      TODAY,
    );

    expect(dayOf(month, '2026-06-30').entries).toHaveLength(1);
    expect(dayOf(month, '2026-08-03').entries).toHaveLength(1);
    expect(month.entryCount).toBe(0);
  });

  it('drops entries entirely outside the grid window', () => {
    const month = buildCalendarMonth(
      '2026-07',
      data({ meetings: [makeMeeting({ id: 'far', date: '2026-10-01' })] }),
      TODAY,
    );

    expect(month.weeks.flat().every((day) => day.entries.length === 0)).toBe(true);
  });

  it('handles a December grid that reaches into the next year', () => {
    const month = buildCalendarMonth(
      '2026-12',
      data({
        meetings: [makeMeeting({ id: 'ny', date: '2027-01-04', topic: '开年会' })],
        milestones: [makeMilestone({ id: 'ms1', date: '2026-12-31', name: '年终' })],
      }),
      '2026-12-31',
    );

    expect(month.rangeStart).toBe('2026-11-30');
    expect(month.rangeEnd).toBe('2027-01-10');
    expect(dayOf(month, '2027-01-04').entries).toHaveLength(1);
    expect(dayOf(month, '2026-12-31').isToday).toBe(true);
    expect(month.entryCount).toBe(1);
  });

  it('handles a January grid that reaches back into the previous year', () => {
    const month = buildCalendarMonth(
      '2027-01',
      data({ meetings: [makeMeeting({ id: 'nye', date: '2026-12-28' })] }),
      TODAY,
    );

    expect(month.rangeStart).toBe('2026-12-28');
    expect(dayOf(month, '2026-12-28').entries).toHaveLength(1);
    expect(month.weeks.flat().filter((day) => day.inMonth)).toHaveLength(31);
  });

  it('handles February in a leap year', () => {
    const month = buildCalendarMonth('2028-02', data(), TODAY);

    expect(month.weeks.flat().filter((day) => day.inMonth)).toHaveLength(29);
    expect(dayOf(month, '2028-02-29').inMonth).toBe(true);
  });

  it('names the meeting time and project, and calls an unowned meeting 独立会议', () => {
    const month = buildCalendarMonth(
      '2026-07',
      data({
        meetings: [
          makeMeeting({ id: 'a', date: TODAY, topic: '甲', start_time: '09:30', project_id: 'p1' }),
          makeMeeting({ id: 'b', date: TODAY, topic: '乙', start_time: null, project_id: null }),
        ],
      }),
      TODAY,
    );

    const details = dayOf(month, TODAY).entries.map((entry) => entry.detail);
    expect(details).toEqual(['09:30 · 示例项目', '独立会议']);
  });

  it('keeps cross-date tasks to their original start and due date entries', () => {
    const month = buildCalendarMonth(
      '2026-07',
      data({
        tasks: [
          withProject({
            id: 'span',
            title: '跨周任务',
            start_date: '2026-07-03',
            due_date: '2026-07-08',
            status: 'blocked',
          }),
        ],
        meetings: [
          makeMeeting({
            id: 'expected:rule:2026-07-08',
            topic: '周期周会',
            date: '2026-07-08',
            source_rule_id: 'rule',
            source_occurrence_date: '2026-07-08',
          }),
        ],
      }),
      TODAY,
    );

    expect(dayOf(month, '2026-07-03').entries.map((entry) => entry.title)).toContain('跨周任务');
    expect(dayOf(month, '2026-07-08').entries.map((entry) => entry.title)).toContain('跨周任务');
    expect(dayOf(month, '2026-07-06').entries.map((entry) => entry.title)).not.toContain(
      '跨周任务',
    );
    expect(dayOf(month, '2026-07-08').entries.map((entry) => entry.title)).toContain('周期周会');
  });

  it('shows the milestone status as text in its detail line', () => {
    const month = buildCalendarMonth(
      '2026-07',
      data({
        milestones: [makeMilestone({ id: 'ms1', date: TODAY, status: 'achieved' })],
      }),
      TODAY,
    );

    expect(dayOf(month, TODAY).entries[0]?.detail).toBe('已达成 · 示例项目');
  });

  it('stacks many entries on one day so the UI can decide what to fold away', () => {
    const month = buildCalendarMonth(
      '2026-07',
      data({
        meetings: Array.from({ length: 7 }, (_, index) =>
          makeMeeting({ id: `m${String(index)}`, date: TODAY, topic: `会议${String(index)}` }),
        ),
      }),
      TODAY,
    );

    expect(dayOf(month, TODAY).entries).toHaveLength(7);
    expect(month.entryCount).toBe(7);
  });
});
