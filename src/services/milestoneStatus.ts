import { daysUntil, todayHK } from '@/lib/date';
import type { Milestone, Task } from '@/types';

/**
 * Derived, read-only view of where a milestone sits relative to today
 * (Asia/Hong_Kong). Nothing here writes: milestone status is only ever changed
 * by an explicit user action, so this module exists purely to render urgency and
 * to decide whether asking the user is warranted.
 */
export type MilestoneTimeState = 'today' | 'upcoming' | 'overdue' | 'closed';

export interface MilestoneView {
  readonly state: MilestoneTimeState;
  /** Calendar days from today to the milestone date; 0 on the day itself. */
  readonly daysRemaining: number;
  /** Calendar days the date is already past; 0 when today or in the future. */
  readonly daysOverdue: number;
  /** Simplified-Chinese urgency text, e.g. '今天到期' / '剩余 3 天' / '已逾期 2 天'. */
  readonly label: string;
  /** Overdue and still not achieved — flagged in the UI, never auto-changed. */
  readonly needsAttention: boolean;
}

/** `-0` renders as "-0"; every count exposed here must be a plain zero. */
function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

const CLOSED_LABELS: Partial<Record<Milestone['status'], string>> = {
  achieved: '已达成',
  cancelled: '已取消',
};

export function milestoneView(milestone: Milestone, today: string = todayHK()): MilestoneView {
  const closedLabel = CLOSED_LABELS[milestone.status];
  const diff = normalizeZero(daysUntil(milestone.date, today));
  const daysOverdue = normalizeZero(diff < 0 ? -diff : 0);

  if (closedLabel !== undefined) {
    return {
      state: 'closed',
      daysRemaining: diff,
      daysOverdue,
      label: closedLabel,
      needsAttention: false,
    };
  }

  if (diff === 0) {
    return {
      state: 'today',
      daysRemaining: 0,
      daysOverdue: 0,
      label: '今天到期',
      needsAttention: false,
    };
  }

  if (diff > 0) {
    return {
      state: 'upcoming',
      daysRemaining: diff,
      daysOverdue: 0,
      label: `剩余 ${String(diff)} 天`,
      needsAttention: false,
    };
  }

  return {
    state: 'overdue',
    daysRemaining: diff,
    daysOverdue,
    label: `已逾期 ${String(daysOverdue)} 天`,
    // 'missed' is already the user's own verdict, so it needs no further nudge.
    needsAttention: milestone.status === 'upcoming',
  };
}

/**
 * Whether to *ask* the user about marking the milestone achieved. The linked task
 * reaching `done` is never enough to change the status on its own — the product
 * rule is that a milestone's status is the user's statement, not an inference —
 * so the only allowed effect of a completed link is this prompt.
 */
export function shouldPromptAchieved(milestone: Milestone, linkedTask: Task | null): boolean {
  if (milestone.status !== 'upcoming' || milestone.linked_task_id === null) {
    return false;
  }
  if (linkedTask === null || linkedTask.id !== milestone.linked_task_id) {
    return false;
  }
  return linkedTask.status === 'done';
}

export function achievePromptMessage(milestone: Milestone, linkedTask: Task): string {
  return `关联任务「${linkedTask.title}」已完成，是否将里程碑「${milestone.name}」标记为已达成？`;
}
