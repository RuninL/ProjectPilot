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

export const projectStatusEnum = z.enum(['active', 'on_hold', 'completed', 'archived']);
export const taskStatusEnum = z.enum(['todo', 'in_progress', 'blocked', 'done', 'cancelled']);
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
  is_sample: sqliteBool,
  ...auditColumns,
});

/** A task joined with its project's display fields, for the cross-project task view. */
export const taskWithProjectRowSchema = taskRowSchema.extend({
  project_name: z.string(),
  project_color: z.string(),
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
  is_sample: sqliteBool,
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
  is_sample: sqliteBool,
  ...auditColumns,
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
});
