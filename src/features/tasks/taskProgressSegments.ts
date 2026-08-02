import type { TaskProgressUpdate } from '@/types';

export interface ProgressSegmentColor {
  readonly background: string;
  readonly foreground: string;
}

const DEFAULT_SEGMENT_COLOR: ProgressSegmentColor = {
  background: '#2563eb',
  foreground: '#ffffff',
};

/**
 * Fixed hex palette for the segmented progress bar. Deliberately independent
 * of the CSS theme variables (`--primary` changes per theme and can collide
 * with a hardcoded Tailwind blue), so adjacent segments stay visually
 * distinct under every theme.
 */
export const PROGRESS_SEGMENT_COLORS: readonly ProgressSegmentColor[] = [
  DEFAULT_SEGMENT_COLOR,
  { background: '#059669', foreground: '#ffffff' },
  { background: '#d97706', foreground: '#ffffff' },
  { background: '#7c3aed', foreground: '#ffffff' },
  { background: '#dc2626', foreground: '#ffffff' },
  { background: '#0891b2', foreground: '#ffffff' },
];

let activeSegmentColors: readonly ProgressSegmentColor[] = PROGRESS_SEGMENT_COLORS;

export function setProgressSegmentPalette(colors: readonly string[] | null): void {
  activeSegmentColors =
    colors === null || colors.length !== PROGRESS_SEGMENT_COLORS.length
      ? PROGRESS_SEGMENT_COLORS
      : colors.map((background) => ({ background, foreground: '#ffffff' }));
}

export function progressSegmentColor(index: number): ProgressSegmentColor {
  const paletteIndex =
    ((index % activeSegmentColors.length) + activeSegmentColors.length) %
    activeSegmentColors.length;
  return activeSegmentColors[paletteIndex] ?? DEFAULT_SEGMENT_COLOR;
}

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
