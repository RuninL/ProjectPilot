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
import { todayHK } from '@/lib/date';
import { toAppError } from '@/lib/errors';
import { emitInvalidation, listenForInvalidation } from '@/lib/invalidation';
import { applyTheme, type Theme } from '@/lib/theme';
import { desktopWidgetStatus, type DesktopWidgetStatus } from '@/lib/commands';
import {
  completeCompanionTask,
  loadCompanionToday,
  reopenCompanionTask,
  type CompanionTodayItem,
} from '@/services/companion.service';
import { loadWidgetSevenDayTasks, loadWidgetTodayTasks } from '@/services/widget.service';
import {
  DEFAULT_DESKTOP_WIDGET_SETTINGS,
  loadDesktopWidgetSettings,
  saveDesktopWidgetSettings,
  type DesktopWidgetSettings,
} from '@/features/settings/services/desktopWidgetSettings.service';
import { sortCompanionItems } from '@/features/companion/companionModel';
import { safeCompanionGeometry } from '@/features/companion/windowGeometry';
import {
  buildSevenDayAgenda,
  buildTodayAgenda,
  type WidgetCalendarDay,
  type WidgetCalendarView,
  type WidgetTaskBar,
  type WidgetView,
} from './widgetModel';

const WIDGET_STATE_EVENT = 'projectpilot:desktop-widget-state';

function monitorId(monitor: { name: string | null; position: { x: number; y: number } }): string {
  return `${monitor.name ?? '显示器'}:${String(monitor.position.x)}:${String(monitor.position.y)}`;
}

/** One task colour bar: keyboard/mouse operable, never a drag region. */
function TaskBar({ bar, onOpen }: { bar: WidgetTaskBar; onOpen: (taskId: string) => void }) {
  const range =
    bar.isStart && bar.isEnd
      ? ''
      : bar.isStart
        ? '（开始）'
        : bar.isEnd
          ? '（截止）'
          : '（进行中）';
  const status = bar.statusLabel === null ? '' : `【${bar.statusLabel}】`;
  return (
    <button
      type="button"
      title={`${status}${bar.title} · ${bar.projectName}${range}`}
      className="block w-full truncate rounded px-2 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ backgroundColor: bar.color, color: bar.textColor }}
      onClick={() => {
        onOpen(bar.taskId);
      }}
    >
      {status}
      {bar.done ? <s>{bar.title}</s> : bar.title}
    </button>
  );
}

function AgendaDay({ day, onOpen }: { day: WidgetCalendarDay; onOpen: (taskId: string) => void }) {
  return (
    <section className="rounded border border-border/60 p-2">
      <h3 className="text-xs font-medium">
        {day.label}
        {day.isToday && <span className="ml-1 rounded bg-primary/15 px-1 text-primary">今天</span>}
      </h3>
      {day.bars.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">暂无任务</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {day.bars.map((bar) => (
            <li key={bar.taskId}>
              <TaskBar bar={bar} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The standalone desktop widget (window label `desktop-widget`). Top level
 * views are 今日任务 | 日历 only; the calendar offers 今天 | 近七天. The window
 * itself is transparent — only this panel paints a translucent background.
 */
export function DesktopWidgetApp() {
  const [view, setView] = useState<WidgetView>('today');
  const [calendarView, setCalendarView] = useState<WidgetCalendarView>('today');
  const [today, setToday] = useState(todayHK());
  const [items, setItems] = useState<CompanionTodayItem[] | null>(null);
  const [agenda, setAgenda] = useState<WidgetCalendarDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const settingsRef = useRef<DesktopWidgetSettings>(DEFAULT_DESKTOP_WIDGET_SETTINGS);
  const todayRequest = useRef(0);
  const agendaRequest = useRef(0);

  // The web layer must be transparent too: html/body/#root paint nothing.
  useEffect(() => {
    document.documentElement.classList.add('desktop-widget-window');
    return () => {
      document.documentElement.classList.remove('desktop-widget-window');
    };
  }, []);

  const reloadToday = useCallback(() => {
    const request = ++todayRequest.current;
    void loadCompanionToday()
      .then((next) => {
        if (request === todayRequest.current) {
          setItems(sortCompanionItems(next));
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (request === todayRequest.current) setError(toAppError(caught).message);
      });
  }, []);

  const reloadAgenda = useCallback((subView: WidgetCalendarView, businessToday: string) => {
    const request = ++agendaRequest.current;
    const load =
      subView === 'seven-day'
        ? loadWidgetSevenDayTasks(businessToday).then((tasks) =>
            buildSevenDayAgenda(tasks, businessToday),
          )
        : loadWidgetTodayTasks(businessToday).then((tasks) => [
            buildTodayAgenda(tasks, businessToday),
          ]);
    void load
      .then((days) => {
        if (request === agendaRequest.current) {
          setAgenda(days);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (request === agendaRequest.current) setError(toAppError(caught).message);
      });
  }, []);

  const reload = useCallback(() => {
    reloadToday();
    reloadAgenda(calendarView, today);
  }, [calendarView, reloadAgenda, reloadToday, today]);

  const persistView = useCallback((next: Partial<DesktopWidgetSettings>) => {
    const merged = { ...settingsRef.current, ...next };
    settingsRef.current = merged;
    void saveDesktopWidgetSettings(merged).catch(() => undefined);
  }, []);

  const selectView = useCallback(
    (next: WidgetView) => {
      setView(next);
      persistView({ lastView: next });
    },
    [persistView],
  );

  const selectCalendarView = useCallback(
    (next: WidgetCalendarView) => {
      setCalendarView(next);
      persistView({ calendarView: next });
      reloadAgenda(next, today);
    },
    [persistView, reloadAgenda, today],
  );

  /** Focus the existing main window (never create a second one) and navigate. */
  const openMain = useCallback((target: string) => {
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
  }, []);

  const openTask = useCallback(
    (taskId: string) => {
      openMain(`/tasks/${taskId}`);
    },
    [openMain],
  );

  const toggleTask = useCallback(
    (item: CompanionTodayItem) => {
      if (item.taskId === undefined) return;
      const action =
        item.completed === true
          ? reopenCompanionTask(item.taskId)
          : completeCompanionTask(item.taskId);
      void action
        .then(() => {
          void emitInvalidation(['tasks']);
          reload();
        })
        .catch((caught: unknown) => {
          setError(toAppError(caught).message);
        });
    },
    [reload],
  );

  // Initial load: restore last view + geometry, then fetch data.
  useEffect(() => {
    void loadDesktopWidgetSettings()
      .then((settings) => {
        settingsRef.current = settings;
        setView(settings.lastView);
        setCalendarView(settings.calendarView);
      })
      .catch(() => undefined);
    void desktopWidgetStatus()
      .then((status) => {
        setLocked(status.locked);
      })
      .catch(() => undefined);
    reloadToday();
  }, [reloadToday]);

  useEffect(() => {
    if (view === 'calendar') reloadAgenda(calendarView, today);
  }, [calendarView, reloadAgenda, today, view]);

  // Cross-midnight refresh: when the business day changes, reload everything.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = todayHK();
      setToday((current) => {
        if (current !== next) {
          reloadToday();
          return next;
        }
        return current;
      });
    }, 60_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [reloadToday]);

  // Stay in sync with the main window's data changes.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void listenForInvalidation(() => {
      reload();
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [reload]);

  // Lock state comes from the real window via the Rust-side event.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void listen<DesktopWidgetStatus>(WIDGET_STATE_EVENT, (event) => {
      setLocked(event.payload.locked);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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

  // Restore geometry on the remembered monitor (safe fallback to primary),
  // then persist moves/resizes debounced.
  useEffect(() => {
    const window = getCurrentWindow();
    let cleanups: (() => void)[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const persist = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        void Promise.all([window.outerPosition(), window.outerSize(), currentMonitor()])
          .then(([position, size, monitor]) => {
            if (monitor === null) return;
            const id = monitorId(monitor);
            const merged = {
              ...settingsRef.current,
              monitorId: id,
              layouts: {
                ...settingsRef.current.layouts,
                [id]: { x: position.x, y: position.y, width: size.width, height: size.height },
              },
            };
            settingsRef.current = merged;
            return saveDesktopWidgetSettings(merged);
          })
          .catch(() => undefined);
      }, 500);
    };
    void Promise.all([loadDesktopWidgetSettings(), availableMonitors(), primaryMonitor()])
      .then(async ([settings, monitors, primary]) => {
        const monitor =
          monitors.find((candidate) => monitorId(candidate) === settings.monitorId) ?? primary;
        if (monitor !== null) {
          const geometry = safeCompanionGeometry(settings.layouts[monitorId(monitor)] ?? null, {
            x: monitor.workArea.position.x,
            y: monitor.workArea.position.y,
            width: monitor.workArea.size.width,
            height: monitor.workArea.size.height,
          });
          await window.setSize(new PhysicalSize(geometry.width, geometry.height));
          await window.setPosition(new PhysicalPosition(geometry.x, geometry.y));
        }
        const registered = await Promise.all([window.onResized(persist), window.onMoved(persist)]);
        if (disposed) {
          for (const cleanup of registered) cleanup();
          return;
        }
        cleanups = registered;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  const visibleItems = useMemo(() => items ?? [], [items]);

  return (
    <main className="flex h-screen flex-col overflow-hidden p-2 text-foreground">
      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border/60 bg-background/85 shadow-sm">
        {/* Native Tauri drag region; disabled while the position is locked.
            Buttons and content below never trigger a window drag. */}
        <header
          {...(locked ? {} : { 'data-tauri-drag-region': true })}
          className={`flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2 ${locked ? '' : 'cursor-move'}`}
        >
          <span className="pointer-events-none select-none text-sm font-semibold">
            ProjectPilot 小窗{locked ? ' · 已锁定' : ''}
          </span>
          <div role="tablist" aria-label="小窗视图" className="flex gap-1">
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
        </header>

        {error !== null && (
          <div
            className="mx-3 mt-2 rounded border border-destructive/40 p-2 text-xs text-destructive"
            role="alert"
          >
            {error}{' '}
            <Button size="sm" variant="outline" onClick={reload}>
              重试
            </Button>
          </div>
        )}

        {view === 'today' ? (
          <section
            className="min-h-0 flex-1 overflow-y-auto p-3"
            role="tabpanel"
            aria-label="今日任务"
          >
            <p className="text-xs text-muted-foreground">{today} · 今日任务</p>
            {items === null && error === null && (
              <p className="mt-2 text-xs text-muted-foreground">正在加载今日任务…</p>
            )}
            {items !== null && visibleItems.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">今天暂无任务。</p>
            )}
            <ul className="mt-2 space-y-1">
              {visibleItems.map((item) => (
                <li
                  key={`${item.kind}:${item.id}`}
                  className="flex items-center gap-2 rounded border border-border/60 px-2 py-1 text-sm"
                >
                  {item.taskId !== undefined && (
                    <input
                      type="checkbox"
                      aria-label={`完成 ${item.title}`}
                      checked={item.completed === true}
                      onChange={() => {
                        toggleTask(item);
                      }}
                    />
                  )}
                  {item.taskId !== undefined ? (
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={`${item.title} · ${item.subtitle}`}
                      onClick={() => {
                        openTask(item.taskId ?? '');
                      }}
                    >
                      {item.completed === true ? <s>{item.title}</s> : item.title}
                      <span className="ml-1 text-xs text-muted-foreground">{item.subtitle}</span>
                    </button>
                  ) : (
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={`${item.title} · ${item.subtitle}`}
                    >
                      {item.title}
                      <span className="ml-1 text-xs text-muted-foreground">{item.subtitle}</span>
                    </span>
                  )}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {item.kind === 'meeting'
                      ? '会议'
                      : item.kind === 'overdue-task'
                        ? '逾期'
                        : item.kind === 'milestone'
                          ? '里程碑'
                          : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="flex min-h-0 flex-1 flex-col p-3" role="tabpanel" aria-label="日历">
            <div role="tablist" aria-label="日历范围" className="flex gap-1">
              <Button
                size="sm"
                role="tab"
                aria-selected={calendarView === 'today'}
                variant={calendarView === 'today' ? 'default' : 'outline'}
                onClick={() => {
                  selectCalendarView('today');
                }}
              >
                今天
              </Button>
              <Button
                size="sm"
                role="tab"
                aria-selected={calendarView === 'seven-day'}
                variant={calendarView === 'seven-day' ? 'default' : 'outline'}
                onClick={() => {
                  selectCalendarView('seven-day');
                }}
              >
                近七天
              </Button>
            </div>
            <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto">
              {agenda === null && error === null && (
                <p className="text-xs text-muted-foreground">正在加载日历…</p>
              )}
              {agenda?.map((day) => (
                <AgendaDay key={day.date} day={day} onOpen={openTask} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
