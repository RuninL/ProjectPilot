import { describe, expect, it } from 'vitest';
import { computeProjectProgress, formatProgress } from '@/services/projectProgress';
import type { Task } from '@/types';
import { makeTask } from '../helpers/fixtures';

function tasks(...specs: Partial<Task>[]): Task[] {
  return specs.map((spec, index) => makeTask({ id: `t${String(index)}`, ...spec }));
}

describe('computeProjectProgress', () => {
  it('excludes cancelled tasks from the denominator', () => {
    const progress = computeProjectProgress(
      tasks({ status: 'done' }, { status: 'done' }, { status: 'cancelled' }, { status: 'todo' }),
    );

    expect(progress).toEqual({ total: 3, done: 2, percent: 66.67 });
  });

  it('returns zeros for a project with no tasks at all', () => {
    expect(computeProjectProgress([])).toEqual({ total: 0, done: 0, percent: 0 });
  });

  it('returns zeros — not NaN — when every task is cancelled or archived', () => {
    const progress = computeProjectProgress(
      tasks({ status: 'cancelled' }, { status: 'done', archived_at: '2026-07-01T00:00:00Z' }),
    );

    expect(progress).toEqual({ total: 0, done: 0, percent: 0 });
    expect(Number.isFinite(progress.percent)).toBe(true);
  });

  it('counts archived tasks in neither the numerator nor the denominator', () => {
    const progress = computeProjectProgress(
      tasks(
        { status: 'done' },
        { status: 'done', archived_at: '2026-07-01T00:00:00Z' },
        { status: 'todo', archived_at: '2026-07-01T00:00:00Z' },
        { status: 'todo' },
      ),
    );

    expect(progress).toEqual({ total: 2, done: 1, percent: 50 });
  });

  it('weights sub-tasks exactly like top-level tasks', () => {
    const progress = computeProjectProgress(
      tasks(
        { id: 'parent', status: 'todo' },
        { id: 'c1', parent_task_id: 'parent', status: 'done' },
        { id: 'c2', parent_task_id: 'parent', status: 'done' },
        { id: 'c3', parent_task_id: 'parent', status: 'done' },
      ),
    );

    expect(progress).toEqual({ total: 4, done: 3, percent: 75 });
  });

  it('reaches 100 only when every counted task is done', () => {
    expect(computeProjectProgress(tasks({ status: 'done' }, { status: 'done' })).percent).toBe(100);
    expect(
      computeProjectProgress(tasks({ status: 'done' }, { status: 'in_progress' })).percent,
    ).toBe(50);
  });

  it('does not treat blocked or in_progress as done', () => {
    const progress = computeProjectProgress(
      tasks({ status: 'blocked' }, { status: 'in_progress' }),
    );
    expect(progress).toEqual({ total: 2, done: 0, percent: 0 });
  });
});

describe('formatProgress', () => {
  it('shows 暂无任务 when there is nothing to count', () => {
    expect(formatProgress({ total: 0, done: 0, percent: 0 })).toBe('暂无任务');
  });

  it('shows a percentage otherwise, including a real 0%', () => {
    expect(formatProgress({ total: 2, done: 0, percent: 0 })).toBe('0%');
    expect(formatProgress({ total: 3, done: 2, percent: 66.67 })).toBe('66.67%');
  });
});
