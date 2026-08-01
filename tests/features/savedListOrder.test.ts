import { describe, expect, it } from 'vitest';
import { moveIdToTarget, moveVisibleIdToTarget } from '@/features/sorting/useSavedListOrder';

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

describe('moveVisibleIdToTarget', () => {
  it('reorders visible items inside their own slots, keeping hidden items in place', () => {
    // Full A,B,C,D,E; search shows B,D; dragging D before B → A,D,C,B,E.
    expect(moveVisibleIdToTarget(['A', 'B', 'C', 'D', 'E'], ['B', 'D'], 'D', 'B')).toEqual([
      'A',
      'D',
      'C',
      'B',
      'E',
    ]);
  });

  it('never loses or appends hidden items', () => {
    const next = moveVisibleIdToTarget(['A', 'B', 'C', 'D', 'E'], ['A', 'C', 'E'], 'E', 'A');
    expect(next).toEqual(['E', 'B', 'A', 'D', 'C']);
    expect([...next].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('matches a plain move when every item is visible', () => {
    expect(moveVisibleIdToTarget(['A', 'B', 'C'], ['A', 'B', 'C'], 'A', 'C')).toEqual(
      moveIdToTarget(['A', 'B', 'C'], 'A', 'C'),
    );
  });

  it('ignores drops on hidden or unknown targets', () => {
    expect(moveVisibleIdToTarget(['A', 'B', 'C'], ['A', 'C'], 'A', 'B')).toEqual(['A', 'B', 'C']);
    expect(moveVisibleIdToTarget(['A', 'B', 'C'], ['A', 'C'], 'X', 'C')).toEqual(['A', 'B', 'C']);
  });
});
