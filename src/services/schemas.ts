import { z } from 'zod';
import { isValidDateStr } from '@/lib/date';
import {
  actionItemStatusEnum,
  milestoneStatusEnum,
  projectStatusEnum,
  riskCategoryEnum,
  riskImpactEnum,
  riskLikelihoodEnum,
  riskStatusEnum,
  taskPriorityEnum,
  taskStatusEnum,
} from '@/db/schemas';

/**
 * Input schemas for user-supplied data — deliberately separate from the row
 * schemas in `@/db/schemas`, which describe what SQLite already holds.
 *
 * The same schema backs the React Hook Form resolver and the service-level
 * re-validation, so a caller bypassing the form cannot write an invalid row.
 * All messages are user-facing and therefore Simplified Chinese.
 *
 * Because the form parses and the service then parses that result, **every field
 * must accept its own output** — see `tests/services/inputSchemaIdempotence`.
 * The optional helpers below get this from `.nullable()` plus a `?? null` pass;
 * a field whose transform changes the type (`attendees`) folds the output back
 * to its input form first.
 */

/** Empty string from an untouched `<input type="date">` means "not set". */
const optionalDate = z
  .string()
  .trim()
  .refine((value) => value === '' || isValidDateStr(value), {
    message: '日期必须为有效的 YYYY-MM-DD',
  })
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .transform((value) => value ?? null);

/** Required business date — an empty `<input type="date">` is a validation error. */
const requiredDate = z
  .string()
  .trim()
  .min(1, '日期不能为空')
  .refine(isValidDateStr, { message: '日期必须为有效的 YYYY-MM-DD' });

/** Optional wall-clock time; empty means "not set". */
const optionalTime = z
  .string()
  .trim()
  .refine((value) => value === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(value), {
    message: '时间必须为有效的 HH:MM（24 小时制）',
  })
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .transform((value) => value ?? null);

/** Optional foreign key from a `<select>`; the empty option means "not set". */
const optionalId = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .transform((value) => value ?? null);

const optionalHours = z
  .union([
    z.literal(''),
    z.coerce.number().min(0, '工时不能为负数').max(10000, '工时不能超过 10000'),
  ])
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .transform((value) => value ?? null);

export const projectInputSchema = z
  .object({
    name: z.string().trim().min(1, '项目名称不能为空').max(120, '项目名称不能超过 120 个字符'),
    description: z.string().trim().max(2000, '项目描述不能超过 2000 个字符').default(''),
    status: projectStatusEnum.default('active'),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9A-Fa-f]{6}$/, '颜色必须是 #RRGGBB 格式'),
    start_date: optionalDate,
    target_end_date: optionalDate,
  })
  .refine(
    (value) =>
      value.start_date === null ||
      value.target_end_date === null ||
      value.start_date <= value.target_end_date,
    { message: '目标结束日期不能早于开始日期', path: ['target_end_date'] },
  );

export const taskInputSchema = z
  .object({
    project_id: z.string().min(1, '必须选择所属项目'),
    parent_task_id: z
      .string()
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .transform((value) => value ?? null),
    title: z.string().trim().min(1, '任务标题不能为空').max(160, '任务标题不能超过 160 个字符'),
    description: z.string().trim().max(2000, '任务描述不能超过 2000 个字符').default(''),
    status: taskStatusEnum.default('todo'),
    priority: taskPriorityEnum.default('medium'),
    start_date: optionalDate,
    due_date: optionalDate,
    progress: z.coerce
      .number({ invalid_type_error: '进度必须是数字' })
      .int('进度必须是整数')
      .min(0, '进度不能小于 0')
      .max(100, '进度不能大于 100'),
    estimated_hours: optionalHours,
    actual_hours: optionalHours,
  })
  .refine(
    (value) =>
      value.start_date === null || value.due_date === null || value.start_date <= value.due_date,
    { message: '截止日期不能早于开始日期', path: ['due_date'] },
  );

/** Fields a bulk edit may change; every one is optional and only applied when present. */
export const bulkTaskUpdateSchema = z
  .object({
    status: taskStatusEnum.optional(),
    priority: taskPriorityEnum.optional(),
    due_date: optionalDate.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: '请至少选择一项要修改的内容',
  });

/**
 * A finish-to-start edge to create. Direction is fixed: the successor waits for
 * the predecessor. Everything beyond shape — same project, not archived, no
 * cycle — needs the graph and so is checked in the service.
 */
export const dependencyInputSchema = z.object({
  predecessor_id: z.string().min(1, '请选择前驱任务'),
  successor_id: z.string().min(1, '请选择后继任务'),
});

/**
 * Fold an already-normalized attendee list back into the one-name-per-line text
 * the field is written for, so the schema accepts its own output. The form parses
 * before calling the store and the service parses again; without this, the second
 * parse of a saved meeting failed with `attendees: expected string, received array`
 * and no meeting could ever be written.
 */
function foldAttendeeList(value: unknown): unknown {
  return Array.isArray(value) ? (value as unknown[]).map((name) => String(name)).join('\n') : value;
}

/**
 * A meeting. `project_id` is nullable on purpose: a meeting may stand on its own
 * (a 1:1, a cross-project review) and must not be forced under a project.
 * Attendees arrive as free text — one name per line or comma-separated — and are
 * normalized to a list here so the service only ever serializes a clean array.
 */
export const meetingInputSchema = z.object({
  project_id: optionalId,
  topic: z.string().trim().min(1, '会议主题不能为空').max(160, '会议主题不能超过 160 个字符'),
  date: requiredDate,
  start_time: optionalTime,
  attendees: z.preprocess(
    foldAttendeeList,
    z
      .string()
      .max(2000, '参与者不能超过 2000 个字符')
      .default('')
      .transform((value) =>
        value
          .split(/[,，\n]/)
          .map((name) => name.trim())
          .filter((name) => name !== ''),
      ),
  ),
  agenda: z.string().trim().max(4000, '议程不能超过 4000 个字符').default(''),
  notes: z.string().trim().max(8000, '会议纪要不能超过 8000 个字符').default(''),
  decisions: z.string().trim().max(4000, '决议不能超过 4000 个字符').default(''),
  risks: z.string().trim().max(4000, '风险不能超过 4000 个字符').default(''),
});

export const actionItemInputSchema = z.object({
  content: z.string().trim().min(1, '行动项内容不能为空').max(300, '行动项内容不能超过 300 个字符'),
  owner: z.string().trim().max(120, '负责人不能超过 120 个字符').default(''),
  due_date: optionalDate,
  status: actionItemStatusEnum.default('open'),
});

/**
 * Target project for a conversion. Empty is legal in the schema and rejected by
 * the service only when the meeting has no project of its own — that is where
 * the meeting is known, and silently creating an unowned task is not an option.
 */
export const convertActionItemSchema = z.object({
  project_id: optionalId,
});

export const milestoneInputSchema = z.object({
  project_id: z.string().min(1, '必须选择所属项目'),
  linked_task_id: optionalId,
  name: z.string().trim().min(1, '里程碑名称不能为空').max(120, '里程碑名称不能超过 120 个字符'),
  description: z.string().trim().max(2000, '里程碑描述不能超过 2000 个字符').default(''),
  date: requiredDate,
  status: milestoneStatusEnum.default('upcoming'),
});

export const riskInputSchema = z.object({
  project_id: z.string().min(1, '必须选择所属项目'),
  title: z.string().trim().min(1, '风险标题不能为空').max(160, '风险标题不能超过 160 个字符'),
  description: z.string().trim().max(4000, '风险描述不能超过 4000 个字符').default(''),
  category: riskCategoryEnum.default('other'),
  likelihood: riskLikelihoodEnum,
  impact: riskImpactEnum,
  status: riskStatusEnum.default('open'),
  owner: z.string().trim().max(120, '负责人不能超过 120 个字符').default(''),
  mitigation_plan: z.string().trim().max(4000, '缓解计划不能超过 4000 个字符').default(''),
  due_date: optionalDate,
});

export type ProjectInput = z.infer<typeof projectInputSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
export type BulkTaskUpdate = z.infer<typeof bulkTaskUpdateSchema>;
export type DependencyInput = z.infer<typeof dependencyInputSchema>;
export type MeetingInput = z.infer<typeof meetingInputSchema>;
export type ActionItemInput = z.infer<typeof actionItemInputSchema>;
export type ConvertActionItemInput = z.infer<typeof convertActionItemSchema>;
export type MilestoneInput = z.infer<typeof milestoneInputSchema>;
export type RiskInput = z.infer<typeof riskInputSchema>;
