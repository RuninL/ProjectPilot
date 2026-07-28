import type { Task } from '@/types';

export interface ProjectProgress {
  /** Denominator: non-archived, non-cancelled tasks. */
  total: number;
  /** Numerator: tasks with status `done`. */
  done: number;
  /** Percent 0–100, rounded to two decimals; `0` when there is nothing to count. */
  percent: number;
}

const EMPTY: ProjectProgress = { total: 0, done: 0, percent: 0 };

/**
 * Project completion rate.
 *
 * Archived tasks are in neither the numerator nor the denominator, and
 * cancelled tasks are excluded from the denominator so abandoning work does not
 * drag the rate down. Sub-tasks count exactly as much as top-level tasks — there
 * is no weighting. An empty denominator returns zeros rather than NaN/Infinity;
 * the UI renders that as 暂无任务.
 */
export function computeProjectProgress(tasks: readonly Task[]): ProjectProgress {
  const counted = tasks.filter((task) => task.archived_at === null && task.status !== 'cancelled');
  if (counted.length === 0) {
    return EMPTY;
  }
  const done = counted.filter((task) => task.status === 'done').length;
  return {
    total: counted.length,
    done,
    // Two decimals keeps 2/3 readable as 66.67 instead of collapsing to 67.
    percent: Math.round((done / counted.length) * 10000) / 100,
  };
}

/** Percent formatted for display, or 暂无任务 when there is nothing to count. */
export function formatProgress(progress: ProjectProgress): string {
  return progress.total === 0 ? '暂无任务' : `${String(progress.percent)}%`;
}
