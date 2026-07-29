import { describe, expect, it } from 'vitest';
import { calculateRiskLevel } from '@/services/riskLevel';

describe('calculateRiskLevel', () => {
  it.each([
    ['low', 'low', 'low'],
    ['low', 'medium', 'low'],
    ['low', 'high', 'low'],
    ['medium', 'low', 'low'],
    ['medium', 'medium', 'medium'],
    ['medium', 'high', 'high'],
    ['high', 'low', 'low'],
    ['high', 'medium', 'high'],
    ['high', 'high', 'critical'],
  ] as const)('maps %s likelihood and %s impact to %s', (likelihood, impact, expected) => {
    expect(calculateRiskLevel(likelihood, impact)).toBe(expected);
  });
});
