import { addDays, inclusiveDays, mondayWeekdayOf, startOfWeekStr } from '@/lib/date';
import type { RecurrenceException, RecurrenceRule } from '@/types';

export const MAX_RECURRENCE_OCCURRENCES = 500;

export interface Occurrence {
  readonly date: string;
  readonly materialized_id: string | null;
}

export interface ExpansionResult {
  readonly occurrences: readonly Occurrence[];
  readonly truncated: boolean;
}

/**
 * Expands weekly rules in date-string space. A matching start-date weekday is
 * included; otherwise the first matching weekday after the start is used.
 */
export function expandRule(
  rule: RecurrenceRule,
  windowStart: string,
  windowEnd: string,
  projectEndDate: string | null,
  exceptions: readonly RecurrenceException[],
): ExpansionResult {
  if (!rule.is_active) return { occurrences: [], truncated: false };
  const effectiveEnd = rule.end_date ?? projectEndDate;
  if (effectiveEnd === null) throw new Error('项目未设置截止日期时，周期规则必须设置结束日期');
  const from = rule.start_date > windowStart ? rule.start_date : windowStart;
  const to = effectiveEnd < windowEnd ? effectiveEnd : windowEnd;
  if (from > to) return { occurrences: [], truncated: false };

  const exceptionsByDate = new Map(
    exceptions.map((exception) => [exception.occurrence_date, exception]),
  );
  const anchorWeek = startOfWeekStr(rule.start_date);
  const offset = (rule.byweekday - mondayWeekdayOf(rule.start_date) + 7) % 7;
  let candidate = addDays(rule.start_date, offset);
  const occurrences: Occurrence[] = [];

  while (candidate <= to) {
    const weeksFromAnchor = (inclusiveDays(anchorWeek, startOfWeekStr(candidate)) - 1) / 7;
    if (candidate >= from && weeksFromAnchor % rule.interval === 0) {
      const exception = exceptionsByDate.get(candidate);
      if (exception?.action !== 'skip') {
        occurrences.push({
          date: candidate,
          materialized_id: exception?.action === 'materialized' ? exception.materialized_id : null,
        });
        if (occurrences.length === MAX_RECURRENCE_OCCURRENCES) {
          return { occurrences, truncated: addDays(candidate, rule.interval * 7) <= to };
        }
      }
    }
    candidate = addDays(candidate, 7);
  }
  return { occurrences, truncated: false };
}
