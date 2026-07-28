import type { BadgeProps } from '@/components/ui/badge';
import type { ProjectStatus, TaskPriority, TaskStatus } from '@/types';

/** Display text for enum columns. Stored values stay English; only labels are Chinese. */

type BadgeVariant = NonNullable<BadgeProps['variant']>;

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: '进行中',
  on_hold: '已暂停',
  completed: '已完成',
  archived: '已归档',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '待办',
  in_progress: '进行中',
  blocked: '受阻',
  done: '已完成',
  cancelled: '已取消',
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
};

export const TASK_STATUS_VARIANTS: Record<TaskStatus, BadgeVariant> = {
  todo: 'secondary',
  in_progress: 'default',
  blocked: 'destructive',
  done: 'outline',
  cancelled: 'outline',
};

export const TASK_PRIORITY_VARIANTS: Record<TaskPriority, BadgeVariant> = {
  low: 'outline',
  medium: 'secondary',
  high: 'default',
  urgent: 'destructive',
};

export const PROJECT_STATUS_OPTIONS = Object.entries(PROJECT_STATUS_LABELS).map(
  ([value, label]) => ({ value: value as ProjectStatus, label }),
);

export const TASK_STATUS_OPTIONS = Object.entries(TASK_STATUS_LABELS).map(([value, label]) => ({
  value: value as TaskStatus,
  label,
}));

export const TASK_PRIORITY_OPTIONS = Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => ({
  value: value as TaskPriority,
  label,
}));
