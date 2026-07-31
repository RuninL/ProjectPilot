import { addDays, todayHK } from '@/lib/date';

export interface ReminderCandidate {
  entityType: 'meeting' | 'task' | 'project' | 'milestone' | 'summary';
  entityId: string;
  occurrenceDate?: string;
  kind: string;
  scheduledAt: string;
  title: string;
}

export function dedupeCandidates(
  candidates: readonly ReminderCandidate[],
  delivered: ReadonlySet<string>,
): ReminderCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const identity = reminderIdentity(candidate);
    if (seen.has(identity) || delivered.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function groupByMinute(candidates: readonly ReminderCandidate[]): ReminderCandidate[][] {
  const groups = new Map<string, ReminderCandidate[]>();
  for (const candidate of candidates) {
    const minute = candidate.scheduledAt.slice(0, 16);
    groups.set(minute, [...(groups.get(minute) ?? []), candidate]);
  }
  return [...groups.values()];
}

export function isPaused(pausedUntil: string | null, now: string): boolean {
  return pausedUntil !== null && pausedUntil > now;
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
    title: `共 ${String(overdueCount)} 项逾期任务`,
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

export function meetingCandidate(
  id: string,
  title: string,
  date: string,
  startTime: string | null,
  minutesBefore: number,
): ReminderCandidate | null {
  if (startTime === null || minutesBefore < 0) return null;
  const [hour, minute] = startTime.split(':').map(Number) as [number, number];
  const total = hour * 60 + minute - minutesBefore;
  const scheduledDate = total < 0 ? addDays(date, -1) : date;
  const normalized = ((total % 1440) + 1440) % 1440;
  return {
    entityType: 'meeting',
    entityId: id,
    kind: `meeting-${String(minutesBefore)}m`,
    scheduledAt: `${scheduledDate}T${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}:00+08:00`,
    title,
  };
}

export function dailySummaryCandidate(date = todayHK()): ReminderCandidate {
  return {
    entityType: 'summary',
    entityId: date,
    kind: 'daily-summary',
    scheduledAt: `${date}T08:30:00+08:00`,
    title: 'ProjectPilot 每日摘要',
  };
}
