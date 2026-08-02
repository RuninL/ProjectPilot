import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
  primaryMonitor,
} from '@tauri-apps/api/window';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { addDays, formatMonthLabel, todayHK } from '@/lib/date';
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
  createCompanionTask,
  loadCompanionProjectOptions,
  loadCompanionToday,
  loadCompanionWeek,
  reopenCompanionTask,
  type CompanionDay,
  type CompanionTodayItem,
} from '@/services/companion.service';
import type { TaskPriority } from '@/types';
import {
  loadReminderSettings,
  saveReminderSettings,
} from '@/features/settings/services/reminderSettings.service';
import {
  DEFAULT_DESKTOP_WORKSPACE_SETTINGS,
  loadDesktopWorkspaceSettings,
  saveDesktopWorkspaceSettings,
  type DesktopWorkspaceSettings,
} from '@/features/settings/services/desktopWorkspaceSettings.service';
import { setDesktopWorkspaceMode } from '@/lib/commands';
import { sortCompanionItems } from './companionModel';
import { safeCompanionGeometry } from './windowGeometry';

const CALENDAR_CACHE_LIMIT = 3;
const CALENDAR_LOAD_DEBOUNCE_MS = 80;

function monitorId(monitor: { name: string | null; position: { x: number; y: number } }): string {
  return `${monitor.name ?? '显示器'}:${String(monitor.position.x)}:${String(monitor.position.y)}`;
}

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
  const [view, setView] = useState<'today' | 'sevenDays' | 'calendar'>('today');
  const [items, setItems] = useState<CompanionTodayItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<CompactCalendarMonth | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [month, setMonth] = useState(todayHK().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(todayHK());
  const [pendingTask, setPendingTask] = useState<CompanionTodayItem | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [weekStart, setWeekStart] = useState(todayHK());
  const [week, setWeek] = useState<CompanionDay[] | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickDate, setQuickDate] = useState(todayHK());
  const [quickProjectId, setQuickProjectId] = useState('');
  const [quickPriority, setQuickPriority] = useState<TaskPriority>('medium');
  const [quickDescription, setQuickDescription] = useState('');
  const [projectOptions, setProjectOptions] = useState<readonly { id: string; name: string }[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [showCompleted, setShowCompleted] = useState(true);
  const [workspaceSettings, setWorkspaceSettings] = useState<DesktopWorkspaceSettings>(
    DEFAULT_DESKTOP_WORKSPACE_SETTINGS,
  );
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

  const reloadWeek = useCallback((start: string) => {
    setError(null);
    void loadCompanionWeek(start)
      .then(setWeek)
      .catch((caught: unknown) => {
        setError(toAppError(caught).message);
      });
  }, []);

  const selectView = useCallback((next: 'today' | 'sevenDays' | 'calendar') => {
    setView(next);
    void loadReminderSettings()
      .then((settings) => saveReminderSettings({ ...settings, companionView: next }))
      .catch((caught: unknown) => {
        setError(toAppError(caught).message);
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

  const openMain = (target = 'dashboard') => {
    void WebviewWindow.getByLabel('main')
      .then(async (window) => {
        if (window === null) throw new Error('主窗口当前不可用。');
        await window.show();
        await window.setFocus();
        await emit('projectpilot:navigate', { target });
      })
      .catch((caught: unknown) => {
        setError(toAppError(caught).message);
      });
  };

  const createQuickTask = () => {
    if (isCreating || quickProjectId === '') return;
    setIsCreating(true);
    setError(null);
    void createCompanionTask({
      title: quickTitle,
      date: quickDate,
      projectId: quickProjectId,
      priority: quickPriority,
      description: quickDescription,
    })
      .then(() => {
        setQuickOpen(false);
        setQuickTitle('');
        setQuickDescription('');
        void emitInvalidation(['tasks']);
        reload();
        reloadWeek(weekStart);
      })
      .catch((caught: unknown) => {
        setError(toAppError(caught).message);
      })
      .finally(() => {
        setIsCreating(false);
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
    void Promise.all([loadReminderSettings(), loadDesktopWorkspaceSettings()]).then(
      ([reminders, workspace]) => {
        setView(reminders.companionView);
        setShowCompleted(workspace.showCompleted);
        setWorkspaceSettings(workspace);
      },
    );
    void loadCompanionProjectOptions().then((projects) => {
      setProjectOptions(projects);
      setQuickProjectId(projects[0]?.id ?? '');
    });
  }, [reload]);

  useEffect(() => {
    let commandCleanup: (() => void) | null = null;
    let settingsCleanup: (() => void) | null = null;
    let disposed = false;
    void Promise.all([
      listen<string>('projectpilot:workspace-command', (event) => {
        if (event.payload === 'workspace-today') selectView('today');
        else if (event.payload === 'workspace-week') selectView('sevenDays');
        else if (event.payload === 'workspace-calendar') selectView('calendar');
        else if (event.payload === 'workspace-refresh') {
          reload();
          reloadWeek(weekStart);
          if (view === 'calendar') reloadCalendar(month);
        }
      }),
      listen<DesktopWorkspaceSettings>('projectpilot:workspace-settings-changed', (event) => {
        setWorkspaceSettings(event.payload);
        setShowCompleted(event.payload.showCompleted);
      }),
    ]).then(([nextCommandCleanup, nextSettingsCleanup]) => {
      if (disposed) {
        nextCommandCleanup();
        nextSettingsCleanup();
      } else {
        commandCleanup = nextCommandCleanup;
        settingsCleanup = nextSettingsCleanup;
      }
    });
    return () => {
      disposed = true;
      commandCleanup?.();
      settingsCleanup?.();
    };
  }, [month, reload, reloadCalendar, reloadWeek, selectView, view, weekStart]);

  useEffect(() => {
    if (workspaceSettings.mode !== 'workerw') return;
    let disposed = false;
    const recover = () => {
      if (document.hidden) return;
      void setDesktopWorkspaceMode('workerw').catch((caught: unknown) => {
        if (disposed) return;
        if (!workspaceSettings.workerwFallback) {
          setError(toAppError(caught).message);
          return;
        }
        void setDesktopWorkspaceMode('widget')
          .then(() => {
            const fallback = { ...workspaceSettings, mode: 'widget' as const };
            setWorkspaceSettings(fallback);
            return saveDesktopWorkspaceSettings(fallback);
          })
          .catch((fallbackError: unknown) => {
            setError(toAppError(fallbackError).message);
          });
      });
    };
    const onVisible = () => {
      if (!document.hidden) {
        recover();
        reload();
        reloadWeek(weekStart);
        if (view === 'calendar') reloadCalendar(month);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(recover, 30_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [month, reload, reloadCalendar, reloadWeek, view, weekStart, workspaceSettings]);

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
    if (view === 'sevenDays') reloadWeek(weekStart);
  }, [reloadWeek, view, weekStart]);

  useEffect(() => {
    const window = getCurrentWindow();
    let resizeCleanup: (() => void) | null = null;
    let moveCleanup: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const persist = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        void Promise.all([
          window.outerPosition(),
          window.outerSize(),
          loadReminderSettings(),
          loadDesktopWorkspaceSettings(),
          currentMonitor(),
        ])
          .then(([position, size, settings, desktopSettings, monitor]) => {
            const geometry = {
              x: position.x,
              y: position.y,
              width: size.width,
              height: size.height,
            };
            const saveReminder = saveReminderSettings({
              ...settings,
              companionGeometry: geometry,
            });
            const saveDesktop =
              monitor === null
                ? Promise.resolve()
                : saveDesktopWorkspaceSettings({
                    ...desktopSettings,
                    monitorId: monitorId(monitor),
                    layouts: {
                      ...desktopSettings.layouts,
                      [monitorId(monitor)]: geometry,
                    },
                  });
            return Promise.all([saveReminder, saveDesktop]);
          })
          .catch((caught: unknown) => {
            if (!disposed) setError(toAppError(caught).message);
          });
      }, 500);
    };
    void Promise.all([
      loadReminderSettings(),
      loadDesktopWorkspaceSettings(),
      availableMonitors(),
      primaryMonitor(),
    ])
      .then(async ([settings, desktopSettings, monitors, primary]) => {
        await window.setAlwaysOnTop(settings.companionAlwaysOnTop);
        const monitor =
          monitors.find((candidate) => monitorId(candidate) === desktopSettings.monitorId) ??
          primary;
        if (monitor !== null) {
          const geometry = safeCompanionGeometry(
            desktopSettings.layouts[monitorId(monitor)] ?? settings.companionGeometry,
            {
              x: monitor.workArea.position.x,
              y: monitor.workArea.position.y,
              width: monitor.workArea.size.width,
              height: monitor.workArea.size.height,
            },
          );
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
      reloadWeek(weekStart);
      if (view === 'calendar') reloadCalendar(month);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [month, reload, reloadCalendar, reloadWeek, view, weekStart]);

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
  const visibleItems = items?.filter((item) => showCompleted || item.completed !== true) ?? null;
  const displayItems =
    visibleItems?.filter(
      (item) =>
        item.kind !== 'meeting' ||
        (workspaceSettings.showMeetings &&
          (workspaceSettings.showRecurringMeetings || !item.subtitle.endsWith('周期'))),
    ) ?? null;

  return (
    <main
      className="min-h-screen overflow-x-hidden bg-background p-4 text-foreground"
      style={{
        zoom: workspaceSettings.scale,
        backgroundColor: `color-mix(in srgb, var(--semantic-desktop-background, hsl(var(--background))) ${String(
          Math.round(workspaceSettings.opacity * 100),
        )}%, transparent)`,
        backdropFilter: workspaceSettings.blur ? 'blur(14px)' : undefined,
      }}
    >
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">ProjectPilot</h1>
          <p className="text-sm text-muted-foreground">桌面小窗</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={reload}>
            刷新
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label="打开主窗口"
            onClick={() => {
              openMain();
            }}
          >
            打开主窗口
          </Button>
        </div>
      </header>

      <div className="mt-4 flex gap-2" role="tablist" aria-label="桌面小窗视图">
        <Button
          size="sm"
          role="tab"
          aria-selected={view === 'sevenDays'}
          variant={view === 'sevenDays' ? 'default' : 'outline'}
          onClick={() => {
            selectView('sevenDays');
          }}
        >
          七天
        </Button>
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

      <Button
        className="mt-3"
        size="sm"
        onClick={() => {
          setQuickDate(
            view === 'calendar' ? selectedDate : view === 'sevenDays' ? weekStart : todayHK(),
          );
          setQuickOpen(true);
        }}
      >
        快速新建任务
      </Button>

      {view === 'today' ? (
        <section className="mt-4 rounded-lg border p-4" role="tabpanel">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">今日</h2>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={showCompleted}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setShowCompleted(checked);
                  void loadReminderSettings()
                    .then((settings) =>
                      saveReminderSettings({ ...settings, companionShowCompleted: checked }),
                    )
                    .catch((caught: unknown) => {
                      setError(toAppError(caught).message);
                    });
                }}
              />
              显示已完成
            </label>
          </div>
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
          {displayItems !== null && displayItems.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">今天暂无日程。</p>
          )}
          {displayItems !== null && (
            <ul className="mt-2 space-y-2">
              {displayItems.map((item) => (
                <li
                  key={`${item.kind}:${item.id}`}
                  className="flex items-center justify-between gap-2 rounded border p-2 text-sm"
                >
                  <span>
                    <strong>{item.title}</strong>
                    <span className="block text-muted-foreground">{item.subtitle}</span>
                  </span>
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        openMain(
                          item.taskId !== undefined
                            ? `/tasks/${item.taskId}`
                            : item.kind === 'meeting'
                              ? `/meetings/${item.id}`
                              : 'dashboard',
                        );
                      }}
                    >
                      打开
                    </Button>
                    {item.taskId !== undefined && item.completed !== true && (
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
                    {item.taskId !== undefined && item.completed === true && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void reopenCompanionTask(item.taskId ?? '')
                            .then(() => {
                              void emitInvalidation(['tasks']);
                              reload();
                            })
                            .catch((caught: unknown) => {
                              setError(toAppError(caught).message);
                            });
                        }}
                      >
                        取消完成
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : view === 'sevenDays' ? (
        <section className="mt-4 rounded-lg border p-4" role="tabpanel">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setWeekStart(addDays(weekStart, -7));
              }}
            >
              上一周
            </Button>
            <h2 className="font-medium">
              {weekStart} 至 {addDays(weekStart, 6)}
            </h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setWeekStart(addDays(weekStart, 7));
              }}
            >
              下一周
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setWeekStart(todayHK());
              }}
            >
              返回今天
            </Button>
          </div>
          {week === null ? (
            <p className="mt-3 text-sm text-muted-foreground">正在加载未来七天…</p>
          ) : (
            <div className="mt-3 space-y-3">
              {week.map((day) => (
                <section key={day.date} className="rounded border p-2">
                  <button
                    type="button"
                    className="font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      setQuickDate(day.date);
                      setQuickOpen(true);
                    }}
                  >
                    {day.date}
                  </button>
                  {day.entries.filter(
                    (entry) =>
                      entry.kind !== 'meeting' ||
                      (workspaceSettings.showMeetings &&
                        (workspaceSettings.showRecurringMeetings || entry.recurrence === null)),
                  ).length === 0 ? (
                    <p className="text-sm text-muted-foreground">暂无安排</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-sm">
                      {day.entries
                        .filter(
                          (entry) =>
                            entry.kind !== 'meeting' ||
                            (workspaceSettings.showMeetings &&
                              (workspaceSettings.showRecurringMeetings ||
                                entry.recurrence === null)),
                        )
                        .map((entry) => (
                          <li key={entry.key} className="flex items-center justify-between gap-2">
                            <span>
                              <strong>{entry.kindLabel}</strong> {entry.title}
                              {entry.recurrence === null ? '' : ' · 周期'}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                openMain(
                                  entry.kind === 'task'
                                    ? `/tasks/${entry.sourceId}`
                                    : entry.kind === 'meeting' &&
                                        !entry.sourceId.startsWith('expected:')
                                      ? `/meetings/${entry.sourceId}`
                                      : 'dashboard',
                                );
                              }}
                            >
                              打开
                            </Button>
                          </li>
                        ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
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
              {selectedEntries === undefined ||
              selectedEntries.filter(
                (entry) =>
                  entry.kind !== 'meeting' ||
                  (workspaceSettings.showMeetings &&
                    (workspaceSettings.showRecurringMeetings || entry.recurrence === null)),
              ).length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">所选日期暂无日程。</p>
              ) : (
                <ul className="mt-3 space-y-1 text-sm">
                  {selectedEntries
                    .filter(
                      (entry) =>
                        entry.kind !== 'meeting' ||
                        (workspaceSettings.showMeetings &&
                          (workspaceSettings.showRecurringMeetings || entry.recurrence === null)),
                    )
                    .map((entry) => (
                      <li key={entry.key} className="flex items-center justify-between gap-2">
                        <span>
                          <span className="font-medium">{entry.kindLabel}</span> {entry.title}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            openMain(
                              entry.kind === 'task'
                                ? `/tasks/${entry.sourceId}`
                                : entry.kind === 'meeting' &&
                                    !entry.sourceId.startsWith('expected:')
                                  ? `/meetings/${entry.sourceId}`
                                  : 'dashboard',
                            );
                          }}
                        >
                          打开
                        </Button>
                      </li>
                    ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      <Dialog
        open={quickOpen}
        onOpenChange={(open) => {
          if (!isCreating) setQuickOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>快速新建任务</DialogTitle>
            <DialogDescription>仅填写必要字段；复杂内容可在主程序中继续编辑。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="text-sm">
              名称
              <input
                className="mt-1 block h-10 w-full rounded border bg-background px-3"
                value={quickTitle}
                maxLength={160}
                onChange={(event) => {
                  setQuickTitle(event.target.value);
                }}
              />
            </label>
            <label className="text-sm">
              日期
              <input
                type="date"
                className="mt-1 block h-10 w-full rounded border bg-background px-3"
                value={quickDate}
                onChange={(event) => {
                  setQuickDate(event.target.value);
                }}
              />
            </label>
            <label className="text-sm">
              所属项目
              <select
                className="mt-1 block h-10 w-full rounded border bg-background px-3"
                value={quickProjectId}
                onChange={(event) => {
                  setQuickProjectId(event.target.value);
                }}
              >
                <option value="">请选择项目</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              优先级
              <select
                className="mt-1 block h-10 w-full rounded border bg-background px-3"
                value={quickPriority}
                onChange={(event) => {
                  setQuickPriority(event.target.value as TaskPriority);
                }}
              >
                <option value="urgent">紧急</option>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </label>
            <label className="text-sm">
              简短说明（可选）
              <textarea
                className="mt-1 block min-h-20 w-full rounded border bg-background p-2"
                value={quickDescription}
                maxLength={2000}
                onChange={(event) => {
                  setQuickDescription(event.target.value);
                }}
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isCreating}
              onClick={() => {
                setQuickOpen(false);
              }}
            >
              取消
            </Button>
            <Button
              disabled={
                isCreating || quickTitle.trim() === '' || quickDate === '' || quickProjectId === ''
              }
              onClick={createQuickTask}
            >
              {isCreating ? '正在创建…' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
