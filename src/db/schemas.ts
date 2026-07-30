import { z } from 'zod';
import { isValidDateStr } from '@/lib/date';

/**
 * Zod row schemas — the single boundary where untyped `select` results are
 * narrowed into strong types. Every field mirrors the SQLite column exactly
 * (snake_case). Repositories call `.parse()` on raw rows; nothing untyped
 * escapes this layer, satisfying strict mode + the no-explicit-any rule.
 */

/** A stored calendar date 'YYYY-MM-DD' (real date, not just well-formed). */
export const dateString = z.string().refine(isValidDateStr, {
  message: '日期必须为有效的 YYYY-MM-DD',
});

/** SQLite boolean flag (0 or 1). */
export const sqliteBool = z.union([z.literal(0), z.literal(1)]);

/** UTC ISO-8601 audit timestamp. */
const timestamp = z.string().min(1);

const auditColumns = {
  created_at: timestamp,
  updated_at: timestamp,
};

export const projectStatusEnum = z.enum([
  'active',
  'on_hold',
  'postponed',
  'completed',
  'archived',
]);
export const taskStatusEnum = z.enum([
  'todo',
  'in_progress',
  'blocked',
  'postponed',
  'done',
  'cancelled',
]);
export const taskPriorityEnum = z.enum(['low', 'medium', 'high', 'urgent']);
export const milestoneStatusEnum = z.enum(['upcoming', 'achieved', 'missed', 'cancelled']);
export const actionItemStatusEnum = z.enum(['open', 'in_progress', 'done', 'cancelled']);
export const linkTypeEnum = z.enum(['url', 'file_path']);
export const depTypeEnum = z.enum(['FS']);
export const riskCategoryEnum = z.enum([
  'scope',
  'schedule',
  'resource',
  'technical',
  'external',
  'other',
]);
export const riskLikelihoodEnum = z.enum(['low', 'medium', 'high']);
export const riskImpactEnum = z.enum(['low', 'medium', 'high']);
export const riskLevelEnum = z.enum(['low', 'medium', 'high', 'critical']);
export const riskStatusEnum = z.enum(['open', 'monitoring', 'mitigated', 'closed']);
export const recurrenceKindEnum = z.enum(['task', 'meeting']);
export const recurrenceActionEnum = z.enum(['skip', 'materialized']);

export const projectRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: projectStatusEnum,
  color: z.string(),
  start_date: dateString.nullable(),
  target_end_date: dateString.nullable(),
  archived_at: z.string().nullable(),
  is_sample: sqliteBool,
  ...auditColumns,
});

export const taskRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  parent_task_id: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  status: taskStatusEnum,
  priority: taskPriorityEnum,
  start_date: dateString.nullable(),
  due_date: dateString.nullable(),
  progress: z.number().int().min(0).max(100),
  estimated_hours: z.number().min(0).nullable(),
  actual_hours: z.number().min(0).nullable(),
  // Added by migration 0002. Audit timestamps, not business dates.
  completed_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  source_meeting_id: z.string().nullable(),
  source_rule_id: z.string().nullable().default(null),
  source_occurrence_date: dateString.nullable().default(null),
  is_sample: sqliteBool,
  ...auditColumns,
});

/** A task joined with its project's display fields, for the cross-project task view. */
export const taskWithProjectRowSchema = taskRowSchema.extend({
  project_name: z.string(),
  project_color: z.string(),
  project_status: projectStatusEnum,
});

export const taskDependencyRowSchema = z.object({
  id: z.string(),
  predecessor_id: z.string(),
  successor_id: z.string(),
  dep_type: depTypeEnum,
  lag_days: z.number().int(),
  ...auditColumns,
});

export const milestoneRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  linked_task_id: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  date: dateString,
  status: milestoneStatusEnum,
  achieved_at: z.string().nullable(),
  is_sample: sqliteBool,
  ...auditColumns,
});

/** Wall-clock 'HH:MM' with a real hour and minute. Deliberately timezone-free. */
export const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  message: '时间必须为有效的 HH:MM',
});

export const meetingRowSchema = z.object({
  id: z.string(),
  project_id: z.string().nullable(),
  topic: z.string(),
  date: dateString,
  // Added by migration 0004. A label on the calendar day, not an instant.
  start_time: timeString.nullable(),
  attendees: z.string(),
  agenda: z.string(),
  notes: z.string(),
  decisions: z.string(),
  risks: z.string(),
  source_rule_id: z.string().nullable().default(null),
  source_occurrence_date: dateString.nullable().default(null),
  is_sample: sqliteBool,
  ...auditColumns,
});

export const recurrenceRuleRowSchema = z.object({
  id: z.string(),
  project_id: z.string().nullable(),
  kind: recurrenceKindEnum,
  title: z.string(),
  byweekday: z.number().int().min(0).max(6),
  interval: z.number().int().positive(),
  start_date: dateString,
  end_date: dateString.nullable(),
  time_of_day: timeString.nullable(),
  duration_minutes: z.number().int().positive().nullable(),
  default_priority: taskPriorityEnum.nullable(),
  note: z.string(),
  is_active: sqliteBool,
  is_sample: sqliteBool,
  ...auditColumns,
});

export const recurrenceExceptionRowSchema = z.object({
  id: z.string(),
  rule_id: z.string(),
  occurrence_date: dateString,
  action: recurrenceActionEnum,
  materialized_id: z.string().nullable(),
  ...auditColumns,
});

export const actionItemRowSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  content: z.string(),
  owner: z.string(),
  due_date: dateString.nullable(),
  status: actionItemStatusEnum,
  converted_task_id: z.string().nullable(),
  converted_at: z.string().nullable(),
  ...auditColumns,
});

export const projectLinkRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  label: z.string(),
  link_type: linkTypeEnum,
  target: z.string(),
  description: z.string().default(''),
  is_sample: sqliteBool,
  ...auditColumns,
});

export const projectLinkWithProjectRowSchema = projectLinkRowSchema.extend({
  project_name: z.string(),
  project_color: z.string(),
});

export const appSettingRowSchema = z.object({
  key: z.string(),
  value: z.string(),
  ...auditColumns,
});

export const riskRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  description: z.string(),
  category: riskCategoryEnum,
  likelihood: riskLikelihoodEnum,
  impact: riskImpactEnum,
  level: riskLevelEnum,
  status: riskStatusEnum,
  owner: z.string(),
  mitigation_plan: z.string(),
  due_date: dateString.nullable(),
  resolved_at: z.string().nullable(),
  is_sample: sqliteBool,
  ...auditColumns,
});

export const riskWithProjectRowSchema = riskRowSchema.extend({
  project_name: z.string(),
  project_color: z.string(),
});

export const personRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  role: z.string().nullable(),
  note: z.string().nullable(),
  ...auditColumns,
});

export const personWithCountsRowSchema = personRowSchema.extend({
  project_count: z.number().int().nonnegative(),
  task_count: z.number().int().nonnegative(),
});

export const projectParticipantRowSchema = z.object({
  project_id: z.string(),
  person_id: z.string(),
  role: z.string(),
  joined_at: timestamp,
});

export const taskParticipantRowSchema = z.object({
  task_id: z.string(),
  person_id: z.string(),
  assigned_at: timestamp,
});

export const projectParticipantPersonRowSchema = projectParticipantRowSchema.extend({
  person_name: z.string(),
});

export const taskParticipantPersonRowSchema = taskParticipantRowSchema.extend({
  person_name: z.string(),
});

export const personProjectParticipationRowSchema = projectParticipantRowSchema.extend({
  project_name: z.string(),
  project_status: projectStatusEnum,
});

export const personTaskParticipationRowSchema = taskParticipantRowSchema.extend({
  task_title: z.string(),
  task_status: taskStatusEnum,
  task_priority: taskPriorityEnum,
  task_due_date: dateString.nullable(),
  project_id: z.string().nullable(),
  project_name: z.string().nullable(),
  project_status: projectStatusEnum.nullable(),
});
