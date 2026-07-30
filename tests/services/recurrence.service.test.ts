import { afterEach, describe, expect, it } from 'vitest';
import {
  createRecurrenceService,
  expandRule,
  MAX_RECURRENCE_OCCURRENCES,
} from '@/services/recurrence.service';
import type { RecurrenceRuleInput } from '@/services/schemas';
import { createMeetingRepository } from '@/repositories/meeting.repo';
import { createProjectRepository } from '@/repositories/project.repo';
import { createRecurrenceRepository } from '@/repositories/recurrence.repo';
import { createTaskRepository } from '@/repositories/task.repo';
import type { RecurrenceRule } from '@/types';
import { makeProject } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

const rule = (overrides: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  id: 'r',
  project_id: 'p',
  kind: 'task',
  title: '每周事项',
  byweekday: 0,
  interval: 1,
  start_date: '2025-12-29',
  end_date: null,
  time_of_day: null,
  duration_minutes: null,
  default_priority: 'medium',
  note: '',
  is_active: 1,
  is_sample: 0,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
  ...overrides,
});

describe('expandRule', () => {
  it('includes a start date that falls on the selected weekday across a year boundary', () => {
    expect(
      expandRule(rule(), '2025-12-01', '2026-01-31', '2026-01-31', []).occurrences.map(
        (item) => item.date,
      ),
    ).toEqual(['2025-12-29', '2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
  });

  let db: TestDb | null = null;

  function requireDb(): TestDb {
    if (db === null) throw new Error('test database is unavailable');
    return db;
  }

  function createService() {
    db = createTestDb();
    return createRecurrenceService({
      recurrence: createRecurrenceRepository(db.executor),
      projects: createProjectRepository(db.executor),
      tasks: createTaskRepository(db.executor),
      meetings: createMeetingRepository(db.executor),
      runBatch: (statements) => Promise.resolve(requireDb().runBatch(statements)),
    });
  }

  async function seedProject(): Promise<void> {
    if (db === null) throw new Error('test database is unavailable');
    await createProjectRepository(db.executor).insert(makeProject({ id: 'p1' }));
  }

  const validInput = {
    project_id: 'p1',
    kind: 'task' as const,
    title: '每周检查',
    byweekday: 2,
    interval: 1,
    start_date: '2026-12-30',
    end_date: '2027-01-31',
    time_of_day: null,
    duration_minutes: null,
    default_priority: 'high' as const,
    note: '例行检查',
    is_active: 1 as const,
  };

  afterEach(() => {
    db?.close();
    db = null;
  });

  describe('recurrence service', () => {
    it.each([
      [{ ...validInput, end_date: '' }, '日期不能为空'],
      [{ ...validInput, end_date: '2026-12-01' }, '结束日期不得早于开始日期'],
      [{ ...validInput, interval: 0 }, '间隔周数至少为 1'],
      [{ ...validInput, byweekday: 7 }, '星期编号必须在 0 到 6 之间'],
      [{ ...validInput, kind: 'other' }, '周期规则类型必须是任务或会议'],
    ])('rejects invalid rules with a Chinese message', async (input, message) => {
      const service = createService();
      await seedProject();
      await expect(service.createRule(input as RecurrenceRuleInput)).rejects.toThrow(message);
    });

    it('materializes a cross-year task atomically and retains it after the rule is deleted', async () => {
      const service = createService();
      await seedProject();
      const created = await service.createRule(validInput);
      const materialized = await service.materialize(created.id, '2027-01-06');

      expect(materialized).toMatchObject({
        source_rule_id: created.id,
        source_occurrence_date: '2027-01-06',
        due_date: '2027-01-06',
      });
      expect(await service.getRule(created.id)).toEqual(created);
      await expect(service.materialize(created.id, '2027-01-06')).rejects.toThrow(
        '该周期已处理，不能重复物化',
      );

      await service.deleteRule(created.id);
      expect(
        db?.raw.prepare('SELECT source_rule_id FROM tasks WHERE id = ?').get(materialized.id),
      ).toEqual({
        source_rule_id: created.id,
      });
    });

    it('removes the generated record and exception together when cancelling materialization', async () => {
      const service = createService();
      await seedProject();
      const created = await service.createRule(validInput);
      const materialized = await service.materialize(created.id, '2027-01-06');

      await service.cancelMaterialization(created.id, '2027-01-06');

      expect(
        db?.raw.prepare('SELECT * FROM tasks WHERE id = ?').get(materialized.id),
      ).toBeUndefined();
      expect(
        db?.raw
          .prepare('SELECT * FROM recurrence_exceptions WHERE rule_id = ? AND occurrence_date = ?')
          .get(created.id, '2027-01-06'),
      ).toBeUndefined();
    });

    it('skips an exception from expansion', async () => {
      const service = createService();
      await seedProject();
      const created = await service.createRule(validInput);
      await service.createException(created.id, { occurrence_date: '2027-01-06', action: 'skip' });

      expect(
        expandRule(
          created,
          '2026-12-01',
          '2027-01-31',
          null,
          await createRecurrenceRepository(requireDb().executor).findExceptions(created.id),
        ).occurrences.map((item) => item.date),
      ).not.toContain('2027-01-06');
    });

    it('rolls back both writes when materialization batch fails', async () => {
      const service = createService();
      await seedProject();
      const created = await service.createRule(validInput);
      const failing = createRecurrenceService({
        recurrence: createRecurrenceRepository(requireDb().executor),
        projects: createProjectRepository(requireDb().executor),
        tasks: createTaskRepository(requireDb().executor),
        meetings: createMeetingRepository(requireDb().executor),
        runBatch: () => Promise.reject(new Error('forced batch failure')),
      });

      await expect(failing.materialize(created.id, '2027-01-06')).rejects.toThrow(
        '物化周期记录失败，未写入任何数据',
      );
      expect(db?.raw.prepare('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({ count: 0 });
      expect(db?.raw.prepare('SELECT COUNT(*) AS count FROM recurrence_exceptions').get()).toEqual({
        count: 0,
      });
    });

    it('batch materializes meetings atomically and rejects duplicate occurrences', async () => {
      const service = createService();
      await seedProject();
      const created = await service.createRule({ ...validInput, kind: 'meeting' });

      const entities = await service.materializeMany(created.id, ['2027-01-06', '2027-01-13']);

      expect(entities).toHaveLength(2);
      expect(
        db?.raw
          .prepare('SELECT COUNT(*) AS count FROM meetings WHERE source_rule_id = ?')
          .get(created.id),
      ).toEqual({ count: 2 });
      await expect(service.materializeMany(created.id, ['2027-01-06'])).rejects.toThrow(
        '该周期已处理，不能重复物化',
      );
    });
  });
  it('uses the start week as the interval anchor and applies exceptions', () => {
    const result = expandRule(
      rule({ start_date: '2026-01-05', interval: 2 }),
      '2026-01-01',
      '2026-03-01',
      '2026-03-01',
      [
        {
          id: 'e',
          rule_id: 'r',
          occurrence_date: '2026-02-02',
          action: 'materialized',
          materialized_id: 't',
          created_at: '',
          updated_at: '',
        },
        {
          id: 's',
          rule_id: 'r',
          occurrence_date: '2026-02-16',
          action: 'skip',
          materialized_id: null,
          created_at: '',
          updated_at: '',
        },
      ],
    );
    expect(result.occurrences).toEqual([
      { date: '2026-01-05', materialized_id: null },
      { date: '2026-01-19', materialized_id: null },
      { date: '2026-02-02', materialized_id: 't' },
    ]);
  });
  it('expands Wednesday and Sunday rules using the Monday-first weekday convention', () => {
    expect(
      expandRule(
        rule({ byweekday: 2, start_date: '2026-01-05' }),
        '2026-01-01',
        '2026-01-18',
        '2026-01-18',
        [],
      ).occurrences.map((item) => item.date),
    ).toEqual(['2026-01-07', '2026-01-14']);
    expect(
      expandRule(
        rule({ byweekday: 6, start_date: '2026-01-05' }),
        '2026-01-01',
        '2026-01-18',
        '2026-01-18',
        [],
      ).occurrences.map((item) => item.date),
    ).toEqual(['2026-01-11', '2026-01-18']);
  });
  it('rejects unbounded rules and caps expansion', () => {
    expect(() => expandRule(rule(), '2026-01-01', '2026-02-01', null, [])).toThrow(
      '周期规则必须设置结束日期',
    );
    const result = expandRule(
      rule({ start_date: '2000-01-03' }),
      '2000-01-01',
      '2030-01-01',
      '2030-01-01',
      [],
    );
    expect(result.occurrences).toHaveLength(MAX_RECURRENCE_OCCURRENCES);
    expect(result.truncated).toBe(true);
  });
});
