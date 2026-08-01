import { addDays, inclusiveDays, mondayWeekdayOf, startOfWeekStr } from '@/lib/date';
import { nowIso } from '@/lib/date';
import { executeBatch, type BatchStatement } from '@/lib/commands';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/uuid';
import type {
  MeetingRepository,
  ProjectRepository,
  RecurrenceRepository,
  TaskMeetingRepository,
  TaskRepository,
} from '@/repositories';
import { getRepositories } from '@/repositories';
import type { Meeting, RecurrenceException, RecurrenceRule } from '@/types';
import { recurrenceRuleInputSchema, type RecurrenceRuleInput } from './schemas';

export const MAX_RECURRENCE_OCCURRENCES = 500;

export interface Occurrence {
  readonly date: string;
  /** Original series date used to target a one-off exception. */
  readonly occurrenceDate: string;
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
  const displayedDates = new Set<string>();

  while (candidate <= to) {
    const weeksFromAnchor = (inclusiveDays(anchorWeek, startOfWeekStr(candidate)) - 1) / 7;
    if (candidate >= from && weeksFromAnchor % rule.interval === 0) {
      const exception = exceptionsByDate.get(candidate);
      if (exception?.action !== 'skip' && exception?.action !== 'materialized') {
        const date = exception?.action === 'rescheduled' ? exception.replacement_date : candidate;
        if (
          date !== null &&
          date >= windowStart &&
          date <= windowEnd &&
          !displayedDates.has(date)
        ) {
          displayedDates.add(date);
          occurrences.push({ date, occurrenceDate: candidate });
        }
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
  meetings: MeetingRepository;
  tasks: TaskRepository;
  taskMeetings: TaskMeetingRepository;
  runBatch: (statements: BatchStatement[]) => Promise<number>;
}

export function createRecurrenceService(deps: RecurrenceServiceDeps) {
  function parseRuleInput(input: RecurrenceRuleInput) {
    const parsed = recurrenceRuleInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('validation', parsed.error.issues[0]?.message ?? '周期规则数据无效');
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

  function buildRule(
    input: ReturnType<typeof parseRuleInput>,
    id = newId(),
    now = nowIso(),
  ): RecurrenceRule {
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
      meeting_url: input.meeting_url,
      is_active: input.is_active,
      is_sample: 0,
      created_at: now,
      updated_at: now,
    };
  }

  function buildMeetingAnchor(rule: RecurrenceRule, id = newId()): Meeting {
    return {
      id,
      project_id: rule.project_id,
      topic: rule.title,
      date: rule.start_date,
      start_time: rule.time_of_day,
      attendees: '[]',
      agenda: rule.note,
      notes: '',
      decisions: '',
      risks: '',
      meeting_url: rule.meeting_url ?? null,
      source_rule_id: rule.id,
      source_occurrence_date: null,
      is_sample: rule.is_sample,
      created_at: rule.created_at,
      updated_at: rule.updated_at,
    };
  }

  async function validateTaskIds(taskIds: readonly string[]): Promise<string[]> {
    const uniqueTaskIds = [...new Set(taskIds)];
    if (uniqueTaskIds.length !== taskIds.length) {
      throw new AppError('validation', '关联任务不能重复');
    }
    if ((await deps.tasks.findByIds(uniqueTaskIds)).length !== uniqueTaskIds.length) {
      throw new AppError('validation', '关联任务不存在或已被删除');
    }
    return uniqueTaskIds;
  }

  async function requireUnchanged(ruleId: string, occurrenceDate: string): Promise<void> {
    const existing = (await deps.recurrence.findExceptions(ruleId)).find(
      (item) => item.occurrence_date === occurrenceDate,
    );
    if (existing !== undefined) {
      throw new AppError('conflict', '该次周期会议已调整，不能重复操作');
    }
  }

  return {
    async createRule(
      input: RecurrenceRuleInput,
      taskIds: readonly string[] = [],
    ): Promise<RecurrenceRule> {
      const parsed = parseRuleInput(input);
      if (parsed.project_id !== null) await requireProject(parsed.project_id);
      const rule = buildRule(parsed);
      const uniqueTaskIds = await validateTaskIds(taskIds);
      if (rule.kind !== 'meeting' && uniqueTaskIds.length > 0) {
        throw new AppError('validation', '只有周期会议可以关联任务');
      }
      const statements: BatchStatement[] = [deps.recurrence.buildInsert(rule)];
      if (rule.kind === 'meeting') {
        const anchor = buildMeetingAnchor(rule);
        statements.push(
          deps.meetings.buildInsert(anchor),
          ...uniqueTaskIds.map((taskId) =>
            deps.taskMeetings.buildInsert({
              task_id: taskId,
              meeting_id: anchor.id,
              linked_at: rule.created_at,
            }),
          ),
        );
      }
      await deps.runBatch(statements);
      return rule;
    },

    async getRule(id: string): Promise<RecurrenceRule> {
      return requireRule(id);
    },

    async listExceptions(ruleId: string): Promise<RecurrenceException[]> {
      await requireRule(ruleId);
      return deps.recurrence.findExceptions(ruleId);
    },

    async listExceptionsByRuleIds(
      ruleIds: readonly string[],
    ): Promise<Map<string, RecurrenceException[]>> {
      return deps.recurrence.findExceptionsByRuleIds([...new Set(ruleIds)]);
    },

    async listRules(projectId?: string): Promise<RecurrenceRule[]> {
      return projectId === undefined
        ? deps.recurrence.findAll()
        : deps.recurrence.findByProject(projectId);
    },

    async getMeetingSeriesAnchor(ruleId: string): Promise<Meeting> {
      const rule = await requireRule(ruleId);
      if (rule.kind !== 'meeting') {
        throw new AppError('validation', '该周期规则不是会议');
      }
      const anchor = await deps.meetings.findSeriesAnchor(ruleId);
      if (anchor === null) {
        throw new AppError('not_found', '周期会议关联实体不存在');
      }
      return anchor;
    },

    async updateRule(id: string, input: RecurrenceRuleInput): Promise<RecurrenceRule> {
      const previous = await requireRule(id);
      const parsed = parseRuleInput(input);
      if (parsed.project_id !== null) await requireProject(parsed.project_id);
      const now = nowIso();
      const nextRule = buildRule(parsed, id, now);
      const ruleUpdate = deps.recurrence.buildUpdateStatement(id, nextRule, now);
      if (ruleUpdate === null) throw new AppError('db', '周期规则没有可更新字段');
      const statements: BatchStatement[] = [
        ruleUpdate,
        deps.recurrence.buildDeleteExceptions(id),
      ];
      const anchor = await deps.meetings.findSeriesAnchor(id);
      if (nextRule.kind === 'meeting') {
        const nextAnchor = buildMeetingAnchor(
          { ...nextRule, created_at: previous.created_at },
          anchor?.id,
        );
        if (anchor === null) {
          statements.push(deps.meetings.buildInsert(nextAnchor));
        } else {
          const anchorUpdate = deps.meetings.buildUpdateStatement(anchor.id, nextAnchor, now);
          if (anchorUpdate !== null) statements.push(anchorUpdate);
        }
      } else if (anchor !== null) {
        statements.push(deps.meetings.buildDelete(anchor.id));
      }
      await deps.runBatch(statements);
      return requireRule(id);
    },

    async deleteRule(id: string): Promise<void> {
      await requireRule(id);
      await deps.recurrence.deleteById(id);
    },

    async skipOccurrence(ruleId: string, occurrenceDate: string): Promise<RecurrenceException> {
      await requireRule(ruleId);
      await requireUnchanged(ruleId, occurrenceDate);
      const now = nowIso();
      const exception: RecurrenceException = {
        id: newId(),
        rule_id: ruleId,
        occurrence_date: occurrenceDate,
        action: 'skip',
        replacement_date: null,
        materialized_id: null,
        created_at: now,
        updated_at: now,
      };
      await deps.recurrence.insertException(exception);
      return exception;
    },

    async rescheduleOccurrence(
      ruleId: string,
      occurrenceDate: string,
      replacementDate: string,
    ): Promise<RecurrenceException> {
      await requireRule(ruleId);
      await requireUnchanged(ruleId, occurrenceDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(replacementDate)) {
        throw new AppError('validation', '新日期必须为有效的 YYYY-MM-DD');
      }
      const now = nowIso();
      const exception: RecurrenceException = {
        id: newId(),
        rule_id: ruleId,
        occurrence_date: occurrenceDate,
        action: 'rescheduled',
        replacement_date: replacementDate,
        materialized_id: null,
        created_at: now,
        updated_at: now,
      };
      await deps.recurrence.insertException(exception);
      return exception;
    },
  };
}

export type RecurrenceService = ReturnType<typeof createRecurrenceService>;

export async function getRecurrenceService(): Promise<RecurrenceService> {
  const repos = await getRepositories();
  return createRecurrenceService({
    recurrence: repos.recurrence,
    projects: repos.projects,
    meetings: repos.meetings,
    tasks: repos.tasks,
    taskMeetings: repos.taskMeetings,
    runBatch: executeBatch,
  });
}
