import { recurrenceExceptionRowSchema, recurrenceRuleRowSchema } from '@/db/schemas';
import type { RecurrenceException, RecurrenceRule } from '@/types';
import type { SqlExecutor } from '@/lib/db';
import type { BatchStatement } from '@/lib/commands';
import { buildUpdate, parseOptional, parseRows, runUpdate } from './_shared';

const RULE_UPDATABLE = [
  'project_id',
  'kind',
  'title',
  'byweekday',
  'interval',
  'start_date',
  'end_date',
  'time_of_day',
  'duration_minutes',
  'default_priority',
  'note',
  'is_active',
] as const;

export function createRecurrenceRepository(db: SqlExecutor) {
  return {
    async findById(id: string): Promise<RecurrenceRule | null> {
      return parseOptional(
        recurrenceRuleRowSchema,
        await db.select('SELECT * FROM recurrence_rules WHERE id = ?', [id]),
      );
    },
    async findByProject(projectId: string): Promise<RecurrenceRule[]> {
      return parseRows(
        recurrenceRuleRowSchema,
        await db.select(
          'SELECT * FROM recurrence_rules WHERE project_id = ? ORDER BY created_at ASC',
          [projectId],
        ),
      );
    },
    async findAll(): Promise<RecurrenceRule[]> {
      return parseRows(
        recurrenceRuleRowSchema,
        await db.select('SELECT * FROM recurrence_rules ORDER BY created_at ASC'),
      );
    },
    async findActiveByProjectIds(projectIds: readonly string[]): Promise<RecurrenceRule[]> {
      return parseRows(
        recurrenceRuleRowSchema,
        await db.select(
          projectIds.length === 0
            ? 'SELECT * FROM recurrence_rules WHERE is_active = 1 AND project_id IS NULL'
            : `SELECT * FROM recurrence_rules WHERE is_active = 1 AND (project_id IS NULL OR project_id IN (${projectIds.map(() => '?').join(', ')}))`,
          [...projectIds],
        ),
      );
    },
    async insert(rule: RecurrenceRule): Promise<void> {
      await db.execute(
        `INSERT INTO recurrence_rules (id, project_id, kind, title, byweekday, interval, start_date, end_date, time_of_day, duration_minutes, default_priority, note, is_active, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rule.id,
          rule.project_id,
          rule.kind,
          rule.title,
          rule.byweekday,
          rule.interval,
          rule.start_date,
          rule.end_date,
          rule.time_of_day,
          rule.duration_minutes,
          rule.default_priority,
          rule.note,
          rule.is_active,
          rule.is_sample,
          rule.created_at,
          rule.updated_at,
        ],
      );
    },
    async update(id: string, patch: Partial<RecurrenceRule>, now: string): Promise<number> {
      return runUpdate(db, buildUpdate('recurrence_rules', RULE_UPDATABLE, patch, id, now));
    },
    async deleteById(id: string): Promise<number> {
      return (await db.execute('DELETE FROM recurrence_rules WHERE id = ?', [id])).rowsAffected;
    },
    async findExceptions(ruleId: string): Promise<RecurrenceException[]> {
      return parseRows(
        recurrenceExceptionRowSchema,
        await db.select(
          'SELECT * FROM recurrence_exceptions WHERE rule_id = ? ORDER BY occurrence_date ASC',
          [ruleId],
        ),
      );
    },
    async insertException(exception: RecurrenceException): Promise<void> {
      const statement = this.buildInsertException(exception);
      await db.execute(statement.sql, statement.params);
    },
    buildInsertException(exception: RecurrenceException): BatchStatement {
      return {
        sql: 'INSERT INTO recurrence_exceptions (id, rule_id, occurrence_date, action, replacement_date, materialized_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        params: [
          exception.id,
          exception.rule_id,
          exception.occurrence_date,
          exception.action,
          exception.replacement_date,
          exception.materialized_id,
          exception.created_at,
          exception.updated_at,
        ],
      };
    },
    async deleteException(ruleId: string, occurrenceDate: string): Promise<number> {
      return (
        await db.execute(
          'DELETE FROM recurrence_exceptions WHERE rule_id = ? AND occurrence_date = ?',
          [ruleId, occurrenceDate],
        )
      ).rowsAffected;
    },
  };
}

export type RecurrenceRepository = ReturnType<typeof createRecurrenceRepository>;
