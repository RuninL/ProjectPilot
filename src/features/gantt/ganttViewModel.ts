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
import type { Milestone, MilestoneStatus, Task, TaskStatus } from '@/types';

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
  'id' | 'title' | 'status' | 'start_date' | 'due_date' | 'archived_at' | 'parent_task_id'
>;
export type GanttMilestone = Pick<Milestone, 'id' | 'name' | 'date' | 'status' | 'linked_task_id'>;

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

export interface GanttTaskRow {
  readonly kind: 'task';
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

export interface GanttMilestoneRow {
  readonly kind: 'milestone';
  readonly milestoneId: string;
  readonly title: string;
  readonly date: string;
  readonly status: MilestoneStatus;
  readonly linkedTaskId: string | null;
  readonly linkedTaskTitle: string | null;
  readonly rowIndex: number;
  readonly y: number;
  readonly x: number;
}

export type GanttRow = GanttTaskRow | GanttMilestoneRow;

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
  /** x to center initially; clamped to the nearest data boundary when today is outside. */
  readonly focusX: number;
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
 * hiding rows. The drawn range follows the project data; `focusX` identifies
 * today when it is inside that range and the nearest edge otherwise.
 */
export function buildGanttViewModel(params: {
  readonly tasks: readonly GanttTask[];
  readonly dependencies: readonly GraphEdgeInput[];
  readonly conflicts: readonly ScheduleConflict[];
  readonly blockedRisks: readonly BlockedRisk[];
  readonly scale: GanttScale;
  readonly today: string;
  readonly milestones?: readonly GanttMilestone[];
}): GanttViewModel {
  const { scale, today } = params;
  const dayWidth = DAY_WIDTH[scale];
  const drawable = params.tasks.filter(isDrawable);
  const visibleMilestones = params.milestones ?? [];
  const undated: GanttUndatedTask[] = params.tasks
    .filter((task) => task.archived_at === null && task.start_date === null)
    .map((task) => ({ taskId: task.id, title: task.title, status: task.status }));

  const titleOf = new Map(params.tasks.map((task) => [task.id, task.title]));
  const conflictSuccessors = new Set(params.conflicts.map((conflict) => conflict.successorId));
  const conflictEdges = new Set(params.conflicts.map((conflict) => conflict.edgeId));
  const riskByTask = new Map(params.blockedRisks.map((risk) => [risk.taskId, risk.blockedBy]));

  if (drawable.length === 0 && visibleMilestones.length === 0) {
    const rangeStart = periodStart(today, scale);
    const rangeEnd = addDays(nextPeriodStart(today, scale), -1);
    const ticks = buildTicks(rangeStart, rangeEnd, scale, dayWidth);
    const width = inclusiveDays(rangeStart, rangeEnd) * dayWidth;
    const todayX = (inclusiveDays(rangeStart, today) - 1) * dayWidth;
    return {
      scale,
      rangeStart,
      rangeEnd,
      dayWidth,
      rowHeight: GANTT_ROW_HEIGHT,
      labelWidth: GANTT_LABEL_WIDTH,
      headerHeight: GANTT_HEADER_HEIGHT,
      width,
      height: 0,
      ticks,
      rows: [],
      links: [],
      todayX,
      focusX: todayX,
      undated,
      isEmpty: true,
    };
  }

  let earliest = drawable[0]?.start_date ?? visibleMilestones[0]?.date ?? today;
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
  for (const milestone of visibleMilestones) {
    if (milestone.date < earliest) {
      earliest = milestone.date;
    }
    if (milestone.date > latest) {
      latest = milestone.date;
    }
  }
  const rangeStart = periodStart(addDays(earliest, -RANGE_PADDING_DAYS), scale);
  const rangeEnd = addDays(nextPeriodStart(addDays(latest, RANGE_PADDING_DAYS), scale), -1);
  const xOf = (date: string): number => (inclusiveDays(rangeStart, date) - 1) * dayWidth;

  const taskRows: GanttTaskRow[] = drawable.map((task, rowIndex) => {
    const startDate = task.start_date ?? today;
    const endDate = barEnd(task, startDate);
    const y = rowIndex * GANTT_ROW_HEIGHT;
    return {
      kind: 'task',
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

  const visibleTaskIds = new Set(taskRows.map((row) => row.taskId));
  const childrenByParent = new Map<string, string[]>();
  for (const task of drawable) {
    if (task.parent_task_id !== null && visibleTaskIds.has(task.parent_task_id)) {
      const children = childrenByParent.get(task.parent_task_id) ?? [];
      children.push(task.id);
      childrenByParent.set(task.parent_task_id, children);
    }
  }
  const descendantsOf = (taskId: string): Set<string> => {
    const descendants = new Set<string>([taskId]);
    const pending = [...(childrenByParent.get(taskId) ?? [])];
    while (pending.length > 0) {
      const childId = pending.pop();
      if (childId === undefined || descendants.has(childId)) {
        continue;
      }
      descendants.add(childId);
      pending.push(...(childrenByParent.get(childId) ?? []));
    }
    return descendants;
  };
  const attached = new Map<string, GanttMilestone[]>();
  const unlinked: GanttMilestone[] = [];
  for (const milestone of visibleMilestones) {
    if (milestone.linked_task_id !== null && visibleTaskIds.has(milestone.linked_task_id)) {
      const milestones = attached.get(milestone.linked_task_id) ?? [];
      milestones.push(milestone);
      attached.set(milestone.linked_task_id, milestones);
    } else {
      unlinked.push(milestone);
    }
  }
  const sortMilestones = (milestones: GanttMilestone[]): GanttMilestone[] =>
    [...milestones].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const rows: GanttRow[] = [];
  const emittedMilestoneIds = new Set<string>();
  for (const taskRow of taskRows) {
    rows.push(taskRow);
    const descendants = descendantsOf(taskRow.taskId);
    const isFinalDescendant = !taskRows.slice(taskRow.rowIndex + 1).some((candidate) => {
      return candidate.taskId !== taskRow.taskId && descendants.has(candidate.taskId);
    });
    if (!isFinalDescendant) {
      continue;
    }
    for (const taskId of descendants) {
      for (const milestone of sortMilestones(attached.get(taskId) ?? [])) {
        if (!emittedMilestoneIds.has(milestone.id)) {
          rows.push({
            kind: 'milestone',
            milestoneId: milestone.id,
            title: milestone.name,
            date: milestone.date,
            status: milestone.status,
            linkedTaskId: milestone.linked_task_id,
            linkedTaskTitle:
              milestone.linked_task_id === null
                ? null
                : (titleOf.get(milestone.linked_task_id) ?? null),
            rowIndex: 0,
            y: 0,
            x: xOf(milestone.date),
          });
          emittedMilestoneIds.add(milestone.id);
        }
      }
    }
  }
  for (const milestone of sortMilestones(unlinked)) {
    rows.push({
      kind: 'milestone',
      milestoneId: milestone.id,
      title: milestone.name,
      date: milestone.date,
      status: milestone.status,
      linkedTaskId: milestone.linked_task_id,
      linkedTaskTitle: null,
      rowIndex: 0,
      y: 0,
      x: xOf(milestone.date),
    });
  }
  const positionedRows = rows.map((row, rowIndex) => {
    const y = rowIndex * GANTT_ROW_HEIGHT;
    return row.kind === 'task'
      ? {
          ...row,
          rowIndex,
          y,
          bar: { ...row.bar, y: y + (GANTT_ROW_HEIGHT - GANTT_BAR_HEIGHT) / 2 },
        }
      : { ...row, rowIndex, y };
  });

  const rowByTask = new Map(
    positionedRows
      .filter((row): row is GanttTaskRow => row.kind === 'task')
      .map((row) => [row.taskId, row]),
  );
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

  const width = inclusiveDays(rangeStart, rangeEnd) * dayWidth;
  const todayX = today >= rangeStart && today <= rangeEnd ? xOf(today) : null;
  const focusX = today < rangeStart ? 0 : today > rangeEnd ? width : (todayX ?? 0);

  return {
    scale,
    rangeStart,
    rangeEnd,
    dayWidth,
    rowHeight: GANTT_ROW_HEIGHT,
    labelWidth: GANTT_LABEL_WIDTH,
    headerHeight: GANTT_HEADER_HEIGHT,
    width,
    height: positionedRows.length * GANTT_ROW_HEIGHT,
    ticks: buildTicks(rangeStart, rangeEnd, scale, dayWidth),
    rows: positionedRows,
    links,
    todayX,
    focusX,
    undated,
    isEmpty: false,
  };
}
