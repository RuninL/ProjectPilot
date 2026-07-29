import type { BadgeProps } from '@/components/ui/badge';
import type {
  ActionItemStatus,
  MilestoneStatus,
  ProjectStatus,
  RiskCategory,
  RiskLevel,
  RiskStatus,
  TaskPriority,
  TaskStatus,
} from '@/types';

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

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  upcoming: '待达成',
  achieved: '已达成',
  missed: '已错过',
  cancelled: '已取消',
};

export const ACTION_ITEM_STATUS_LABELS: Record<ActionItemStatus, string> = {
  open: '待处理',
  in_progress: '进行中',
  done: '已完成',
  cancelled: '已取消',
};

export const MILESTONE_STATUS_VARIANTS: Record<MilestoneStatus, BadgeVariant> = {
  upcoming: 'secondary',
  achieved: 'default',
  missed: 'destructive',
  cancelled: 'outline',
};

export const ACTION_ITEM_STATUS_VARIANTS: Record<ActionItemStatus, BadgeVariant> = {
  open: 'secondary',
  in_progress: 'default',
  done: 'outline',
  cancelled: 'outline',
};

export const MILESTONE_STATUS_OPTIONS = Object.entries(MILESTONE_STATUS_LABELS).map(
  ([value, label]) => ({ value: value as MilestoneStatus, label }),
);

export const ACTION_ITEM_STATUS_OPTIONS = Object.entries(ACTION_ITEM_STATUS_LABELS).map(
  ([value, label]) => ({ value: value as ActionItemStatus, label }),
);

export const RISK_CATEGORY_LABELS: Record<RiskCategory, string> = {
  scope: '范围',
  schedule: '进度',
  resource: '资源',
  technical: '技术',
  external: '外部',
  other: '其他',
};

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
};

export const RISK_STATUS_LABELS: Record<RiskStatus, string> = {
  open: '开放',
  monitoring: '监控中',
  mitigated: '已缓解',
  closed: '已关闭',
};

export const RISK_CATEGORY_OPTIONS = Object.entries(RISK_CATEGORY_LABELS).map(([value, label]) => ({
  value: value as RiskCategory,
  label,
}));

export const RISK_STATUS_OPTIONS = Object.entries(RISK_STATUS_LABELS).map(([value, label]) => ({
  value: value as RiskStatus,
  label,
}));

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
