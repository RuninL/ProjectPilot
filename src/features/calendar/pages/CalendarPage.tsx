import { CalendarDays, ChevronLeft, ChevronRight, CheckSquare, Flag, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import { toAppError } from '@/lib/errors';
import { getCalendarService, type CalendarAttentionTask } from '@/services/calendar.service';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { useRecurrenceStore } from '@/stores/useRecurrenceStore';
import { WEEKDAY_LABELS, type CalendarEntry, type CalendarEntryKind } from '../calendarModel';
import { CalendarColorBarView } from '../components/CalendarColorBarView';

/** Entries shown before a busy day collapses into a count. */
const VISIBLE_PER_DAY = 3;

const KIND_ICONS: Record<CalendarEntryKind, LucideIcon> = {
  task: CheckSquare,
  meeting: Users,
  milestone: Flag,
};

interface EntryLinkProps {
  entry: CalendarEntry;
  onOpenOccurrence: (entry: CalendarEntry) => void;
}

function EntryLink({ entry, onOpenOccurrence }: EntryLinkProps) {
  const Icon = KIND_ICONS[entry.kind];
  if (entry.recurrence !== null && entry.kind === 'meeting') {
    return (
      <button
        type="button"
        className="flex w-full items-start gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
        title={`${entry.kindLabel}：${entry.title}${entry.detail === '' ? '' : ` · ${entry.detail}`}`}
        onClick={() => {
          onOpenOccurrence(entry);
        }}
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
      </button>
    );
  }
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
  const skipOccurrence = useRecurrenceStore((state) => state.skip);
  const rescheduleOccurrence = useRecurrenceStore((state) => state.reschedule);

  const [expandedDays, setExpandedDays] = useState<readonly string[]>([]);
  const [view, setView] = useState<'calendar' | 'color-bar'>('calendar');
  const [attentionDate, setAttentionDate] = useState<string | null>(null);
  const [attentionTasks, setAttentionTasks] = useState<readonly CalendarAttentionTask[]>([]);
  const [attentionLoading, setAttentionLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    date: string;
    left: number;
    top: number;
  } | null>(null);
  const [occurrence, setOccurrence] = useState<CalendarEntry | null>(null);
  const [replacementDate, setReplacementDate] = useState('');
  const [occurrenceBusy, setOccurrenceBusy] = useState(false);
  const [occurrenceError, setOccurrenceError] = useState<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const recurrenceRuleId = occurrence?.recurrence?.ruleId ?? null;

  useEffect(() => {
    void load();
  }, [load]);

  const openAttention = (date: string): void => {
    setAttentionDate(date);
    setAttentionTasks([]);
    setAttentionLoading(true);
    void getCalendarService()
      .then((service) => service.loadAttentionTasks(date))
      .then(setAttentionTasks)
      .finally(() => {
        setAttentionLoading(false);
      });
  };

  const openContextMenu = useCallback((date: string, clientX: number, clientY: number): void => {
    const width = 168;
    const height = 44;
    setContextMenu({
      date,
      left: Math.max(8, Math.min(clientX, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(clientY, window.innerHeight - height - 8)),
    });
  }, []);

  useEffect(() => {
    if (contextMenu === null) return;
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

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
            显示任务、会议与里程碑，不能拖动排期；周期会议可按次调整。
          </p>
          <p className="mt-1 text-xs text-muted-foreground">右键日期查看当日任务</p>
          <Tabs
            value={view}
            onValueChange={(value) => {
              if (value === 'calendar' || value === 'color-bar') setView(value);
            }}
            className="mt-3"
          >
            <TabsList aria-label="日历视图切换">
              <TabsTrigger value="calendar">常规视图</TabsTrigger>
              <TabsTrigger value="color-bar">颜色条视图</TabsTrigger>
            </TabsList>
          </Tabs>
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
          周期会议展开已达到 500 项上限，当前日历仅显示部分会议。
        </p>
      )}

      {data !== null && data.entryCount === 0 && (
        <p className="mb-3 rounded-lg border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
          本月暂无任务、会议或里程碑。
        </p>
      )}

      {view === 'color-bar' && data !== null ? (
        <CalendarColorBarView
          month={data}
          onOpenOccurrence={(selected) => {
            setOccurrence(selected);
            setReplacementDate(selected.date);
            setOccurrenceError(null);
          }}
        />
      ) : (
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
                  role="gridcell"
                  tabIndex={0}
                  aria-label={`${day.date} 的日期菜单`}
                  className={cn(
                    'min-h-24 border-r p-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring last:border-r-0',
                    day.inMonth ? '' : 'bg-muted/30 text-muted-foreground',
                  )}
                  onContextMenu={(event) => {
                    if ((event.target as HTMLElement).closest('[data-calendar-entry]') !== null) {
                      return;
                    }
                    event.preventDefault();
                    openContextMenu(day.date, event.clientX, event.clientY);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
                      event.preventDefault();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      openContextMenu(day.date, bounds.left + 12, bounds.top + 24);
                    }
                  }}
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
                  <div className="mt-1 space-y-0.5" data-calendar-entry>
                    {visible.map((entry) => (
                      <EntryLink
                        key={entry.key}
                        entry={entry}
                        onOpenOccurrence={(selected) => {
                          setOccurrence(selected);
                          setReplacementDate(selected.date);
                          setOccurrenceError(null);
                        }}
                      />
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
      )}
      {contextMenu !== null && (
        <div
          ref={contextMenuRef}
          role="menu"
          aria-label={`${contextMenu.date} 的日期菜单`}
          className="fixed z-50 min-w-40 rounded-md border bg-card p-1 text-card-foreground shadow-md"
          style={{ left: contextMenu.left, top: contextMenu.top }}
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus:bg-accent"
            onClick={() => {
              openAttention(contextMenu.date);
              setContextMenu(null);
            }}
          >
            查看当日任务
          </button>
        </div>
      )}
      <Dialog
        open={attentionDate !== null}
        onOpenChange={(open) => {
          if (!open) setAttentionDate(null);
        }}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>当日任务</DialogTitle>
            <DialogDescription>{attentionDate ?? ''}</DialogDescription>
          </DialogHeader>
          {attentionLoading ? (
            <p className="text-sm text-muted-foreground">正在加载任务…</p>
          ) : attentionTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">当天没有需要关注的任务。</p>
          ) : (
            <ul className="space-y-2">
              {attentionTasks.map(({ task, labels }) => (
                <li key={task.id} className="rounded border p-3">
                  <Link
                    to={`/tasks?taskId=${encodeURIComponent(task.id)}`}
                    className="font-medium hover:underline"
                  >
                    {task.title}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">{labels.join(' · ')}</p>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={occurrence !== null}
        onOpenChange={(open) => {
          if (!open) setOccurrence(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>周期会议操作</DialogTitle>
            <DialogDescription>
              {occurrence === null
                ? ''
                : `正在处理 ${occurrence.date} 的「${occurrence.title}」。仅本次不会创建会议记录；整个系列操作会跳转到会议页。`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label className="grid gap-1 text-sm" htmlFor="recurrence-replacement-date">
              仅修改本次的新日期
              <input
                id="recurrence-replacement-date"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                type="date"
                value={replacementDate}
                onChange={(event) => {
                  setReplacementDate(event.target.value);
                }}
              />
            </label>
            {occurrenceError !== null && (
              <p className="text-sm text-destructive">{occurrenceError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={occurrenceBusy}
              onClick={() => {
                const target = occurrence?.recurrence;
                if (target === null || target === undefined) return;
                setOccurrenceBusy(true);
                void rescheduleOccurrence(target.ruleId, target.occurrenceDate, replacementDate)
                  .then(() => {
                    return load(month);
                  })
                  .then(() => {
                    setOccurrence(null);
                  })
                  .catch((caught: unknown) => {
                    setOccurrenceError(toAppError(caught).message);
                  })
                  .finally(() => {
                    setOccurrenceBusy(false);
                  });
              }}
            >
              仅修改本次
            </Button>
            <Button
              variant="destructive"
              disabled={occurrenceBusy}
              onClick={() => {
                const target = occurrence?.recurrence;
                if (target === null || target === undefined) return;
                setOccurrenceBusy(true);
                void skipOccurrence(target.ruleId, target.occurrenceDate)
                  .then(() => {
                    return load(month);
                  })
                  .then(() => {
                    setOccurrence(null);
                  })
                  .catch((caught: unknown) => {
                    setOccurrenceError(toAppError(caught).message);
                  })
                  .finally(() => {
                    setOccurrenceBusy(false);
                  });
              }}
            >
              仅删除本次
            </Button>
            {recurrenceRuleId !== null && (
              <Button variant="outline" asChild>
                <Link to={`/meetings?series=${encodeURIComponent(recurrenceRuleId)}`}>
                  整个系列
                </Link>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
