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
  namedListOrderContextEnum,
  namedListOrderRowSchema,
  personProjectParticipationRowSchema,
  personRowSchema,
  personTaskParticipationRowSchema,
  personWithCountsRowSchema,
  projectLinkRowSchema,
  projectLinkWithProjectRowSchema,
  projectParticipantRowSchema,
  projectParticipantPersonRowSchema,
  projectRowSchema,
  projectStatusEnum,
  recurrenceExceptionRowSchema,
  recurrenceActionEnum,
  recurrenceKindEnum,
  recurrenceRuleRowSchema,
  riskCategoryEnum,
  riskImpactEnum,
  riskLevelEnum,
  riskLikelihoodEnum,
  riskRowSchema,
  riskStatusEnum,
  riskWithProjectRowSchema,
  taskDependencyRowSchema,
  taskChecklistItemRowSchema,
  taskProgressUpdateRowSchema,
  taskParticipantRowSchema,
  taskParticipantPersonRowSchema,
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
export type RecurrenceRule = z.infer<typeof recurrenceRuleRowSchema>;
export type RecurrenceException = z.infer<typeof recurrenceExceptionRowSchema>;
export type ActionItem = z.infer<typeof actionItemRowSchema>;
export type ProjectLink = z.infer<typeof projectLinkRowSchema>;
export type ProjectLinkWithProject = z.infer<typeof projectLinkWithProjectRowSchema>;
export type AppSetting = z.infer<typeof appSettingRowSchema>;
export type NamedListOrder = z.infer<typeof namedListOrderRowSchema>;
export type TaskProgressUpdate = z.infer<typeof taskProgressUpdateRowSchema>;
export type TaskChecklistItem = z.infer<typeof taskChecklistItemRowSchema>;
export type Risk = z.infer<typeof riskRowSchema>;
export type RiskWithProject = z.infer<typeof riskWithProjectRowSchema>;
export type Person = z.infer<typeof personRowSchema>;
export type PersonWithCounts = z.infer<typeof personWithCountsRowSchema>;
export type ProjectParticipant = z.infer<typeof projectParticipantRowSchema>;
export type ProjectParticipantPerson = z.infer<typeof projectParticipantPersonRowSchema>;
export type TaskParticipant = z.infer<typeof taskParticipantRowSchema>;
export type TaskParticipantPerson = z.infer<typeof taskParticipantPersonRowSchema>;
export type PersonProjectParticipation = z.infer<typeof personProjectParticipationRowSchema>;
export type PersonTaskParticipation = z.infer<typeof personTaskParticipationRowSchema>;

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
export type RecurrenceKind = z.infer<typeof recurrenceKindEnum>;
export type RecurrenceAction = z.infer<typeof recurrenceActionEnum>;
export type NamedListOrderContext = z.infer<typeof namedListOrderContextEnum>;
