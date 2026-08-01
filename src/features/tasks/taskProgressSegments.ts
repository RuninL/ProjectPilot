import type { TaskProgressUpdate } from '@/types';

export function sortProgressSegments(updates: readonly TaskProgressUpdate[]): TaskProgressUpdate[] {
  return [...updates]
    .filter((update) => update.contribution_percent > 0)
    .sort(
      (left, right) =>
        left.occurred_at.localeCompare(right.occurred_at) ||
        left.created_at.localeCompare(right.created_at) ||
        left.id.localeCompare(right.id),
    );
}

export function progressUpdateElementId(id: string): string {
  return `task-progress-update-${id}`;
}
