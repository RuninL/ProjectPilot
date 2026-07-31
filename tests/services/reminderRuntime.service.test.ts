import { describe, expect, it } from 'vitest';
import type { Meeting } from '@/types';
import { DEFAULT_REMINDER_SETTINGS } from '@/features/settings/services/reminderSettings.service';
import { buildReminderCandidates } from '@/services/reminderRuntime.service';

function meeting(startTime: string | null): Meeting {
  return {
    id: 'meeting-1',
    project_id: null,
    topic: 'Weekly review',
    date: '2026-08-03',
    start_time: startTime,
    attendees: '',
    agenda: '',
    notes: '',
    decisions: '',
    risks: '',
    source_rule_id: 'rule-1',
    source_occurrence_date: '2026-08-03',
    is_sample: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

describe('reminder runtime candidates', () => {
  it('keeps recurring meeting identity stable and routes date-only meetings to the daily summary', () => {
    const candidates = buildReminderCandidates(
      {
        tasks: [],
        projects: [],
        milestones: [],
        meetings: [meeting('09:00'), meeting(null)],
      },
      { ...DEFAULT_REMINDER_SETTINGS, meetingMinutesBefore: '15', dailySummaryTime: '08:30' },
      '2026-08-03',
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'meeting',
          entityId: 'rule-1',
          occurrenceDate: '2026-08-03',
          scheduledAt: '2026-08-03T08:45:00+08:00',
        }),
        expect.objectContaining({
          kind: 'date-only-meetings',
          scheduledAt: '2026-08-03T08:30:00+08:00',
        }),
      ]),
    );
  });
});
