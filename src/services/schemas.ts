import { z } from 'zod';
import { isValidDateStr } from '@/lib/date';
import { projectStatusEnum, taskPriorityEnum, taskStatusEnum } from '@/db/schemas';

/**
 * Input schemas for user-supplied data — deliberately separate from the row
 * schemas in `@/db/schemas`, which describe what SQLite already holds.
 *
 * The same schema backs the React Hook Form resolver and the service-level
 * re-validation, so a caller bypassing the form cannot write an invalid row.
 * All messages are user-facing and therefore Simplified Chinese.
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

export type ProjectInput = z.infer<typeof projectInputSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
export type BulkTaskUpdate = z.infer<typeof bulkTaskUpdateSchema>;
