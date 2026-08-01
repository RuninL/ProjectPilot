import { describe, expect, it } from 'vitest';
import {
  buildMeetingOccurrences,
  filterAndSortMeetingOccurrences,
} from '@/features/meetings/meetingListModel';
import { makeMeeting } from '../helpers/fixtures';
import type { RecurrenceException, RecurrenceRule } from '@/types';
import { NOW } from '../helpers/testDb';

const rule: RecurrenceRule = {
  id: 'rule',
  project_id: null,
  kind: 'meeting',
  title: '周会',
  byweekday: 5,
  interval: 1,
  start_date: '2026-08-01',
  end_date: '2026-08-31',
  time_of_day: '10:00',
  duration_minutes: 60,
  default_priority: null,
  note: '',
  meeting_url: 'https://meet.example.com/series',
  is_active: 1,
  is_sample: 0,
  created_at: NOW,
  updated_at: NOW,
};

it('merges expected and materialized occurrences without duplicates', () => {
  const materialized = makeMeeting({
    id: 'meeting',
    date: '2026-08-01',
    source_rule_id: 'rule',
    source_occurrence_date: '2026-08-01',
  });
  const exceptions: RecurrenceException[] = [
    {
      id: 'exception',
      rule_id: 'rule',
      occurrence_date: '2026-08-08',
      action: 'rescheduled',
      replacement_date: '2026-08-09',
      materialized_id: null,
      created_at: NOW,
      updated_at: NOW,
    },
  ];
  const occurrences = buildMeetingOccurrences(
    [materialized],
    [rule],
    new Map([['rule', exceptions]]),
    '2026-08-01',
    '2026-08-10',
  );
  expect(occurrences.map((item) => item.date)).toEqual(['2026-08-01', '2026-08-09']);
  expect(occurrences.map((item) => item.id)).toEqual([
    'occurrence:rule:2026-08-01',
    'occurrence:rule:2026-08-08',
  ]);
  expect(occurrences[1]?.meeting_url).toBe('https://meet.example.com/series');
});

describe('meeting range and actual-time sorting', () => {
  const occurrences = [
    makeMeeting({ id: 'past', date: '2026-08-01', start_time: '09:00' }),
    makeMeeting({ id: 'future', date: '2026-08-01', start_time: '11:00' }),
    makeMeeting({ id: 'later', date: '2026-08-02', start_time: null }),
  ].map((meeting) => ({
    ...meeting,
    meeting_url: null,
    meeting,
  }));
  const now = { date: '2026-08-01', time: '10:00' };

  it('classifies future, today and past at the Hong Kong wall clock', () => {
    expect(
      filterAndSortMeetingOccurrences(occurrences, 'future', 'time_asc', now).map(
        (item) => item.id,
      ),
    ).toEqual(['future', 'later']);
    expect(
      filterAndSortMeetingOccurrences(occurrences, 'today', 'time_asc', now).map((item) => item.id),
    ).toEqual(['past', 'future']);
    expect(
      filterAndSortMeetingOccurrences(occurrences, 'past', 'time_desc', now).map((item) => item.id),
    ).toEqual(['past']);
  });
});
