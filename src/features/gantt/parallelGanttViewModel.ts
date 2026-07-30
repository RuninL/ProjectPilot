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
import type { GanttScale } from '@/stores/useGanttStore';
import type { Project, ProjectStatus, Task } from '@/types';

export type ParallelGanttTask = Pick<
  Task,
  'project_id' | 'status' | 'start_date' | 'due_date' | 'archived_at'
>;

export interface ParallelGanttFilters {
  readonly statuses: readonly ProjectStatus[];
  readonly hideCompleted: boolean;
  readonly hidePostponed: boolean;
}

export interface ParallelGanttTick {
  readonly key: string;
  readonly label: string;
  readonly x: number;
  readonly width: number;
}

export interface ParallelGanttRow {
  readonly projectId: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly color: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly x: number;
  readonly width: number;
  readonly y: number;
  readonly progress: number;
  readonly fallback: string | null;
}

export interface ParallelGanttViewModel {
  readonly scale: GanttScale;
  readonly rangeStart: string;
  readonly rangeEnd: string;
  readonly width: number;
  readonly height: number;
  readonly rowHeight: number;
  readonly dayWidth: number;
  readonly todayX: number;
  readonly ticks: readonly ParallelGanttTick[];
  readonly rows: readonly ParallelGanttRow[];
}

const DAY_WIDTH: Record<GanttScale, number> = { week: 16, month: 4, quarter: 2 };
export const PARALLEL_GANTT_ROW_HEIGHT = 38;
const RANGE_PADDING_DAYS = 1;

function periodStart(date: string, scale: GanttScale): string {
  if (scale === 'week') {
    return startOfWeekStr(date);
  }
  if (scale === 'month') {
    return startOfMonthStr(date);
  }
  return startOfQuarterStr(date);
}

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

function taskDates(task: ParallelGanttTask): string[] {
  if (task.archived_at !== null) {
    return [];
  }
  return [task.start_date, task.due_date].filter((date): date is string => date !== null);
}

function projectRange(
  project: Project,
  tasks: readonly ParallelGanttTask[],
  today: string,
): { start: string; end: string; fallback: string | null } {
  const dates = tasks.flatMap(taskDates).sort();
  const start = project.start_date ?? dates[0] ?? project.target_end_date ?? today;
  let end = project.target_end_date ?? dates.at(-1) ?? project.start_date ?? today;
  const messages: string[] = [];

  if (project.start_date === null) {
    messages.push(
      dates.length > 0 ? '开始日期按任务日期推算' : '缺少开始日期，按可用日期或今天显示',
    );
  }
  if (project.target_end_date === null) {
    messages.push(
      dates.length > 0 ? '结束日期按任务日期推算' : '缺少结束日期，按可用日期或今天显示',
    );
  }
  if (end < start) {
    end = start;
    messages.push('结束日期早于开始日期，按单日显示');
  }
  return { start, end, fallback: messages.length === 0 ? null : messages.join('；') };
}

function includeProject(project: Project, filters: ParallelGanttFilters): boolean {
  if (project.archived_at !== null) {
    return false;
  }
  if (filters.hideCompleted && project.status === 'completed') {
    return false;
  }
  if (filters.hidePostponed && project.status === 'postponed') {
    return false;
  }
  return filters.statuses.length === 0 || filters.statuses.includes(project.status);
}

function projectProgress(tasks: readonly ParallelGanttTask[]): number {
  const counted = tasks.filter((task) => task.archived_at === null && task.status !== 'cancelled');
  if (counted.length === 0) {
    return 0;
  }
  const done = counted.filter((task) => task.status === 'done').length;
  return Math.round((done / counted.length) * 10000) / 100;
}

export function buildParallelGanttViewModel(params: {
  readonly projects: readonly Project[];
  readonly tasks: readonly ParallelGanttTask[];
  readonly today: string;
  readonly filters: ParallelGanttFilters;
  readonly scale?: GanttScale;
}): ParallelGanttViewModel {
  const scale = params.scale ?? 'month';
  const dayWidth = DAY_WIDTH[scale];
  const tasksByProject = new Map<string, ParallelGanttTask[]>();
  for (const task of params.tasks) {
    const current = tasksByProject.get(task.project_id);
    if (current === undefined) {
      tasksByProject.set(task.project_id, [task]);
    } else {
      current.push(task);
    }
  }

  const ranges = params.projects
    .filter((project) => includeProject(project, params.filters))
    .map((project) => {
      const tasks = tasksByProject.get(project.id) ?? [];
      return { project, tasks, ...projectRange(project, tasks, params.today) };
    });
  const earliest = ranges.reduce(
    (date, range) => (range.start < date ? range.start : date),
    params.today,
  );
  const latest = ranges.reduce(
    (date, range) => (range.end > date ? range.end : date),
    params.today,
  );
  const rangeStart = periodStart(addDays(earliest, -RANGE_PADDING_DAYS), scale);
  const rangeEnd = addDays(nextPeriodStart(addDays(latest, RANGE_PADDING_DAYS), scale), -1);
  const xOf = (date: string): number => (inclusiveDays(rangeStart, date) - 1) * dayWidth;

  const ticks: ParallelGanttTick[] = [];
  let cursor = rangeStart;
  while (cursor <= rangeEnd) {
    const next = nextPeriodStart(cursor, scale);
    ticks.push({
      key: cursor,
      label: tickLabel(cursor, scale),
      x: xOf(cursor),
      width: inclusiveDays(cursor, addDays(next, -1)) * dayWidth,
    });
    cursor = next;
  }

  const rows = ranges.map(({ project, tasks, start, end, fallback }, index) => ({
    projectId: project.id,
    name: project.name,
    status: project.status,
    color: project.color,
    startDate: start,
    endDate: end,
    x: xOf(start),
    width: inclusiveDays(start, end) * dayWidth,
    y: index * PARALLEL_GANTT_ROW_HEIGHT,
    progress: projectProgress(tasks),
    fallback,
  }));

  return {
    scale,
    rangeStart,
    rangeEnd,
    width: inclusiveDays(rangeStart, rangeEnd) * dayWidth,
    height: rows.length * PARALLEL_GANTT_ROW_HEIGHT,
    rowHeight: PARALLEL_GANTT_ROW_HEIGHT,
    dayWidth,
    todayX: xOf(params.today),
    ticks,
    rows,
  };
}
