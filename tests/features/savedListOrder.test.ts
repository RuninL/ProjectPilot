import { describe, expect, it } from 'vitest';
import { moveIdToTarget } from '@/features/sorting/useSavedListOrder';

describe('moveIdToTarget', () => {
  it('moves the first item directly to the third position', () => {
    expect(moveIdToTarget(['first', 'second', 'third'], 'first', 'third')).toEqual([
      'second',
      'third',
      'first',
    ]);
  });

  it('moves the last item directly to the first position', () => {
    expect(moveIdToTarget(['first', 'second', 'third'], 'third', 'first')).toEqual([
      'third',
      'first',
      'second',
    ]);
  });

  it('does not change the order when dropped on itself', () => {
    expect(moveIdToTarget(['first', 'second'], 'first', 'first')).toEqual(['first', 'second']);
  });
});
