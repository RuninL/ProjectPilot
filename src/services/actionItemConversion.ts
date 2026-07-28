import type { ActionItem } from '@/types';

/**
 * Three-state view of an action item's conversion, derived from the pair of
 * columns rather than stored: `converted_task_id` is nulled by the foreign key's
 * `ON DELETE SET NULL` when the task is deleted, while `converted_at` survives.
 * That asymmetry is what separates "never converted" from "task deleted", and it
 * is why `converted_at` — not `converted_task_id` — is the authoritative marker.
 */
export type ConversionState = 'unconverted' | 'converted' | 'task_deleted';

export function conversionState(item: ActionItem): ConversionState {
  if (item.converted_at === null) {
    return 'unconverted';
  }
  return item.converted_task_id === null ? 'task_deleted' : 'converted';
}

/**
 * Whether the "转为任务" affordance may be offered at all. A deleted task does
 * not re-open conversion: the item was converted, that fact is permanent, and
 * re-converting would silently produce a second task for one commitment.
 */
export function canConvert(item: ActionItem): boolean {
  return conversionState(item) === 'unconverted';
}

const CONVERSION_LABELS: Record<ConversionState, string> = {
  unconverted: '转为任务',
  converted: '查看任务',
  task_deleted: '任务已删除',
};

export function conversionLabel(item: ActionItem): string {
  return CONVERSION_LABELS[conversionState(item)];
}
