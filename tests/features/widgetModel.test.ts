import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR_BAR_COLOR } from '@/features/calendar/calendarModel';
import {
  barsForDate,
  buildSevenDayAgenda,
  buildTodayAgenda,
  sevenDayRange,
  taskCoversDate,
} from '@/features/widget/widgetModel';
import { makeTask } from '../helpers/fixtures';
import type { TaskWithProject } from '@/types';

function makeWidgetTask(overrides: Partial<TaskWithProject> = {}): TaskWithProject {
  return {
    ...makeTask(),
    project_name: '示例项目',
    project_color: '#2563eb',
    project_status: 'active',
    ...overrides,
  } as TaskWithProject;
}

describe('sevenDayRange', () => {
  it('近七天从今天开始，正好 7 个自然日（不是 8 天）', () => {
    expect(sevenDayRange('2026-08-02')).toEqual([
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
    ]);
  });

  it('跨月边界正确', () => {
    const range = sevenDayRange('2026-07-30');
    expect(range).toHaveLength(7);
    expect(range[0]).toBe('2026-07-30');
    expect(range[6]).toBe('2026-08-05');
  });

  it('跨年边界正确', () => {
    const range = sevenDayRange('2026-12-29');
    expect(range[6]).toBe('2027-01-04');
  });
});

describe('taskCoversDate', () => {
  it('覆盖开始日、结束日和中间日，无 off-by-one', () => {
    const task = makeWidgetTask({ start_date: '2026-08-01', due_date: '2026-08-03' });
    expect(taskCoversDate(task, '2026-07-31')).toBe(false);
    expect(taskCoversDate(task, '2026-08-01')).toBe(true);
    expect(taskCoversDate(task, '2026-08-02')).toBe(true);
    expect(taskCoversDate(task, '2026-08-03')).toBe(true);
    expect(taskCoversDate(task, '2026-08-04')).toBe(false);
  });

  it('只有截止日或只有开始日的任务按单日覆盖', () => {
    expect(
      taskCoversDate(makeWidgetTask({ start_date: null, due_date: '2026-08-02' }), '2026-08-02'),
    ).toBe(true);
    expect(
      taskCoversDate(makeWidgetTask({ start_date: '2026-08-02', due_date: null }), '2026-08-02'),
    ).toBe(true);
    expect(taskCoversDate(makeWidgetTask({ start_date: null, due_date: null }), '2026-08-02')).toBe(
      false,
    );
  });
});

describe('barsForDate', () => {
  it('同一天同一任务只出现一次', () => {
    const task = makeWidgetTask({ id: 't1', start_date: '2026-08-01', due_date: '2026-08-05' });
    const bars = barsForDate([task, task], '2026-08-02');
    expect(bars).toHaveLength(1);
    expect(bars[0]?.taskId).toBe('t1');
  });

  it('使用项目颜色并计算可读文字色；无颜色时回退安全默认色', () => {
    const colored = barsForDate(
      [makeWidgetTask({ project_color: '#2563eb', due_date: '2026-08-02' })],
      '2026-08-02',
    );
    expect(colored[0]?.color).toBe('#2563eb');
    expect(colored[0]?.textColor).not.toBe('');
    const fallback = barsForDate(
      [makeWidgetTask({ project_color: null, due_date: '2026-08-02' })],
      '2026-08-02',
    );
    expect(fallback[0]?.color).toBe(DEFAULT_CALENDAR_BAR_COLOR);
  });

  it('已完成和延期使用非颜色状态标记，标题保留', () => {
    const bars = barsForDate(
      [
        makeWidgetTask({ id: 'done', status: 'done', due_date: '2026-08-02', title: '完成任务' }),
        makeWidgetTask({
          id: 'late',
          status: 'postponed',
          due_date: '2026-08-02',
          title: '延期任务',
        }),
        makeWidgetTask({ id: 'todo', status: 'todo', due_date: '2026-08-02' }),
      ],
      '2026-08-02',
    );
    expect(bars.map((bar) => bar.statusLabel)).toEqual(['已完成', '已延期', null]);
    expect(bars[0]?.done).toBe(true);
    expect(bars[0]?.title).toBe('完成任务');
  });
});

describe('buildSevenDayAgenda / buildTodayAgenda', () => {
  it('跨日任务在窗口内正确裁剪且不丢失开始日和结束日', () => {
    const task = makeWidgetTask({
      id: 'span',
      start_date: '2026-07-30',
      due_date: '2026-08-04',
    });
    const agenda = buildSevenDayAgenda([task], '2026-08-01');
    const covered = agenda.filter((day) => day.bars.length > 0).map((day) => day.date);
    expect(covered).toEqual(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04']);
    const last = agenda.find((day) => day.date === '2026-08-04');
    expect(last?.bars[0]?.isEnd).toBe(true);
    expect(last?.bars[0]?.isStart).toBe(false);
  });

  it('今天视图显示所有日期范围覆盖今天的任务', () => {
    const today = buildTodayAgenda(
      [
        makeWidgetTask({ id: 'covers', start_date: '2026-07-25', due_date: '2026-08-10' }),
        makeWidgetTask({ id: 'not-yet', start_date: '2026-08-05', due_date: '2026-08-10' }),
      ],
      '2026-08-02',
    );
    expect(today.isToday).toBe(true);
    expect(today.bars.map((bar) => bar.taskId)).toEqual(['covers']);
  });

  it('每个七天日程日都有标签且今天被标记', () => {
    const agenda = buildSevenDayAgenda([], '2026-08-02');
    expect(agenda).toHaveLength(7);
    expect(agenda[0]?.isToday).toBe(true);
    expect(agenda.slice(1).every((day) => !day.isToday)).toBe(true);
    expect(agenda[0]?.label).toBe('8月2日');
  });
});
