import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toAppError } from '@/lib/errors';
import {
  getNotificationPermission,
  requestNotificationPermission,
  sendTestNotification,
} from '../services/notification.service';
import {
  DEFAULT_REMINDER_SETTINGS,
  loadReminderSettings,
  saveReminderSettings,
  type ReminderSettings,
} from '../services/reminderSettings.service';

export function ReminderSettingsSection() {
  const [settings, setSettings] = useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [permission, setPermission] = useState<'granted' | 'denied'>('denied');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void Promise.all([loadReminderSettings(), getNotificationPermission()])
      .then(([next, state]) => {
        setSettings(next);
        setPermission(state);
      })
      .catch((caught: unknown) => {
        setError(toAppError(caught).message);
      });
  }, []);
  const save = async (next: ReminderSettings) => {
    setSettings(next);
    setSaved(false);
    try {
      await saveReminderSettings(next);
      setSaved(true);
    } catch (caught) {
      setError(toAppError(caught).message);
    }
  };
  return (
    <section className="mb-6 rounded-lg border bg-card p-4" aria-labelledby="reminders-heading">
      <h2 id="reminders-heading" className="text-lg font-medium">
        通知与提醒
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        原生 Windows 通知仅在本机发送。权限状态：
        {permission === 'granted' ? '已授予' : '未授予'}。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() =>
            void requestNotificationPermission()
              .then((state) => {
                setPermission(state);
              })
              .catch((caught: unknown) => {
                setError(toAppError(caught).message);
              })
          }
        >
          请求通知权限
        </Button>
        <Button
          disabled={permission !== 'granted'}
          onClick={() =>
            void sendTestNotification().catch((caught: unknown) => {
              setError(toAppError(caught).message);
            })
          }
        >
          发送测试通知
        </Button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => void save({ ...settings, enabled: event.target.checked })}
          />{' '}
          启用提醒
        </Label>
        <Label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.closeToTray}
            onChange={(event) => void save({ ...settings, closeToTray: event.target.checked })}
          />{' '}
          关闭主窗口时隐藏到托盘
        </Label>
        <Label>
          会议提前提醒
          <select
            className="ml-2 rounded border bg-background p-1"
            value={settings.meetingMinutesBefore}
            onChange={(event) =>
              void save({
                ...settings,
                meetingMinutesBefore: event.target
                  .value as ReminderSettings['meetingMinutesBefore'],
              })
            }
          >
            <option value="none">关闭</option>
            <option value="5">5 分钟</option>
            <option value="10">10 分钟</option>
            <option value="15">15 分钟</option>
            <option value="30">30 分钟</option>
            <option value="60">1 小时</option>
            <option value="1440">1 天</option>
          </select>
        </Label>
        <Label>
          任务提前提醒
          <select
            className="ml-2 rounded border bg-background p-1"
            value={settings.taskLeadDays}
            onChange={(event) =>
              void save({
                ...settings,
                taskLeadDays: event.target.value as ReminderSettings['taskLeadDays'],
              })
            }
          >
            <option value="none">关闭</option>
            <option value="0">今日 due</option>
            <option value="1">提前 1 天</option>
            <option value="3">提前 3 天</option>
          </select>
        </Label>
        <Label>
          项目和里程碑提前提醒
          <select
            className="ml-2 rounded border bg-background p-1"
            value={settings.projectMilestoneLeadDays}
            onChange={(event) =>
              void save({
                ...settings,
                projectMilestoneLeadDays: event.target
                  .value as ReminderSettings['projectMilestoneLeadDays'],
              })
            }
          >
            <option value="none">关闭</option>
            <option value="0">今日 due</option>
            <option value="1">提前 1 天</option>
            <option value="3">提前 3 天</option>
            <option value="7">提前 7 天</option>
          </select>
        </Label>
        <Label>
          勿扰开始时间
          <input
            aria-label="勿扰开始时间"
            className="ml-2 rounded border bg-background p-1"
            type="time"
            value={settings.quietStart}
            onChange={(event) => void save({ ...settings, quietStart: event.target.value })}
          />
        </Label>
        <Label>
          勿扰结束时间
          <input
            aria-label="勿扰结束时间"
            className="ml-2 rounded border bg-background p-1"
            type="time"
            value={settings.quietEnd}
            onChange={(event) => void save({ ...settings, quietEnd: event.target.value })}
          />
        </Label>
        <Label>
          每日摘要时间
          <input
            aria-label="每日摘要时间"
            className="ml-2 rounded border bg-background p-1"
            type="time"
            value={settings.dailySummaryTime}
            onChange={(event) => void save({ ...settings, dailySummaryTime: event.target.value })}
          />
        </Label>
        <Label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.companionAlwaysOnTop}
            onChange={(event) =>
              void save({ ...settings, companionAlwaysOnTop: event.target.checked })
            }
          />{' '}
          桌面小窗保持置顶
        </Label>
      </div>
      <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
        {settings.enabled ? '提醒已启用。' : '提醒已暂停。'}
        {settings.pausedUntil !== null ? `恢复时间：${settings.pausedUntil}。` : ''}
      </p>
      {saved && (
        <p className="mt-3 text-sm text-primary" role="status">
          设置已保存。
        </p>
      )}
      {error !== null && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
