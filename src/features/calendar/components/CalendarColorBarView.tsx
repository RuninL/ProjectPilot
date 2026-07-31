import { CheckSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import type { CalendarColorBarEvent, CalendarEntry, CalendarMonth } from '../calendarModel';

interface CalendarColorBarViewProps {
  month: CalendarMonth;
  onOpenOccurrence: (entry: CalendarEntry) => void;
}

const DAY_COLUMN_WIDTH = '6rem';

function gridColumn(date: string, dates: readonly string[]): number {
  return dates.indexOf(date) + 1;
}

function occurrenceEntry(event: CalendarColorBarEvent): CalendarEntry {
  return {
    key: event.id,
    kind: event.kind,
    sourceId: event.id,
    date: event.date,
    title: event.title,
    kindLabel: event.kindLabel,
    detail: event.detail,
    href: event.href,
    color: event.color,
    recurrence: event.recurrence,
  };
}

export function CalendarColorBarView({ month, onOpenOccurrence }: CalendarColorBarViewProps) {
  const { dates, lanes, unscheduledTasks, events } = month.colorBar;
  const columns = `repeat(${String(dates.length)}, minmax(${DAY_COLUMN_WIDTH}, 1fr))`;
  return (
    <section aria-label="颜色条视图" className="space-y-3">
      <p className="text-sm text-muted-foreground">
        每条任务覆盖开始日和结束日；受阻、已完成及已取消状态均以文字显示。
      </p>
      <div
        aria-label="颜色条图例"
        className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs"
      >
        <span>任务：连续时间条</span>
        <span>会议：● 单日事件</span>
        <span>里程碑：◆ 单日节点</span>
        <span>周期项目：以“周期会议”文字标识；可按次处理</span>
      </div>
      <div
        aria-label="颜色条时间轴"
        className="overflow-x-auto rounded-lg border bg-card"
      >
        <div className="min-w-max">
          <div
            className="grid border-b bg-muted/40"
            style={{ gridTemplateColumns: columns }}
          >
            {dates.map((date) => (
              <div key={date} className="border-r px-2 py-2 text-center text-xs last:border-r-0">
                <span className="block font-medium">{date.slice(8, 10)}</span>
                <span className="text-muted-foreground">{date.slice(5, 7)}</span>
              </div>
            ))}
          </div>
          {events.length > 0 && (
            <div className="border-b p-1">
              <p className="px-1 py-1 text-xs font-medium text-muted-foreground">单日事件</p>
              {events.map((event) => {
                const column = gridColumn(event.date, dates);
                const label = `${event.kindLabel}：${event.title}${event.detail === '' ? '' : ` · ${event.detail}`}`;
                const content = (
                  <>
                    <span aria-hidden>{event.kind === 'meeting' ? '●' : '◆'}</span>
                    <span className="truncate">{event.kindLabel}：{event.title}</span>
                  </>
                );
                return (
                  <div
                    key={event.id}
                    className="grid mb-1"
                    style={{ gridTemplateColumns: columns }}
                  >
                    {event.recurrence !== null && event.kind === 'meeting' ? (
                      <button
                        type="button"
                        title={label}
                        aria-label={`${label}，打开周期会议操作`}
                        className="flex min-h-9 items-center gap-1 rounded border px-2 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        style={{ gridColumn: String(column), borderColor: event.color }}
                        onClick={() => {
                          onOpenOccurrence(occurrenceEntry(event));
                        }}
                      >
                        {content}
                      </button>
                    ) : (
                      <Link
                        to={event.href}
                        title={label}
                        aria-label={label}
                        className="flex min-h-9 items-center gap-1 rounded border px-2 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        style={{ gridColumn: String(column), borderColor: event.color }}
                      >
                        {content}
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {lanes.map((lane, laneIndex) => (
            <div key={`lane:${String(laneIndex)}`} className="grid min-h-12 border-b p-1 last:border-b-0" style={{ gridTemplateColumns: columns }}>
              {lane.map((bar) => {
                const start = gridColumn(bar.displayStart, dates);
                const end = gridColumn(bar.displayEnd, dates) + 1;
                const label = `任务：${bar.title}；项目：${bar.projectName}；${bar.startDate} 至 ${bar.endDate}；状态：${bar.statusLabel}`;
                return (
                  <Link
                    key={bar.id}
                    to={bar.href}
                    title={label}
                    aria-label={label}
                    className={cn(
                      'flex min-h-9 items-center gap-1 overflow-hidden rounded px-2 text-xs text-white shadow-sm outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      bar.status === 'done' && 'opacity-60',
                      bar.status === 'cancelled' && 'opacity-50 line-through',
                    )}
                    style={{ gridColumn: `${String(start)} / ${String(end)}`, backgroundColor: bar.color }}
                  >
                    <CheckSquare className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate font-medium">{bar.title}</span>
                    <span className="shrink-0 opacity-90">[{bar.statusLabel}]</span>
                  </Link>
                );
              })}
            </div>
          ))}
          {lanes.length === 0 && events.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">当前日期范围没有已排期项目。</p>
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
