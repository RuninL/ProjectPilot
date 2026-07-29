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
  riskCategoryEnum,
  riskImpactEnum,
  riskLevelEnum,
  riskLikelihoodEnum,
  riskRowSchema,
  riskStatusEnum,
  riskWithProjectRowSchema,
  taskDependencyRowSchema,
  taskPriorityEnum,
  taskRowSchema,
  taskStatusEnum,
  taskWithProjectRowSchema,
} from '@/db/schemas';

/** Domain row types, inferred from the Zod row schemas (single source of truth). */
export type Project = z.infer<typeof projectRowSchema>;
export type Task = z.infer<typeof taskRowSchema>;
export type TaskWithProject = z.infer<typeof taskWithProjectRowSchema>;
export type TaskDependency = z.infer<typeof taskDependencyRowSchema>;
export type Milestone = z.infer<typeof milestoneRowSchema>;
export type Meeting = z.infer<typeof meetingRowSchema>;
export type ActionItem = z.infer<typeof actionItemRowSchema>;
export type ProjectLink = z.infer<typeof projectLinkRowSchema>;
export type AppSetting = z.infer<typeof appSettingRowSchema>;
export type Risk = z.infer<typeof riskRowSchema>;
export type RiskWithProject = z.infer<typeof riskWithProjectRowSchema>;

export type ProjectStatus = z.infer<typeof projectStatusEnum>;
export type TaskStatus = z.infer<typeof taskStatusEnum>;
export type TaskPriority = z.infer<typeof taskPriorityEnum>;
export type MilestoneStatus = z.infer<typeof milestoneStatusEnum>;
export type ActionItemStatus = z.infer<typeof actionItemStatusEnum>;
export type LinkType = z.infer<typeof linkTypeEnum>;
export type DepType = z.infer<typeof depTypeEnum>;
export type RiskCategory = z.infer<typeof riskCategoryEnum>;
export type RiskLikelihood = z.infer<typeof riskLikelihoodEnum>;
export type RiskImpact = z.infer<typeof riskImpactEnum>;
export type RiskLevel = z.infer<typeof riskLevelEnum>;
export type RiskStatus = z.infer<typeof riskStatusEnum>;
