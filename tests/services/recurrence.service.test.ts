import { describe, expect, it } from 'vitest';
import { expandRule, MAX_RECURRENCE_OCCURRENCES } from '@/services/recurrence.service';
import type { RecurrenceRule } from '@/types';

const rule = (overrides: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  id: 'r',
  project_id: 'p',
  kind: 'task',
  title: '每周事项',
  byweekday: 0,
  interval: 1,
  start_date: '2025-12-29',
  end_date: null,
  time_of_day: null,
  duration_minutes: null,
  default_priority: 'medium',
  note: '',
  is_active: 1,
  is_sample: 0,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
  ...overrides,
});

describe('expandRule', () => {
  it('includes a start date that falls on the selected weekday across a year boundary', () => {
    expect(
      expandRule(rule(), '2025-12-01', '2026-01-31', '2026-01-31', []).occurrences.map(
        (item) => item.date,
      ),
    ).toEqual(['2025-12-29', '2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
  });
  it('uses the start week as the interval anchor and applies exceptions', () => {
    const result = expandRule(
      rule({ start_date: '2026-01-05', interval: 2 }),
      '2026-01-01',
      '2026-03-01',
      '2026-03-01',
      [
        {
          id: 'e',
          rule_id: 'r',
          occurrence_date: '2026-02-02',
          action: 'materialized',
          materialized_id: 't',
          created_at: '',
          updated_at: '',
        },
        {
          id: 's',
          rule_id: 'r',
          occurrence_date: '2026-02-16',
          action: 'skip',
          materialized_id: null,
          created_at: '',
          updated_at: '',
        },
      ],
    );
    expect(result.occurrences).toEqual([
      { date: '2026-01-05', materialized_id: null },
      { date: '2026-01-19', materialized_id: null },
      { date: '2026-02-02', materialized_id: 't' },
    ]);
  });
  it('expands Wednesday and Sunday rules using the Monday-first weekday convention', () => {
    expect(
      expandRule(
        rule({ byweekday: 2, start_date: '2026-01-05' }),
        '2026-01-01',
        '2026-01-18',
        '2026-01-18',
        [],
      ).occurrences.map((item) => item.date),
    ).toEqual(['2026-01-07', '2026-01-14']);
    expect(
      expandRule(
        rule({ byweekday: 6, start_date: '2026-01-05' }),
        '2026-01-01',
        '2026-01-18',
        '2026-01-18',
        [],
      ).occurrences.map((item) => item.date),
    ).toEqual(['2026-01-11', '2026-01-18']);
  });
  it('rejects unbounded rules and caps expansion', () => {
    expect(() => expandRule(rule(), '2026-01-01', '2026-02-01', null, [])).toThrow(
      '周期规则必须设置结束日期',
    );
    const result = expandRule(
      rule({ start_date: '2000-01-03' }),
      '2000-01-01',
      '2030-01-01',
      '2030-01-01',
      [],
    );
    expect(result.occurrences).toHaveLength(MAX_RECURRENCE_OCCURRENCES);
    expect(result.truncated).toBe(true);
  });
});
