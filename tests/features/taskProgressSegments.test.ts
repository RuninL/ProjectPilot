import { describe, expect, it } from 'vitest';
import {
  progressUpdateElementId,
  sortProgressSegments,
} from '@/features/tasks/components/TaskProgressSection';
import type { TaskProgressUpdate } from '@/types';
import { NOW } from '../helpers/testDb';

function update(overrides: Partial<TaskProgressUpdate>): TaskProgressUpdate {
  return {
    id: 'update',
    task_id: 'task',
    title: '进展',
    description: '',
    occurred_at: NOW,
    contribution_percent: 10,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe('task progress segments', () => {
  it('orders oldest to newest regardless of repository or timeline order', () => {
    const newest = update({ id: 'newest', occurred_at: '2026-08-03T00:00:00Z' });
    const oldest = update({ id: 'oldest', occurred_at: '2026-08-01T00:00:00Z' });
    const middle = update({ id: 'middle', occurred_at: '2026-08-02T00:00:00Z' });
    expect(sortProgressSegments([newest, middle, oldest]).map((item) => item.id)).toEqual([
      'oldest',
      'middle',
      'newest',
    ]);
    expect(sortProgressSegments([middle, oldest, newest]).map((item) => item.id)).toEqual([
      'oldest',
      'middle',
      'newest',
    ]);
  });

  it('uses creation time and then stable id for equal occurrence times', () => {
    const occurredAt = '2026-08-01T00:00:00Z';
    expect(
      sortProgressSegments([
        update({
          id: 'b',
          occurred_at: occurredAt,
          created_at: '2026-08-02T00:00:00Z',
        }),
        update({
          id: 'c',
          occurred_at: occurredAt,
          created_at: '2026-08-01T00:00:00Z',
        }),
        update({
          id: 'a',
          occurred_at: occurredAt,
          created_at: '2026-08-02T00:00:00Z',
        }),
      ]).map((item) => item.id),
    ).toEqual(['c', 'a', 'b']);
  });

  it('omits zero-width updates without changing contribution values or target identity', () => {
    const visible = update({ id: 'visible', contribution_percent: 25 });
    const zero = update({ id: 'zero', contribution_percent: 0 });
    expect(sortProgressSegments([zero, visible])).toEqual([visible]);
    expect(visible.contribution_percent).toBe(25);
    expect(progressUpdateElementId(visible.id)).toBe('task-progress-update-visible');
  });
});
