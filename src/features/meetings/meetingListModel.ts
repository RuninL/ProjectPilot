import { addDays, todayHK } from '@/lib/date';
import { expandRule } from '@/services/recurrence.service';
import type { Meeting, RecurrenceException, RecurrenceRule } from '@/types';

export type MeetingRange = 'future' | 'today' | 'past' | 'all';
export type MeetingTimeSort = 'time_asc' | 'time_desc';

export interface MeetingOccurrence {
  id: string;
  project_id: string | null;
  topic: string;
  date: string;
  start_time: string | null;
  meeting_url: string | null;
  source_rule_id: string | null;
  source_occurrence_date: string | null;
  meeting: Meeting | null;
}

export function hkNowParts(now = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    time: `${read('hour')}:${read('minute')}`,
  };
}

export function buildMeetingOccurrences(
  meetings: readonly Meeting[],
  rules: readonly RecurrenceRule[],
  exceptionsByRule: ReadonlyMap<string, readonly RecurrenceException[]>,
  from = addDays(todayHK(), -365),
  to = addDays(todayHK(), 365),
): MeetingOccurrence[] {
  const materializedKeys = new Set(
    meetings
      .filter(
        (meeting) => meeting.source_rule_id !== null && meeting.source_occurrence_date !== null,
      )
      .map(
        (meeting) => `${meeting.source_rule_id ?? ''}\u0000${meeting.source_occurrence_date ?? ''}`,
      ),
  );
  const stored: MeetingOccurrence[] = meetings.map((meeting) => ({
    id: meeting.id,
    project_id: meeting.project_id,
    topic: meeting.topic,
    date: meeting.date,
    start_time: meeting.start_time,
    meeting_url: meeting.meeting_url ?? null,
    source_rule_id: meeting.source_rule_id,
    source_occurrence_date: meeting.source_occurrence_date,
    meeting,
  }));
  const expected = rules.flatMap((rule) => {
    if (rule.kind !== 'meeting') return [];
    const occurrences = expandRule(
      { ...rule, end_date: rule.end_date ?? to },
      from,
      to,
      null,
      exceptionsByRule.get(rule.id) ?? [],
    ).occurrences;
    return occurrences
      .filter((occurrence) => !materializedKeys.has(`${rule.id}\u0000${occurrence.occurrenceDate}`))
      .map((occurrence): MeetingOccurrence => ({
        id: `expected:${rule.id}:${occurrence.occurrenceDate}`,
        project_id: rule.project_id,
        topic: rule.title,
        date: occurrence.date,
        start_time: rule.time_of_day,
        meeting_url: rule.meeting_url ?? null,
        source_rule_id: rule.id,
        source_occurrence_date: occurrence.occurrenceDate,
        meeting: null,
      }));
  });
  return [...stored, ...expected];
}

function startKey(occurrence: MeetingOccurrence): string {
  return `${occurrence.date}T${occurrence.start_time ?? '24:00'}`;
}

export function filterAndSortMeetingOccurrences(
  occurrences: readonly MeetingOccurrence[],
  range: MeetingRange,
  sort: MeetingTimeSort,
  now = hkNowParts(),
): MeetingOccurrence[] {
  const nowKey = `${now.date}T${now.time}`;
  return occurrences
    .filter((occurrence) => {
      if (range === 'all') return true;
      if (range === 'today') return occurrence.date === now.date;
      if (occurrence.start_time === null) {
        return range === 'future' ? occurrence.date > now.date : occurrence.date < now.date;
      }
      return range === 'future' ? startKey(occurrence) > nowKey : startKey(occurrence) < nowKey;
    })
    .sort((left, right) => {
      const comparison =
        startKey(left).localeCompare(startKey(right)) || left.id.localeCompare(right.id);
      return sort === 'time_asc' ? comparison : -comparison;
    });
}
