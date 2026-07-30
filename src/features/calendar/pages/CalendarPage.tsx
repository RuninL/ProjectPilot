import { CalendarDays, ChevronLeft, ChevronRight, CheckSquare, Flag, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useCalendarStore } from '@/stores/useCalendarStore';
import {
  WEEKDAY_LABELS,
  type CalendarEntry,
  type CalendarEntryKind,
} from '../calendarModel';

/** Entries shown before a busy day collapses into a count. */
const VISIBLE_PER_DAY = 3;

const KIND_ICONS: Record<CalendarEntryKind, LucideIcon> = {
  task: CheckSquare,
  meeting: Users,
  milestone: Flag,
};

interface EntryLinkProps {
  entry: CalendarEntry;
}

function EntryLink({ entry }: EntryLinkProps) {
  const Icon = KIND_ICONS[entry.kind];
  return (
    <div className="rounded px-1 py-0.5 text-xs hover:bg-accent">
      <Link
        to={entry.href}
        className="flex items-start gap-1"
        title={`${entry.kindLabel}：${entry.title}${entry.detail === '' ? '' : ` · ${entry.detail}`}`}
      >
        <span
          className="mt-1 h-2 w-2 shrink-0 rounded-full border"
          style={entry.color === null ? undefined : { backgroundColor: entry.color }}
          aria-hidden
        />
        <span className="min-w-0">
          <span className="text-muted-foreground">{`[${entry.kindLabel}]`}</span>
          <Icon className="mx-1 inline h-3 w-3" aria-hidden />
          <span className="break-all">{entry.title}</span>
        </span>
      </Link>
    </div>
  );
}

export function CalendarPage() {
  const month = useCalendarStore((state) => state.month);
  const data = useCalendarStore((state) => state.data);
  const loading = useCalendarStore((state) => state.loading);
  const error = useCalendarStore((state) => state.error);
  const load = useCalendarStore((state) => state.load);
  const step = useCalendarStore((state) => state.step);
  const goToToday = useCalendarStore((state) => state.goToToday);

  const [expandedDays, setExpandedDays] = useState<readonly string[]>([]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && data === null) {
    return (
      <div className="p-6">
        <LoadingState label="正在加载日历…" />
      </div>
    );
  }

  if (error !== null && data === null) {
    return (
      <div className="p-6">
        <ErrorState
          title="无法加载日历"
          message={error}
          onRetry={() => {
            void load(month);
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">日历</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            只读视图：显示任务、会议与里程碑，不能在此拖动或改期。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label="上一月"
            onClick={() => {
              void step(-1);
            }}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <span className="min-w-28 text-center text-base font-medium" aria-live="polite">
            {data?.label ?? month}
          </span>
          <Button
            variant="outline"
            size="sm"
            aria-label="下一月"
            onClick={() => {
              void step(1);
            }}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void goToToday();
            }}
          >
            <CalendarDays className="h-4 w-4" aria-hidden />
            今天
          </Button>
        </div>
      </header>

      {error !== null && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {data?.recurrenceTruncated === true && (
        <p role="alert" className="mb-3 rounded-lg border border-amber-500 p-3 text-sm">
          周期规则展开已达到 500 项上限，当前日历仅显示部分预期项。
        </p>
      )}

      {data !== null && data.entryCount === 0 && (
        <p className="mb-3 rounded-lg border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
          本月暂无任务、会议或里程碑。
        </p>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="grid grid-cols-7 border-b bg-muted/40">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="p-2 text-center text-xs font-medium text-muted-foreground">
              {label}
            </div>
          ))}
        </div>
        {(data?.weeks ?? []).map((week) => (
          <div key={week[0]?.date ?? ''} className="grid grid-cols-7 border-b last:border-b-0">
              {week.map((day) => {
                const expanded = expandedDays.includes(day.date);
                const visible = expanded ? day.entries : day.entries.slice(0, VISIBLE_PER_DAY);
                const hidden = day.entries.length - visible.length;
                return (
                  <div
                    key={day.date}
                    className={cn(
                      'min-h-24 border-r p-1 last:border-r-0',
                      day.inMonth ? '' : 'bg-muted/30 text-muted-foreground',
                    )}
                  >
                    <div className="flex items-center justify-between px-1">
                      <span className={cn('text-xs', day.isToday && 'font-semibold text-primary')}>
                        {day.dayOfMonth}
                      </span>
                      {day.isToday && (
                        <span className="rounded bg-primary px-1 text-[10px] text-primary-foreground">
                          今天
                        </span>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {visible.map((entry) => (
                        <EntryLink key={entry.key} entry={entry} />
                      ))}
                    </div>
                    {hidden > 0 && (
                      <button
                        type="button"
                        className="mt-0.5 w-full rounded px-1 text-left text-xs text-muted-foreground hover:bg-accent"
                        onClick={() => {
                          setExpandedDays((current) => [...current, day.date]);
                        }}
                      >
                        {`还有 ${String(hidden)} 项`}
                      </button>
                    )}
                    {expanded && day.entries.length > VISIBLE_PER_DAY && (
                      <button
                        type="button"
                        className="mt-0.5 w-full rounded px-1 text-left text-xs text-muted-foreground hover:bg-accent"
                        onClick={() => {
                          setExpandedDays((current) => current.filter((date) => date !== day.date));
                        }}
                      >
                        收起
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
