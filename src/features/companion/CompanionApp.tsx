import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatMonthLabel, todayHK } from '@/lib/date';
import {
  shiftMonth,
  WEEKDAY_LABELS,
  type CompactCalendarMonth,
} from '@/features/calendar/calendarModel';
import { toAppError } from '@/lib/errors';
import { emitInvalidation, listenForInvalidation } from '@/lib/invalidation';
import { applyTheme, type Theme } from '@/lib/theme';
import { getCalendarService } from '@/services/calendar.service';
import {
  completeCompanionTask,
  loadCompanionToday,
  type CompanionTodayItem,
} from '@/services/companion.service';
import {
  loadReminderSettings,
  saveReminderSettings,
} from '@/features/settings/services/reminderSettings.service';
import { sortCompanionItems } from './companionModel';
import { safeCompanionGeometry } from './windowGeometry';

const CALENDAR_CACHE_LIMIT = 3;
const CALENDAR_LOAD_DEBOUNCE_MS = 80;

function cacheMonth(cache: Map<string, CompactCalendarMonth>, month: CompactCalendarMonth): void {
  cache.delete(month.month);
  cache.set(month.month, month);
  while (cache.size > CALENDAR_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

export function CompanionApp() {
  const [view, setView] = useState<'today' | 'calendar'>('today');
  const [items, setItems] = useState<CompanionTodayItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<CompactCalendarMonth | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [month, setMonth] = useState(todayHK().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(todayHK());
  const [pendingTask, setPendingTask] = useState<CompanionTodayItem | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const calendarCache = useRef(new Map<string, CompactCalendarMonth>());
  const calendarRequest = useRef(0);
  const calendarLoadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const todayRequest = useRef(0);

  const reload = useCallback(() => {
    const request = ++todayRequest.current;
    setError(null);
    void loadCompanionToday()
      .then((next) => {
        if (request === todayRequest.current) setItems(sortCompanionItems(next));
      })
      .catch((caught: unknown) => {
        if (request === todayRequest.current) setError(toAppError(caught).message);
      });
  }, []);

  const reloadCalendar = useCallback((nextMonth: string) => {
    const request = ++calendarRequest.current;
    const cached = calendarCache.current.get(nextMonth);
    if (cached !== undefined) {
      cacheMonth(calendarCache.current, cached);
      setCalendar(cached);
      setCalendarLoading(false);
      return;
    }

    setError(null);
    setCalendarLoading(true);
    if (calendarLoadTimer.current !== null) clearTimeout(calendarLoadTimer.current);
    calendarLoadTimer.current = setTimeout(() => {
      void getCalendarService()
        .then((service) => service.loadCompactMonth(nextMonth))
        .then((next) => {
          cacheMonth(calendarCache.current, next);
          if (request === calendarRequest.current) setCalendar(next);
        })
        .catch((caught: unknown) => {
          if (request === calendarRequest.current) setError(toAppError(caught).message);
        })
        .finally(() => {
          if (request === calendarRequest.current) setCalendarLoading(false);
        });
    }, CALENDAR_LOAD_DEBOUNCE_MS);
  }, []);

  const openMain = () => {
    void WebviewWindow.getByLabel('main')
      .then(async (window) => {
        if (window === null) throw new Error('主窗口当前不可用。');
        await window.show();
        await window.setFocus();
        await emit('projectpilot:navigate', { target: 'dashboard' });
      })
      .catch((caught: unknown) => {
        setError(toAppError(caught).message);
      });
  };

  const confirmComplete = () => {
    if (pendingTask?.taskId === undefined || isCompleting) return;
    setIsCompleting(true);
    void completeCompanionTask(pendingTask.taskId)
      .then(() => {
        setPendingTask(null);
        void emitInvalidation(['tasks']);
        reload();
      })
      .catch((caught: unknown) => {
        setError(toAppError(caught).message);
      })
      .finally(() => {
        setIsCompleting(false);
      });
  };

  useEffect(() => {
    reload();
    void loadReminderSettings().then((settings) => {
      setView(settings.companionView);
    });
  }, [reload]);

  useEffect(
    () => () => {
      calendarRequest.current += 1;
      if (calendarLoadTimer.current !== null) clearTimeout(calendarLoadTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (view === 'calendar') reloadCalendar(month);
  }, [month, reloadCalendar, view]);

  useEffect(() => {
    const window = getCurrentWindow();
    let resizeCleanup: (() => void) | null = null;
    let moveCleanup: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const persist = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        void Promise.all([window.outerPosition(), window.outerSize(), loadReminderSettings()])
          .then(([position, size, settings]) =>
            saveReminderSettings({
              ...settings,
              companionGeometry: {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
              },
            }),
          )
          .catch((caught: unknown) => {
            if (!disposed) setError(toAppError(caught).message);
          });
      }, 500);
    };
    void Promise.all([loadReminderSettings(), currentMonitor()])
      .then(async ([settings, monitor]) => {
        await window.setAlwaysOnTop(settings.companionAlwaysOnTop);
        if (monitor !== null) {
          const geometry = safeCompanionGeometry(settings.companionGeometry, {
            x: monitor.workArea.position.x,
            y: monitor.workArea.position.y,
            width: monitor.workArea.size.width,
            height: monitor.workArea.size.height,
          });
          await window.setSize(new PhysicalSize(geometry.width, geometry.height));
          await window.setPosition(new PhysicalPosition(geometry.x, geometry.y));
        }
        const [nextResizeCleanup, nextMoveCleanup] = await Promise.all([
          window.onResized(persist),
          window.onMoved(persist),
        ]);
        if (disposed) {
          nextResizeCleanup();
          nextMoveCleanup();
          return;
        }
        resizeCleanup = nextResizeCleanup;
        moveCleanup = nextMoveCleanup;
      })
      .catch((caught: unknown) => {
        if (!disposed) setError(toAppError(caught).message);
      });
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      resizeCleanup?.();
      moveCleanup?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void listenForInvalidation(() => {
      calendarCache.current.clear();
      reload();
      if (view === 'calendar') reloadCalendar(month);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [month, reload, reloadCalendar, view]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void listen<Theme>('projectpilot:theme-changed', (event) => {
      applyTheme(event.payload);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const selectView = (next: 'today' | 'calendar') => {
    setView(next);
    void loadReminderSettings()
      .then((settings) => saveReminderSettings({ ...settings, companionView: next }))
      .catch((caught: unknown) => {
        setError(toAppError(caught).message);
      });
  };

  const changeMonth = (delta: number) => {
    const nextMonth = shiftMonth(month, delta);
    setMonth(nextMonth);
    setSelectedDate(`${nextMonth}-01`);
  };

  const visibleCalendar = calendar?.month === month ? calendar : null;
  const calendarDays = useMemo(() => visibleCalendar?.weeks.flat() ?? [], [visibleCalendar]);
  const selectedEntries = useMemo(
    () => calendarDays.find((day) => day.date === selectedDate)?.entries,
    [calendarDays, selectedDate],
  );
  const nextMeeting = items?.find((item) => item.kind === 'meeting');
  const overdueCount = items?.filter((item) => item.kind === 'overdue-task').length ?? 0;
  const todayTaskCount = items?.filter((item) => item.kind === 'today-task').length ?? 0;

  return (
    <main className="min-h-screen overflow-x-hidden bg-background p-4 text-foreground">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">ProjectPilot</h1>
          <p className="text-sm text-muted-foreground">桌面小窗</p>
        </div>
        <Button size="sm" variant="outline" aria-label="打开主窗口" onClick={openMain}>
          打开主窗口
        </Button>
      </header>

      <div className="mt-4 flex gap-2" role="tablist" aria-label="桌面小窗视图">
        <Button
          size="sm"
          role="tab"
          aria-selected={view === 'today'}
          variant={view === 'today' ? 'default' : 'outline'}
          onClick={() => {
            selectView('today');
          }}
        >
          今日任务
        </Button>
        <Button
          size="sm"
          role="tab"
          aria-selected={view === 'calendar'}
          variant={view === 'calendar' ? 'default' : 'outline'}
          onClick={() => {
            selectView('calendar');
          }}
        >
          日历
        </Button>
      </div>

      {view === 'today' ? (
        <section className="mt-4 rounded-lg border p-4" role="tabpanel">
          <h2 className="font-medium">今日</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {todayHK()} · {todayTaskCount} 项今日 due · {overdueCount} 项逾期
            {nextMeeting === undefined ? '' : ` · 下一场：${nextMeeting.title}`}
          </p>
          {items === null && error === null && (
            <p className="mt-2 text-sm text-muted-foreground">正在加载今日安排…</p>
          )}
          {error !== null && (
            <div className="mt-2 text-sm text-destructive" role="alert">
              {error}{' '}
              <Button size="sm" variant="outline" onClick={reload}>
                重试
              </Button>
            </div>
          )}
          {items !== null && items.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">今天暂无日程。</p>
          )}
          {items !== null && (
            <ul className="mt-2 space-y-2">
              {items.map((item) => (
                <li
                  key={`${item.kind}:${item.id}`}
                  className="flex items-center justify-between gap-2 rounded border p-2 text-sm"
                >
                  <span>
                    <strong>{item.title}</strong>
                    <span className="block text-muted-foreground">{item.subtitle}</span>
                  </span>
                  {item.taskId !== undefined && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPendingTask(item);
                      }}
                    >
                      完成
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="mt-4 rounded-lg border p-4" role="tabpanel" aria-busy={calendarLoading}>
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="outline"
              aria-label="上个月"
              onClick={() => {
                changeMonth(-1);
              }}
            >
              上个月
            </Button>
            <h2 className="font-medium" aria-live="polite">
              {formatMonthLabel(`${month}-01`)}
            </h2>
            <Button
              size="sm"
              variant="outline"
              aria-label="下个月"
              onClick={() => {
                changeMonth(1);
              }}
            >
              下个月
            </Button>
          </div>
          {visibleCalendar === null ? (
            <p className="mt-2 text-sm text-muted-foreground">正在加载日历…</p>
          ) : (
            <>
              <div
                className="mt-3 grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground"
                aria-hidden="true"
              >
                {WEEKDAY_LABELS.map((weekday) => (
                  <span key={weekday}>{weekday}</span>
                ))}
              </div>
              <div
                className="mt-1 grid grid-cols-7 gap-1"
                aria-label={`${visibleCalendar.label} 日历`}
              >
                {calendarDays.map((day) => {
                  const selected = selectedDate === day.date;
                  return (
                    <button
                      key={day.date}
                      type="button"
                      className={`min-h-9 rounded border text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                        day.inMonth ? '' : 'text-muted-foreground opacity-50'
                      } ${day.isToday ? 'border-primary font-semibold' : ''} ${
                        selected
                          ? 'border-sky-300 bg-sky-100 text-sky-950 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-100'
                          : ''
                      }`}
                      aria-pressed={selected}
                      onClick={() => {
                        setSelectedDate(day.date);
                      }}
                    >
                      {day.dayOfMonth}
                      {day.entries.length > 0 ? ' ·' : ''}
                    </button>
                  );
                })}
              </div>
              {calendarLoading && (
                <p className="mt-2 text-xs text-muted-foreground">正在更新日历…</p>
              )}
              {selectedEntries === undefined || selectedEntries.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">所选日期暂无日程。</p>
              ) : (
                <ul className="mt-3 space-y-1 text-sm">
                  {selectedEntries.map((entry) => (
                    <li key={entry.key}>
                      <span className="font-medium">{entry.kindLabel}</span> {entry.title}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      <Dialog
        open={pendingTask !== null}
        onOpenChange={(open) => {
          if (!open && !isCompleting) setPendingTask(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认完成任务</DialogTitle>
            <DialogDescription>
              确定要将“{pendingTask?.title ?? ''}”标记为已完成吗？此操作会同步到主窗口。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isCompleting}
              onClick={() => {
                setPendingTask(null);
              }}
            >
              取消
            </Button>
            <Button disabled={isCompleting} onClick={confirmComplete}>
              {isCompleting ? '正在完成…' : '确认完成'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
