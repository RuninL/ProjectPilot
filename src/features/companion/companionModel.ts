export type CompanionItemKind = 'meeting' | 'overdue-task' | 'today-task' | 'milestone' | 'other';
export interface CompanionItem {
  id: string;
  kind: CompanionItemKind;
  startsAt?: string;
  title: string;
}
const rank: Record<CompanionItemKind, number> = {
  meeting: 0,
  'overdue-task': 1,
  'today-task': 2,
  milestone: 3,
  other: 4,
};
/** Stable, deterministic ordering for the compact Today view. */
export function sortCompanionItems<T extends CompanionItem>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        rank[a.item.kind] - rank[b.item.kind] ||
        (a.item.startsAt ?? '').localeCompare(b.item.startsAt ?? '') ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}
