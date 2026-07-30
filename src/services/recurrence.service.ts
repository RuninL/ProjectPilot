import { addDays, inclusiveDays, mondayWeekdayOf, startOfWeekStr } from '@/lib/date';
import type { BatchStatement } from '@/lib/commands';
import { executeBatch } from '@/lib/commands';
import { nowIso } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/uuid';
import type {
  MeetingRepository,
  ProjectRepository,
  RecurrenceRepository,
  TaskRepository,
} from '@/repositories';
import { getRepositories } from '@/repositories';
import type { Meeting, RecurrenceException, RecurrenceRule, Task } from '@/types';
import {
  recurrenceExceptionInputSchema,
  recurrenceRuleInputSchema,
  type RecurrenceExceptionInput,
  type RecurrenceRuleInput,
} from './schemas';

export const MAX_RECURRENCE_OCCURRENCES = 500;

export interface Occurrence {
  readonly date: string;
  readonly materialized_id: string | null;
}

export interface ExpansionResult {
  readonly occurrences: readonly Occurrence[];
  readonly truncated: boolean;
}

/**
 * Expands weekly rules in date-string space. A matching start-date weekday is
 * included; otherwise the first matching weekday after the start is used.
 */
export function expandRule(
  rule: RecurrenceRule,
  windowStart: string,
  windowEnd: string,
  projectEndDate: string | null,
  exceptions: readonly RecurrenceException[],
): ExpansionResult {
  if (!rule.is_active) return { occurrences: [], truncated: false };
  const effectiveEnd = rule.end_date ?? projectEndDate;
  if (effectiveEnd === null) throw new Error('项目未设置截止日期时，周期规则必须设置结束日期');
  const from = rule.start_date > windowStart ? rule.start_date : windowStart;
  const to = effectiveEnd < windowEnd ? effectiveEnd : windowEnd;
  if (from > to) return { occurrences: [], truncated: false };

  const exceptionsByDate = new Map(
    exceptions.map((exception) => [exception.occurrence_date, exception]),
  );
  const anchorWeek = startOfWeekStr(rule.start_date);
  const offset = (rule.byweekday - mondayWeekdayOf(rule.start_date) + 7) % 7;
  let candidate = addDays(rule.start_date, offset);
  const occurrences: Occurrence[] = [];

  while (candidate <= to) {
    const weeksFromAnchor = (inclusiveDays(anchorWeek, startOfWeekStr(candidate)) - 1) / 7;
    if (candidate >= from && weeksFromAnchor % rule.interval === 0) {
      const exception = exceptionsByDate.get(candidate);
      if (exception?.action !== 'skip') {
        occurrences.push({
          date: candidate,
          materialized_id: exception?.action === 'materialized' ? exception.materialized_id : null,
        });
        if (occurrences.length === MAX_RECURRENCE_OCCURRENCES) {
          return { occurrences, truncated: addDays(candidate, rule.interval * 7) <= to };
        }
      }
    }
    candidate = addDays(candidate, 7);
  }
  return { occurrences, truncated: false };
}

export interface RecurrenceServiceDeps {
  recurrence: RecurrenceRepository;
  projects: ProjectRepository;
  tasks: TaskRepository;
  meetings: MeetingRepository;
  runBatch: (statements: BatchStatement[]) => Promise<number>;
}

export function createRecurrenceService(deps: RecurrenceServiceDeps) {
  function parseRuleInput(input: RecurrenceRuleInput): RecurrenceRuleInput {
    const parsed = recurrenceRuleInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('validation', parsed.error.issues[0]?.message ?? '周期规则数据无效');
    }
    return parsed.data;
  }

  function parseExceptionInput(input: RecurrenceExceptionInput): RecurrenceExceptionInput {
    const parsed = recurrenceExceptionInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('validation', parsed.error.issues[0]?.message ?? '周期例外数据无效');
    }
    return parsed.data;
  }

  async function requireRule(id: string): Promise<RecurrenceRule> {
    const rule = await deps.recurrence.findById(id);
    if (rule === null) throw new AppError('not_found', '周期规则不存在或已被删除');
    return rule;
  }

  async function requireProject(projectId: string): Promise<void> {
    if ((await deps.projects.findById(projectId)) === null) {
      throw new AppError('validation', '所属项目不存在或已被删除');
    }
  }

  function buildRule(input: RecurrenceRuleInput, id = newId(), now = nowIso()): RecurrenceRule {
    return {
      id,
      project_id: input.project_id,
      kind: input.kind,
      title: input.title,
      byweekday: input.byweekday,
      interval: input.interval,
      start_date: input.start_date,
      end_date: input.end_date,
      time_of_day: input.time_of_day,
      duration_minutes: input.duration_minutes,
      default_priority: input.default_priority,
      note: input.note,
      is_active: input.is_active,
      is_sample: 0,
      created_at: now,
      updated_at: now,
    };
  }

  async function requireUnmaterialized(ruleId: string, occurrenceDate: string): Promise<void> {
    const existing = (await deps.recurrence.findExceptions(ruleId)).find(
      (item) => item.occurrence_date === occurrenceDate,
    );
    if (existing !== undefined) {
      throw new AppError('conflict', '该周期已处理，不能重复物化');
    }
  }

  function buildMaterializedTask(rule: RecurrenceRule, occurrenceDate: string, now: string): Task {
    if (rule.project_id === null) {
      throw new AppError('validation', '独立会议规则不能物化为任务');
    }
    return {
      id: newId(),
      project_id: rule.project_id,
      parent_task_id: null,
      title: rule.title,
      description: rule.note,
      status: 'todo',
      priority: rule.default_priority ?? 'medium',
      start_date: occurrenceDate,
      due_date: occurrenceDate,
      progress: 0,
      estimated_hours: null,
      actual_hours: null,
      completed_at: null,
      archived_at: null,
      source_meeting_id: null,
      source_rule_id: rule.id,
      source_occurrence_date: occurrenceDate,
      is_sample: 0,
      created_at: now,
      updated_at: now,
    };
  }

  function buildMaterializedMeeting(
    rule: RecurrenceRule,
    occurrenceDate: string,
    now: string,
  ): Meeting {
    return {
      id: newId(),
      project_id: rule.project_id,
      topic: rule.title,
      date: occurrenceDate,
      start_time: rule.time_of_day,
      attendees: '[]',
      agenda: rule.note,
      notes: '',
      decisions: '',
      risks: '',
      source_rule_id: rule.id,
      source_occurrence_date: occurrenceDate,
      is_sample: 0,
      created_at: now,
      updated_at: now,
    };
  }

  return {
    async createRule(input: RecurrenceRuleInput): Promise<RecurrenceRule> {
      const parsed = parseRuleInput(input);
      if (parsed.project_id !== null) await requireProject(parsed.project_id);
      const rule = buildRule(parsed);
      await deps.recurrence.insert(rule);
      return rule;
    },

    async getRule(id: string): Promise<RecurrenceRule> {
      return requireRule(id);
    },

    async listExceptions(ruleId: string): Promise<RecurrenceException[]> {
      await requireRule(ruleId);
      return deps.recurrence.findExceptions(ruleId);
    },

    async listRules(projectId?: string): Promise<RecurrenceRule[]> {
      return projectId === undefined
        ? deps.recurrence.findAll()
        : deps.recurrence.findByProject(projectId);
    },

    async updateRule(id: string, input: RecurrenceRuleInput): Promise<RecurrenceRule> {
      await requireRule(id);
      const parsed = parseRuleInput(input);
      if (parsed.project_id !== null) await requireProject(parsed.project_id);
      await deps.recurrence.update(id, buildRule(parsed, id), nowIso());
      return requireRule(id);
    },

    /**
     * Materialized tasks and meetings are independent historical records, so a
     * rule deletion only cascades its exceptions and leaves those records intact.
     */
    async deleteRule(id: string): Promise<void> {
      await requireRule(id);
      await deps.recurrence.deleteById(id);
    },

    async createException(
      ruleId: string,
      input: RecurrenceExceptionInput,
    ): Promise<RecurrenceException> {
      await requireRule(ruleId);
      const parsed = parseExceptionInput(input);
      await requireUnmaterialized(ruleId, parsed.occurrence_date);
      const now = nowIso();
      const exception: RecurrenceException = {
        id: newId(),
        rule_id: ruleId,
        occurrence_date: parsed.occurrence_date,
        action: parsed.action,
        materialized_id: null,
        created_at: now,
        updated_at: now,
      };
      await deps.recurrence.insertException(exception);
      return exception;
    },

    async deleteException(ruleId: string, occurrenceDate: string): Promise<void> {
      if ((await deps.recurrence.deleteException(ruleId, occurrenceDate)) === 0) {
        throw new AppError('not_found', '周期例外不存在或已被删除');
      }
    },

    async materialize(ruleId: string, occurrenceDate: string): Promise<Task | Meeting> {
      const rule = await requireRule(ruleId);
      await requireUnmaterialized(ruleId, occurrenceDate);
      const now = nowIso();
      if (rule.kind === 'task') {
        const entity = buildMaterializedTask(rule, occurrenceDate, now);
        const exception: RecurrenceException = {
          id: newId(),
          rule_id: rule.id,
          occurrence_date: occurrenceDate,
          action: 'materialized',
          materialized_id: entity.id,
          created_at: now,
          updated_at: now,
        };
        try {
          await deps.runBatch([
            deps.tasks.buildInsert(entity),
            deps.recurrence.buildInsertException(exception),
          ]);
        } catch (cause) {
          throw new AppError('db', '物化周期记录失败，未写入任何数据', { cause });
        }
        return entity;
      }
      const entity = buildMaterializedMeeting(rule, occurrenceDate, now);
      const exception: RecurrenceException = {
        id: newId(),
        rule_id: rule.id,
        occurrence_date: occurrenceDate,
        action: 'materialized',
        materialized_id: entity.id,
        created_at: now,
        updated_at: now,
      };
      try {
        await deps.runBatch([
          deps.meetings.buildInsert(entity),
          deps.recurrence.buildInsertException(exception),
        ]);
      } catch (cause) {
        throw new AppError('db', '物化周期记录失败，未写入任何数据', { cause });
      }
      return entity;
    },

    /** Materialize several occurrences as one batch: either all meetings exist or none do. */
    async materializeMany(
      ruleId: string,
      occurrenceDates: readonly string[],
    ): Promise<(Task | Meeting)[]> {
      if (occurrenceDates.length === 0) {
        throw new AppError('validation', '请至少选择一次周期会议');
      }
      const uniqueDates = [...new Set(occurrenceDates)];
      if (uniqueDates.length !== occurrenceDates.length) {
        throw new AppError('validation', '批量物化日期不能重复');
      }
      const rule = await requireRule(ruleId);
      await Promise.all(uniqueDates.map((date) => requireUnmaterialized(ruleId, date)));
      const now = nowIso();
      const entities = uniqueDates.map((date) =>
        rule.kind === 'task'
          ? buildMaterializedTask(rule, date, now)
          : buildMaterializedMeeting(rule, date, now),
      );
      const exceptions = entities.map((entity, index): RecurrenceException => ({
        id: newId(),
        rule_id: rule.id,
        occurrence_date: uniqueDates[index] ?? '',
        action: 'materialized',
        materialized_id: entity.id,
        created_at: now,
        updated_at: now,
      }));
      try {
        await deps.runBatch([
          ...entities.map((entity) =>
            rule.kind === 'task'
              ? deps.tasks.buildInsert(entity as Task)
              : deps.meetings.buildInsert(entity as Meeting),
          ),
          ...exceptions.map((exception) => deps.recurrence.buildInsertException(exception)),
        ]);
      } catch (cause) {
        throw new AppError('db', '批量物化周期记录失败，未写入任何数据', { cause });
      }
      return entities;
    },

    /**
     * Cancelling a materialization deletes both the generated record and its
     * exception in one transaction. Removing the exception makes that date an
     * expected occurrence again rather than silently turning a cancellation into
     * a permanent skip.
     */
    async cancelMaterialization(ruleId: string, occurrenceDate: string): Promise<void> {
      const exception = (await deps.recurrence.findExceptions(ruleId)).find(
        (item) => item.occurrence_date === occurrenceDate && item.action === 'materialized',
      );
      if (exception?.materialized_id === null || exception === undefined) {
        throw new AppError('not_found', '该周期尚未物化');
      }
      const rule = await requireRule(ruleId);
      await deps.runBatch([
        rule.kind === 'task'
          ? deps.tasks.buildDelete(exception.materialized_id)
          : deps.meetings.buildDelete(exception.materialized_id),
        {
          sql: 'DELETE FROM recurrence_exceptions WHERE rule_id = ? AND occurrence_date = ?',
          params: [ruleId, occurrenceDate],
        },
      ]);
    },
  };
}

export type RecurrenceService = ReturnType<typeof createRecurrenceService>;

export async function getRecurrenceService(): Promise<RecurrenceService> {
  const repos = await getRepositories();
  return createRecurrenceService({
    recurrence: repos.recurrence,
    projects: repos.projects,
    tasks: repos.tasks,
    meetings: repos.meetings,
    runBatch: executeBatch,
  });
}
