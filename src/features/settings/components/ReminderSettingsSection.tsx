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
        Notifications and reminders
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Native Windows notifications stay local. Permission:{' '}
        {permission === 'granted' ? 'granted' : 'not granted'}.
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
          Request permission
        </Button>
        <Button
          disabled={permission !== 'granted'}
          onClick={() =>
            void sendTestNotification().catch((caught: unknown) => {
              setError(toAppError(caught).message);
            })
          }
        >
          Send test notification
        </Button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => void save({ ...settings, enabled: event.target.checked })}
          />{' '}
          Enable reminders
        </Label>
        <Label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.closeToTray}
            onChange={(event) => void save({ ...settings, closeToTray: event.target.checked })}
          />{' '}
          Close to tray
        </Label>
        <Label>
          Meeting lead
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
            <option value="none">Off</option>
            <option value="5">5 min</option>
            <option value="10">10 min</option>
            <option value="15">15 min</option>
            <option value="30">30 min</option>
            <option value="60">1 hour</option>
            <option value="1440">1 day</option>
          </select>
        </Label>
        <Label>
          Task lead
          <select
            className="ml-2 rounded border bg-background p-1"
            value={settings.taskLeadDays}
            onChange={(event) =>
              void save({ ...settings, taskLeadDays: event.target.value as ReminderSettings['taskLeadDays'] })
            }
          >
            <option value="none">Off</option>
            <option value="0">Due today</option>
            <option value="1">1 day</option>
            <option value="3">3 days</option>
          </select>
        </Label>
        <Label>
          Project and milestone lead
          <select
            className="ml-2 rounded border bg-background p-1"
            value={settings.projectMilestoneLeadDays}
            onChange={(event) =>
              void save({
                ...settings,
                projectMilestoneLeadDays: event.target.value as ReminderSettings['projectMilestoneLeadDays'],
              })
            }
          >
            <option value="none">Off</option>
            <option value="0">Due today</option>
            <option value="1">1 day</option>
            <option value="3">3 days</option>
            <option value="7">7 days</option>
          </select>
        </Label>
        <Label>
          Quiet start
          <input
            aria-label="Quiet start"
            className="ml-2 rounded border bg-background p-1"
            type="time"
            value={settings.quietStart}
            onChange={(event) => void save({ ...settings, quietStart: event.target.value })}
          />
        </Label>
        <Label>
          Quiet end
          <input
            aria-label="Quiet end"
            className="ml-2 rounded border bg-background p-1"
            type="time"
            value={settings.quietEnd}
            onChange={(event) => void save({ ...settings, quietEnd: event.target.value })}
          />
        </Label>
        <Label>
          Daily summary
          <input
            aria-label="Daily summary time"
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
            onChange={(event) => void save({ ...settings, companionAlwaysOnTop: event.target.checked })}
          />{' '}
          Keep companion on top
        </Label>
      </div>
      <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
        {settings.enabled ? 'Reminders are enabled.' : 'Reminders are paused.'}
        {settings.pausedUntil !== null ? ` Resume time: ${settings.pausedUntil}.` : ''}
      </p>
      {saved && (
        <p className="mt-3 text-sm text-primary" role="status">
          Settings saved.
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
