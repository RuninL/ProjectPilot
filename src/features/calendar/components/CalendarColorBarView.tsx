import { Link } from 'react-router-dom';
import type { KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import {
  WEEKDAY_LABELS,
  type CalendarColorBarSegment,
  type CalendarColorBarWeek,
  type CalendarEntry,
  type CalendarMonth,
} from '../calendarModel';

interface CalendarColorBarViewProps {
  month: CalendarMonth;
  onOpenOccurrence: (entry: CalendarEntry) => void;
}

/** Row heights: compact date header plus one fixed-height track per used lane. */
const DATE_ROW_HEIGHT = '1.5rem';
const LANE_ROW_HEIGHT = '1.625rem';
const WEEK_COLUMNS = 'repeat(7, minmax(6.5rem, 1fr))';

function occurrenceEntry(segment: CalendarColorBarSegment): CalendarEntry {
  return {
    key: segment.sourceKey,
    kind: segment.kind,
    sourceId: segment.sourceKey,
    date: segment.rangeStart,
    title: segment.title,
    kindLabel: segment.kindLabel,
    detail: segment.detail,
    href: segment.href,
    color: segment.color,
    recurrence: segment.recurrence,
  };
}

function segmentLabel(segment: CalendarColorBarSegment): string {
  const range =
    segment.rangeStart === segment.rangeEnd
      ? segment.rangeStart
      : `${segment.rangeStart} 至 ${segment.rangeEnd}`;
  const parts = [
    `${segment.kindLabel}：${segment.title}`,
    segment.detail === '' ? null : segment.detail,
    range,
    segment.statusLabel === null ? null : `状态：${segment.statusLabel}`,
  ];
  return parts.filter((part): part is string => part !== null).join('；');
}

/** Activate links with Space as well as Enter, matching button semantics. */
function activateOnSpace(event: KeyboardEvent<HTMLAnchorElement>): void {
  if (event.key === ' ') {
    event.preventDefault();
    event.currentTarget.click();
  }
}

interface SegmentBarProps {
  segment: CalendarColorBarSegment;
  onOpenOccurrence: (entry: CalendarEntry) => void;
}

function SegmentBar({ segment, onOpenOccurrence }: SegmentBarProps) {
  const label = segmentLabel(segment);
  const gridArea = {
    gridRow: String(segment.lane + 2),
    gridColumn: `${String(segment.startColumn)} / span ${String(segment.span)}`,
  };
  const rounding = cn(
    segment.isStart && 'rounded-l',
    segment.isEnd && 'rounded-r',
    !segment.isStart && '-ml-px',
  );
  if (segment.kind === 'task') {
    return (
      <Link
        to={segment.href}
        title={label}
        aria-label={label}
        onKeyDown={activateOnSpace}
        className={cn(
          'z-10 mx-0.5 mb-0.5 flex min-w-0 items-center gap-1 overflow-hidden px-1.5 text-xs outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring',
          rounding,
          segment.status === 'done' && 'opacity-60',
          segment.status === 'cancelled' && 'opacity-50 line-through',
        )}
        style={{ ...gridArea, backgroundColor: segment.color, color: segment.textColor }}
      >
        <span className="truncate font-medium">{segment.title}</span>
        {segment.statusLabel !== null &&
          segment.status !== 'todo' &&
          segment.status !== 'in_progress' && (
            <span className="shrink-0 opacity-90">[{segment.statusLabel}]</span>
          )}
        {!segment.isStart && <span className="sr-only">（继续）</span>}
      </Link>
    );
  }
  const content = (
    <>
      <span aria-hidden className="shrink-0">
        {segment.kind === 'meeting' ? '●' : '◆'}
      </span>
      <span className="truncate">
        {segment.kindLabel}：{segment.title}
      </span>
    </>
  );
  if (segment.recurrence !== null && segment.kind === 'meeting') {
    return (
      <button
        type="button"
        title={label}
        aria-label={`${label}，打开周期会议操作`}
        className="z-10 mx-0.5 mb-0.5 flex min-w-0 items-center gap-1 overflow-hidden rounded border bg-card px-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        style={{ ...gridArea, borderColor: segment.color }}
        onClick={() => {
          onOpenOccurrence(occurrenceEntry(segment));
        }}
      >
        {content}
      </button>
    );
  }
  return (
    <Link
      to={segment.href}
      title={label}
      aria-label={label}
      onKeyDown={activateOnSpace}
      className="z-10 mx-0.5 mb-0.5 flex min-w-0 items-center gap-1 overflow-hidden rounded border bg-card px-1.5 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      style={{ ...gridArea, borderColor: segment.color }}
    >
      {content}
    </Link>
  );
}

function WeekRow({
  week,
  onOpenOccurrence,
}: {
  week: CalendarColorBarWeek;
  onOpenOccurrence: (entry: CalendarEntry) => void;
}) {
  return (
    <div
      className="grid border-b last:border-b-0"
      style={{
        gridTemplateColumns: WEEK_COLUMNS,
        gridTemplateRows:
          week.laneCount === 0
            ? 'minmax(3rem, auto)'
            : `${DATE_ROW_HEIGHT} repeat(${String(week.laneCount)}, ${LANE_ROW_HEIGHT})`,
      }}
    >
      {week.days.map((day, index) => (
        <div
          key={day.date}
          aria-label={`${day.date}${day.isToday ? '，今天' : ''}`}
          data-calendar-today={day.isToday ? true : undefined}
          className={cn(
            'border-r px-1.5 pt-0.5 text-xs last:border-r-0',
            !day.inMonth && 'bg-muted/30 text-muted-foreground',
          )}
          style={{ gridColumn: String(index + 1), gridRow: `1 / ${String(week.laneCount + 2)}` }}
        >
          <span
            className={cn(
              'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 tabular-nums',
              day.isToday && 'bg-primary font-semibold text-primary-foreground',
            )}
          >
            {day.dayOfMonth}
          </span>
          {day.isToday && <span className="sr-only">今天</span>}
        </div>
      ))}
      {week.segments.map((segment) => (
        <SegmentBar key={segment.key} segment={segment} onOpenOccurrence={onOpenOccurrence} />
      ))}
    </div>
  );
}

export function CalendarColorBarView({ month, onOpenOccurrence }: CalendarColorBarViewProps) {
  const { weeks, unscheduledTasks } = month.colorBar;
  const hasSegments = weeks.some((week) => week.segments.length > 0);
  return (
    <section aria-label="颜色条视图" className="space-y-3">
      <div
        aria-label="颜色条图例"
        className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs"
      >
        <span>任务：连续时间条</span>
        <span>会议：● 单日事件</span>
        <span>里程碑：◆ 单日节点</span>
        <span>周期项目：以“周期会议”文字标识；可按次处理</span>
      </div>
      <div aria-label="颜色条月历" className="overflow-x-auto rounded-lg border bg-card">
        <div className="min-w-[45.5rem]">
          <div className="grid border-b bg-muted/40" style={{ gridTemplateColumns: WEEK_COLUMNS }}>
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="border-r px-2 py-1.5 text-center text-xs font-medium text-muted-foreground last:border-r-0"
              >
                {label}
              </div>
            ))}
          </div>
          {weeks.map((week) => (
            <WeekRow
              key={week.days[0]?.date ?? ''}
              week={week}
              onOpenOccurrence={onOpenOccurrence}
            />
          ))}
          {!hasSegments && (
            <p className="p-4 text-center text-sm text-muted-foreground">
              当前日期范围没有已排期项目。
            </p>
          )}
        </div>
      </div>
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          未排期任务（{String(unscheduledTasks.length)}）
        </summary>
        {unscheduledTasks.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">没有未排期任务。</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {unscheduledTasks.map((task) => (
              <li key={task.id} className="text-sm">
                <Link
                  to={`/tasks?taskId=${encodeURIComponent(task.id)}`}
                  className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {task.title}
                </Link>
                <span className="ml-2 text-xs text-muted-foreground">{task.project_name}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}
