import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  daysUntil,
  formatDisplay,
  isDueToday,
  isOverdue,
  isThisWeek,
  isValidDateStr,
  parseInput,
  todayHK,
} from '@/lib/date';

describe('todayHK', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the Hong Kong calendar day, not the UTC day, just after HK midnight', () => {
    // 2026-07-14T16:30:00Z == 2026-07-15 00:30 in Asia/Hong_Kong (UTC+8).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T16:30:00Z'));

    expect(todayHK()).toBe('2026-07-15');
    // The forbidden UTC-slice approach would wrongly yield the previous day.
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-07-14');
  });

  it('agrees with the UTC day well inside the same HK day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T04:00:00Z')); // 12:00 HK
    expect(todayHK()).toBe('2026-07-14');
  });
});

describe('isValidDateStr', () => {
  it('accepts real dates including leap day', () => {
    expect(isValidDateStr('2024-02-29')).toBe(true);
    expect(isValidDateStr('2026-12-31')).toBe(true);
  });

  it('rejects malformed and impossible dates', () => {
    expect(isValidDateStr('2026-02-30')).toBe(false);
    expect(isValidDateStr('2025-02-29')).toBe(false); // not a leap year
    expect(isValidDateStr('2026-13-01')).toBe(false);
    expect(isValidDateStr('2026-7-1')).toBe(false);
    expect(isValidDateStr('not-a-date')).toBe(false);
  });
});

describe('isOverdue', () => {
  const today = '2026-07-14';

  it('is true for a past due date on an open task', () => {
    expect(isOverdue('2026-07-13', 'in_progress', today)).toBe(true);
  });

  it('is false for closed tasks even when past due', () => {
    expect(isOverdue('2026-07-13', 'done', today)).toBe(false);
    expect(isOverdue('2026-07-13', 'cancelled', today)).toBe(false);
  });

  it('is false today or with no due date', () => {
    expect(isOverdue(today, 'todo', today)).toBe(false);
    expect(isOverdue(null, 'todo', today)).toBe(false);
  });
});

describe('isDueToday / isThisWeek', () => {
  const today = '2026-07-15'; // a Wednesday

  it('detects due-today', () => {
    expect(isDueToday('2026-07-15', today)).toBe(true);
    expect(isDueToday('2026-07-16', today)).toBe(false);
    expect(isDueToday(null, today)).toBe(false);
  });

  it('detects the Monday–Sunday week window', () => {
    expect(isThisWeek('2026-07-13', today)).toBe(true); // Monday
    expect(isThisWeek('2026-07-19', today)).toBe(true); // Sunday
    expect(isThisWeek('2026-07-12', today)).toBe(false); // prev Sunday
    expect(isThisWeek('2026-07-20', today)).toBe(false); // next Monday
  });
});

describe('daysUntil', () => {
  it('counts calendar days across a month boundary; today = 0', () => {
    expect(daysUntil('2026-07-14', '2026-07-14')).toBe(0);
    expect(daysUntil('2026-08-01', '2026-07-31')).toBe(1);
    expect(daysUntil('2026-07-10', '2026-07-14')).toBe(-4);
  });
});

describe('formatDisplay / parseInput', () => {
  it('shows a placeholder for missing dates', () => {
    expect(formatDisplay(null)).toBe('未设置');
    expect(formatDisplay('')).toBe('未设置');
    expect(formatDisplay('2026-07-14')).toBe('2026-07-14');
  });

  it('parses empty input to null and validates non-empty input', () => {
    expect(parseInput('   ')).toBeNull();
    expect(parseInput('2026-07-14')).toBe('2026-07-14');
    expect(() => parseInput('2026-02-30')).toThrow();
  });
});
