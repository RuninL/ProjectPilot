import { useEffect, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { Button } from '@/components/ui/button';
import { shiftMonth, WEEKDAY_LABELS, type CalendarMonth } from '@/features/calendar/calendarModel';
import { todayHK } from '@/lib/date';
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

export function CompanionApp() {
  const [view, setView] = useState<'today' | 'calendar'>('today');
  const [items, setItems] = useState<CompanionTodayItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<CalendarMonth | null>(null);
  const [month, setMonth] = useState(todayHK().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(todayHK());

  const reload = () => {
    setError(null);
    void loadCompanionToday()
      .then((next) => {
        setItems(sortCompanionItems(next));
      })
      .catch((caught: unknown) => {
        setError(toAppError(caught).message);
      });
  };

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

  const complete = (taskId: string) => {
    void completeCompanionTask(taskId)
      .then(() => {
        void emitInvalidation(['tasks']);
        reload();
      })
      .catch((caught: unknown) => {
        setError(toAppError(caught).message);
      });
  };

  const reloadCalendar = (nextMonth: string) => {
    void getCalendarService()
      .then((service) => service.loadMonth(nextMonth))
      .then(setCalendar)
      .catch((caught: unknown) => {
        setError(toAppError(caught).message);
      });
  };

  useEffect(() => {
    const initialMonth = todayHK().slice(0, 7);
    reload();
    reloadCalendar(initialMonth);
    void loadReminderSettings().then((settings) => {
      setView(settings.companionView);
    });
  }, []);

  useEffect(() => {
    const window = getCurrentWindow();
    let resizeCleanup: (() => void) | null = null;
    let moveCleanup: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
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
            setError(toAppError(caught).message);
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
        resizeCleanup = await window.onResized(persist);
        moveCleanup = await window.onMoved(persist);
      })
      .catch((caught: unknown) => {
        setError(toAppError(caught).message);
      });
    return () => {
      if (timer !== null) clearTimeout(timer);
      resizeCleanup?.();
      moveCleanup?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listenForInvalidation(() => {
      reload();
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<Theme>('projectpilot:theme-changed', (event) => {
      applyTheme(event.payload);
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
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
    reloadCalendar(nextMonth);
  };

  const nextMeeting = items?.find((item) => item.kind === 'meeting');
  const overdueCount = items?.filter((item) => item.kind === 'overdue-task').length ?? 0;
  const todayTaskCount = items?.filter((item) => item.kind === 'today-task').length ?? 0;
  const selectedEntries = calendar?.weeks.flat().find((day) => day.date === selectedDate)?.entries;

  return (
    <main className="min-h-screen overflow-x-hidden bg-background p-4 text-foreground">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">ProjectPilot</h1>
          <p className="text-sm text-muted-foreground">桌面小窗</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          aria-label="打开主 ProjectPilot 窗口"
          onClick={openMain}
        >
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
                        complete(item.taskId ?? '');
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
        <section className="mt-4 rounded-lg border p-4" role="tabpanel">
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
              {calendar?.label ?? `${month.slice(0, 4)} 年 ${String(Number(month.slice(5, 7)))} 月`}
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
          {calendar === null ? (
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
              <div className="mt-1 grid grid-cols-7 gap-1" aria-label={`${calendar.label} 日历`}>
                {calendar.weeks.flat().map((day) => (
                  <button
                    key={day.date}
                    type="button"
                    className={`min-h-9 rounded border text-xs ${
                      day.inMonth ? '' : 'text-muted-foreground opacity-50'
                    } ${day.isToday ? 'border-primary font-semibold' : ''}`}
                    aria-pressed={selectedDate === day.date}
                    onClick={() => {
                      setSelectedDate(day.date);
                    }}
                  >
                    {day.dayOfMonth}
                    {day.entries.length > 0 ? ' ·' : ''}
                  </button>
                ))}
              </div>
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
    </main>
  );
}
