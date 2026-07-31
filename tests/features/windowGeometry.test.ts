import { expect, it } from 'vitest';
import { safeCompanionGeometry } from '@/features/companion/windowGeometry';

it('falls back when a disconnected monitor leaves companion fully offscreen', () => {
  expect(
    safeCompanionGeometry(
      { x: 4000, y: 100, width: 380, height: 520 },
      { x: 0, y: 0, width: 1920, height: 1080 },
    ).x,
  ).toBe(40);
});
