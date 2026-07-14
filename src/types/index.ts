import type { z } from 'zod';
import type {
  actionItemRowSchema,
  actionItemStatusEnum,
  appSettingRowSchema,
  depTypeEnum,
  linkTypeEnum,
  meetingRowSchema,
  milestoneRowSchema,
  milestoneStatusEnum,
  projectLinkRowSchema,
  projectRowSchema,
  projectStatusEnum,
  taskDependencyRowSchema,
  taskPriorityEnum,
  taskRowSchema,
  taskStatusEnum,
} from '@/db/schemas';

/** Domain row types, inferred from the Zod row schemas (single source of truth). */
export type Project = z.infer<typeof projectRowSchema>;
export type Task = z.infer<typeof taskRowSchema>;
export type TaskDependency = z.infer<typeof taskDependencyRowSchema>;
export type Milestone = z.infer<typeof milestoneRowSchema>;
export type Meeting = z.infer<typeof meetingRowSchema>;
export type ActionItem = z.infer<typeof actionItemRowSchema>;
export type ProjectLink = z.infer<typeof projectLinkRowSchema>;
export type AppSetting = z.infer<typeof appSettingRowSchema>;

export type ProjectStatus = z.infer<typeof projectStatusEnum>;
export type TaskStatus = z.infer<typeof taskStatusEnum>;
export type TaskPriority = z.infer<typeof taskPriorityEnum>;
export type MilestoneStatus = z.infer<typeof milestoneStatusEnum>;
export type ActionItemStatus = z.infer<typeof actionItemStatusEnum>;
export type LinkType = z.infer<typeof linkTypeEnum>;
export type DepType = z.infer<typeof depTypeEnum>;
