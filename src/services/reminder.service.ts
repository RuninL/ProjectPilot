import { addDays, todayHK } from '@/lib/date';

export interface ReminderCandidate {
  entityType: 'meeting' | 'task' | 'project' | 'milestone' | 'summary';
  entityId: string;
  occurrenceDate?: string;
  kind: string;
  scheduledAt: string;
  title: string;
}

/** Stable across scans and materialization: an occurrence uses its rule/date identity, not its row id. */
export function reminderIdentity(candidate: ReminderCandidate): string {
  return [
    candidate.entityType,
    candidate.occurrenceDate === undefined
      ? candidate.entityId
      : `${candidate.entityId}:${candidate.occurrenceDate}`,
    candidate.kind,
    candidate.scheduledAt,
  ].join('|');
}

export function isQuietHour(time: string, start: string, end: string): boolean {
  if (start === end) return false;
  return start < end ? time >= start && time < end : time >= start || time < end;
}

/** Limits historical overdue noise to one aggregate per local business date. */
export function overdueSummaryCandidate(
  overdueCount: number,
  date = todayHK(),
): ReminderCandidate | null {
  if (overdueCount === 0) return null;
  return {
    entityType: 'summary',
    entityId: date,
    kind: 'overdue-summary',
    scheduledAt: `${date}T08:30:00+08:00`,
    title: `${String(overdueCount)} overdue task${overdueCount === 1 ? '' : 's'}`,
  };
}

export function dueDateCandidate(
  entityType: 'task' | 'project' | 'milestone',
  entityId: string,
  title: string,
  dueDate: string,
  leadDays: number,
): ReminderCandidate | null {
  const scheduledDate = addDays(dueDate, -leadDays);
  if (scheduledDate < todayHK()) return null;
  return {
    entityType,
    entityId,
    kind: `due-${String(leadDays)}d`,
    scheduledAt: `${scheduledDate}T08:30:00+08:00`,
    title,
  };
}
