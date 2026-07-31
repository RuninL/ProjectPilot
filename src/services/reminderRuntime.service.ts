import { loadCompanionToday } from './companion.service';
import { reminderIdentity, type ReminderCandidate } from './reminder.service';
import { sendTestNotification } from '@/features/settings/services/notification.service';
import {
  loadDeliveredReminderIds,
  loadReminderSettings,
  saveDeliveredReminderIds,
} from '@/features/settings/services/reminderSettings.service';

export async function scanAndNotifyReminders(now = new Date().toISOString()): Promise<void> {
  const settings = await loadReminderSettings();
  if (!settings.enabled || (settings.pausedUntil !== null && settings.pausedUntil > now)) return;
  const delivered = await loadDeliveredReminderIds();
  const candidates: ReminderCandidate[] = (await loadCompanionToday())
    .filter((item) => item.kind === 'overdue-task' || item.kind === 'today-task')
    .map((item) => ({
      entityType: 'task',
      entityId: item.id,
      kind: item.kind,
      scheduledAt: now.slice(0, 16),
      title: item.title,
    }));
  const next = candidates.filter((candidate) => !delivered.has(reminderIdentity(candidate)));
  if (next.length === 0) return;
  await sendTestNotification();
  await saveDeliveredReminderIds([...delivered, ...next.map(reminderIdentity)]);
}
