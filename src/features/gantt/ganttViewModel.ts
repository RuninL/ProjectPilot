import {
  addDays,
  formatDayLabel,
  formatMonthLabel,
  formatQuarterLabel,
  inclusiveDays,
  startOfMonthStr,
  startOfNextMonthStr,
  startOfQuarterStr,
  startOfWeekStr,
} from '@/lib/date';
import type { BlockedRisk, GraphEdgeInput, ScheduleConflict } from '@/services/dependencyGraph';
import type { GanttScale } from '@/stores/useGanttStore';
import type { Task, TaskStatus } from '@/types';

/**
 * Gantt geometry as pure data: dates in, pixel coordinates out.
 *
 * Nothing here imports React or touches the DOM, so every rule below —
 * range padding, tick generation, bar placement, the today line, dependency
 * elbows — is unit-testable without rendering anything. The renderer only maps
 * these numbers onto SVG elements and picks colours.
 *
 * Coordinate space: x = 0 is `rangeStart`, one calendar day is `dayWidth` wide,
 * and row `i` occupies y from `i * rowHeight` to `(i + 1) * rowHeight`. Task
 * labels live in their own fixed column outside this space so the timeline can
 * scroll horizontally without the names sliding away.
 */

export type GanttTask = Pick<
  Task,
  'id' | 'title' | 'status' | 'start_date' | 'due_date' | 'archived_at'
>;

export interface GanttTick {
  /** Stable key: the first date of the period. */
  readonly key: string;
  readonly label: string;
  readonly x: number;
  readonly width: number;
}

export interface GanttBar {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GanttRow {
  readonly taskId: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly rowIndex: number;
  /** Top of the row band, for the label column and row striping. */
  readonly y: number;
  readonly bar: GanttBar;
  readonly startDate: string;
  /** Bar end (inclusive). Equals `startDate` when the task has no due date. */
  readonly endDate: string;
  /** True when the bar spans a single day because `due_date` is missing. */
  readonly singleDay: boolean;
  /** This task starts before a predecessor is due. */
  readonly hasConflict: boolean;
  /** Titles of blocked upstream tasks, empty when there is no risk. */
  readonly blockedBy: readonly string[];
}

export interface GanttLink {
  readonly id: string;
  readonly predecessorId: string;
  readonly successorId: string;
  /** Orthogonal elbow from the predecessor's right edge to the successor's left edge. */
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly hasConflict: boolean;
}

/** A task that cannot be drawn, with the reason to show the user. */
export interface GanttUndatedTask {
  readonly taskId: string;
  readonly title: string;
  readonly status: TaskStatus;
}

export interface GanttViewModel {
  readonly scale: GanttScale;
  readonly rangeStart: string;
  /** Inclusive last day of the drawn range. */
  readonly rangeEnd: string;
  readonly dayWidth: number;
  readonly rowHeight: number;
  readonly labelWidth: number;
  readonly headerHeight: number;
  /** Timeline width in pixels, excluding the label column. */
  readonly width: number;
  readonly height: number;
  readonly ticks: readonly GanttTick[];
  readonly rows: readonly GanttRow[];
  readonly links: readonly GanttLink[];
  /** x of the today marker, or null when today falls outside the range. */
  readonly todayX: number | null;
  readonly undated: readonly GanttUndatedTask[];
  /** True when no task could be drawn — the renderer shows an empty state. */
  readonly isEmpty: boolean;
}

const DAY_WIDTH: Record<GanttScale, number> = { week: 24, month: 8, quarter: 3 };
export const GANTT_ROW_HEIGHT = 32;
export const GANTT_BAR_HEIGHT = 18;
export const GANTT_LABEL_WIDTH = 176;
export const GANTT_HEADER_HEIGHT = 28;
/** Horizontal stub before a dependency line turns towards its successor. */
const ELBOW = 8;
/** Days of padding on each side so bars never touch the chart edge. */
const RANGE_PADDING_DAYS = 2;

export const GANTT_SCALE_LABELS: Record<GanttScale, string> = {
  week: '周',
  month: '月',
  quarter: '季度',
};

function isDrawable(task: GanttTask): boolean {
  return task.archived_at === null && task.start_date !== null;
}

/** Bar end: the due date, or the start date for a task with no due date. */
function barEnd(task: GanttTask, start: string): string {
  if (task.due_date === null || task.due_date < start) {
    return start;
  }
  return task.due_date;
}

function periodStart(date: string, scale: GanttScale): string {
  if (scale === 'week') {
    return startOfWeekStr(date);
  }
  if (scale === 'month') {
    return startOfMonthStr(date);
  }
  return startOfQuarterStr(date);
}

/** First day of the period after the one containing `date`. */
function nextPeriodStart(date: string, scale: GanttScale): string {
  if (scale === 'week') {
    return addDays(startOfWeekStr(date), 7);
  }
  if (scale === 'month') {
    return startOfNextMonthStr(date);
  }
  const quarter = startOfQuarterStr(date);
  return startOfNextMonthStr(startOfNextMonthStr(startOfNextMonthStr(quarter)));
}

function tickLabel(date: string, scale: GanttScale): string {
  if (scale === 'week') {
    return formatDayLabel(date);
  }
  if (scale === 'month') {
    return formatMonthLabel(date);
  }
  return formatQuarterLabel(date);
}

function buildTicks(
  rangeStart: string,
  rangeEnd: string,
  scale: GanttScale,
  dayWidth: number,
): GanttTick[] {
  const ticks: GanttTick[] = [];
  let cursor = rangeStart;
  // The range is padded to period boundaries, so this always lands on rangeEnd + 1.
  while (cursor <= rangeEnd) {
    const next = nextPeriodStart(cursor, scale);
    const offset = inclusiveDays(rangeStart, cursor) - 1;
    ticks.push({
      key: cursor,
      label: tickLabel(cursor, scale),
      x: offset * dayWidth,
      width: inclusiveDays(cursor, addDays(next, -1)) * dayWidth,
    });
    cursor = next;
  }
  return ticks;
}

/**
 * Project the given tasks onto a timeline.
 *
 * Tasks without a `start_date` — and archived tasks — are not drawn; they are
 * returned in `undated` so the UI can say so in words instead of silently
 * hiding rows. `today` is always inside the range, which keeps the today line
 * meaningful for a project scheduled entirely in the past or future.
 */
export function buildGanttViewModel(params: {
  readonly tasks: readonly GanttTask[];
  readonly dependencies: readonly GraphEdgeInput[];
  readonly conflicts: readonly ScheduleConflict[];
  readonly blockedRisks: readonly BlockedRisk[];
  readonly scale: GanttScale;
  readonly today: string;
}): GanttViewModel {
  const { scale, today } = params;
  const dayWidth = DAY_WIDTH[scale];
  const drawable = params.tasks.filter(isDrawable);
  const undated: GanttUndatedTask[] = params.tasks
    .filter((task) => task.archived_at === null && task.start_date === null)
    .map((task) => ({ taskId: task.id, title: task.title, status: task.status }));

  const titleOf = new Map(params.tasks.map((task) => [task.id, task.title]));
  const conflictSuccessors = new Set(params.conflicts.map((conflict) => conflict.successorId));
  const conflictEdges = new Set(params.conflicts.map((conflict) => conflict.edgeId));
  const riskByTask = new Map(params.blockedRisks.map((risk) => [risk.taskId, risk.blockedBy]));

  if (drawable.length === 0) {
    const rangeStart = periodStart(today, scale);
    const rangeEnd = addDays(nextPeriodStart(today, scale), -1);
    const ticks = buildTicks(rangeStart, rangeEnd, scale, dayWidth);
    return {
      scale,
      rangeStart,
      rangeEnd,
      dayWidth,
      rowHeight: GANTT_ROW_HEIGHT,
      labelWidth: GANTT_LABEL_WIDTH,
      headerHeight: GANTT_HEADER_HEIGHT,
      width: inclusiveDays(rangeStart, rangeEnd) * dayWidth,
      height: 0,
      ticks,
      rows: [],
      links: [],
      todayX: (inclusiveDays(rangeStart, today) - 1) * dayWidth,
      undated,
      isEmpty: true,
    };
  }

  let earliest = drawable[0]?.start_date ?? today;
  let latest = earliest;
  for (const task of drawable) {
    const start = task.start_date ?? today;
    const end = barEnd(task, start);
    if (start < earliest) {
      earliest = start;
    }
    if (end > latest) {
      latest = end;
    }
  }
  // Today stays inside the range so its marker is always reachable by scrolling.
  if (today < earliest) {
    earliest = today;
  }
  if (today > latest) {
    latest = today;
  }

  const rangeStart = periodStart(addDays(earliest, -RANGE_PADDING_DAYS), scale);
  const rangeEnd = addDays(nextPeriodStart(addDays(latest, RANGE_PADDING_DAYS), scale), -1);
  const xOf = (date: string): number => (inclusiveDays(rangeStart, date) - 1) * dayWidth;

  const rows: GanttRow[] = drawable.map((task, rowIndex) => {
    const startDate = task.start_date ?? today;
    const endDate = barEnd(task, startDate);
    const y = rowIndex * GANTT_ROW_HEIGHT;
    return {
      taskId: task.id,
      title: task.title,
      status: task.status,
      rowIndex,
      y,
      bar: {
        x: xOf(startDate),
        y: y + (GANTT_ROW_HEIGHT - GANTT_BAR_HEIGHT) / 2,
        width: inclusiveDays(startDate, endDate) * dayWidth,
        height: GANTT_BAR_HEIGHT,
      },
      startDate,
      endDate,
      singleDay: task.due_date === null,
      hasConflict: conflictSuccessors.has(task.id),
      blockedBy: (riskByTask.get(task.id) ?? []).map((id) => titleOf.get(id) ?? id),
    };
  });

  const rowByTask = new Map(rows.map((row) => [row.taskId, row]));
  const links: GanttLink[] = [];
  for (const dependency of params.dependencies) {
    const from = rowByTask.get(dependency.predecessor_id);
    const to = rowByTask.get(dependency.successor_id);
    if (from === undefined || to === undefined) {
      continue;
    }
    const fromX = from.bar.x + from.bar.width;
    const fromY = from.bar.y + from.bar.height / 2;
    const toX = to.bar.x;
    const toY = to.bar.y + to.bar.height / 2;
    const turnX = Math.max(fromX + ELBOW, toX - ELBOW);
    links.push({
      id: dependency.id,
      predecessorId: dependency.predecessor_id,
      successorId: dependency.successor_id,
      points: [
        { x: fromX, y: fromY },
        { x: turnX, y: fromY },
        { x: turnX, y: toY },
        { x: toX, y: toY },
      ],
      hasConflict: conflictEdges.has(dependency.id),
    });
  }

  return {
    scale,
    rangeStart,
    rangeEnd,
    dayWidth,
    rowHeight: GANTT_ROW_HEIGHT,
    labelWidth: GANTT_LABEL_WIDTH,
    headerHeight: GANTT_HEADER_HEIGHT,
    width: inclusiveDays(rangeStart, rangeEnd) * dayWidth,
    height: rows.length * GANTT_ROW_HEIGHT,
    ticks: buildTicks(rangeStart, rangeEnd, scale, dayWidth),
    rows,
    links,
    todayX: today >= rangeStart && today <= rangeEnd ? xOf(today) : null,
    undated,
    isEmpty: false,
  };
}
