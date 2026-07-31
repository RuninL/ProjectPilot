import { describe, expect, it } from 'vitest';
import {
  dedupeCandidates,
  dueDateCandidate,
  groupByMinute,
  isPaused,
  isQuietHour,
  overdueSummaryCandidate,
  reminderIdentity,
} from '@/services/reminder.service';

describe('reminder service', () => {
  it('uses recurrence occurrence identity rather than a materialized row id', () => {
    expect(
      reminderIdentity({
        entityType: 'meeting',
        entityId: 'rule-1',
        occurrenceDate: '2026-08-01',
        kind: 'start',
        scheduledAt: '2026-08-01T09:00:00+08:00',
        title: 'Review',
      }),
    ).toBe('meeting|rule-1:2026-08-01|start|2026-08-01T09:00:00+08:00');
  });

  it('handles quiet hours that cross midnight', () => {
    expect(isQuietHour('23:00', '22:00', '08:00')).toBe(true);
    expect(isQuietHour('09:00', '22:00', '08:00')).toBe(false);
  });

  it('throttles overdue work into one business-day summary', () => {
    expect(overdueSummaryCandidate(0)).toBeNull();
    expect(overdueSummaryCandidate(3, '2026-08-01')?.kind).toBe('overdue-summary');
  });

  it('does not create stale due-date reminders', () => {
    expect(dueDateCandidate('task', 'task-1', 'Task', '2020-01-01', 1)).toBeNull();
  });

  it('deduplicates scans, groups minute notifications, and honours pause state', () => {
    const candidate = {
      entityType: 'meeting' as const,
      entityId: 'rule',
      occurrenceDate: '2026-08-01',
      kind: 'start',
      scheduledAt: '2026-08-01T09:00:00+08:00',
      title: 'Review',
    };
    expect(dedupeCandidates([candidate, candidate], new Set())).toHaveLength(1);
    expect(groupByMinute([candidate, { ...candidate, entityId: 'rule-2' }])[0]).toHaveLength(2);
    expect(isPaused('2026-08-01T10:00:00+08:00', '2026-08-01T09:00:00+08:00')).toBe(true);
  });
});
