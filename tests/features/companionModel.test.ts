import { expect, it } from 'vitest';
import { sortCompanionItems } from '@/features/companion/companionModel';
it('sorts companion items by the required stable priority', () => {
  expect(
    sortCompanionItems([
      { id: 'm', kind: 'milestone', title: 'M' },
      { id: 't', kind: 'today-task', title: 'T' },
      { id: 'o', kind: 'overdue-task', title: 'O' },
      { id: 'g', kind: 'meeting', title: 'G' },
    ]).map((item) => item.id),
  ).toEqual(['g', 'o', 't', 'm']);
});
