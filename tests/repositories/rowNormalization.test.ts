import { describe, expect, it } from 'vitest';
import { meetingRowSchema, taskRowSchema } from '@/db/schemas';
import { normalizeRow } from '@/db/rowNormalization';
import type { QueryResult, SqlExecutor } from '@/lib/db';
import {
  createActionItemRepository,
  createAppSettingRepository,
  createMeetingRepository,
  createMilestoneRepository,
  createProjectRepository,
  createTaskDependencyRepository,
  createTaskRepository,
} from '@/repositories';
import { parseAttendees } from '@/services/meeting.service';
import {
  makeActionItem,
  makeMeeting,
  makeMilestone,
  makeProject,
  makeTask,
} from '../helpers/fixtures';
import { NOW } from '../helpers/testDb';

/**
 * tauri-plugin-sql (sqlx) maps every column to JSON by its runtime storage class,
 * so TEXT columns can arrive as numbers, booleans or byte arrays — shapes
 * better-sqlite3 never produces, which is why `/meetings` only failed on the
 * Windows build (`attendees`: expected string, received array). These tests feed
 * those decoded shapes through the real repository parse path.
 */

/** Returns whatever rows the driver is pretending to have decoded. */
class DecodedRowsExecutor implements SqlExecutor {
  constructor(private readonly rows: readonly unknown[]) {}

  select<T>(): Promise<T> {
    return Promise.resolve(this.rows as T);
  }

  execute(): Promise<QueryResult> {
    throw new Error('该测试只读取行,不应写库');
  }
}

function decodedAs(canonical: object, decoded: Record<string, unknown>): Record<string, unknown> {
  return { ...canonical, ...decoded };
}

function meetingsFrom(...rows: readonly unknown[]) {
  return createMeetingRepository(new DecodedRowsExecutor(rows));
}

describe('driver-shape normalization of select rows', () => {
  it('coerces an attendees array back to its stored JSON text', async () => {
    const repo = meetingsFrom(decodedAs(makeMeeting(), { attendees: ['张三', '李四'] }));

    const [meeting] = await repo.findAll();

    expect(meeting?.attendees).toBe('["张三","李四"]');
    expect(parseAttendees(meeting?.attendees ?? '')).toEqual(['张三', '李四']);
  });

  it('leaves an empty-string attendees value untouched', async () => {
    const repo = meetingsFrom(decodedAs(makeMeeting(), { attendees: '' }));

    const [meeting] = await repo.findAll();

    expect(meeting?.attendees).toBe('');
    expect(parseAttendees(meeting?.attendees ?? '')).toEqual([]);
  });

  it('preserves NULL rather than stringifying it, so NOT NULL columns still fail loudly', async () => {
    const repo = meetingsFrom(decodedAs(makeMeeting(), { attendees: null }));

    await expect(repo.findAll()).rejects.toThrow(/attendees/);
  });

  it('keeps NULL for nullable text columns', async () => {
    const repo = meetingsFrom(decodedAs(makeMeeting(), { project_id: null, start_time: null }));

    const [meeting] = await repo.findAll();

    expect(meeting?.project_id).toBeNull();
    expect(meeting?.start_time).toBeNull();
  });

  it('parses explicit NULL recurrence source columns as NULL', () => {
    const meeting = meetingRowSchema.parse(
      makeMeeting({ source_rule_id: null, source_occurrence_date: null }),
    );
    const task = taskRowSchema.parse(
      makeTask({ source_rule_id: null, source_occurrence_date: null }),
    );

    expect(meeting.source_rule_id).toBeNull();
    expect(meeting.source_occurrence_date).toBeNull();
    expect(task.source_rule_id).toBeNull();
    expect(task.source_occurrence_date).toBeNull();
  });

  it('defaults missing recurrence source columns to NULL for pre-0009 result rows', () => {
    const meeting = meetingRowSchema.parse(makeMeeting());
    const task = taskRowSchema.parse(makeTask());

    expect(meeting.source_rule_id).toBeNull();
    expect(meeting.source_occurrence_date).toBeNull();
    expect(task.source_rule_id).toBeNull();
    expect(task.source_occurrence_date).toBeNull();
  });

  it('stringifies numbers and booleans decoded for TEXT columns', async () => {
    const repo = meetingsFrom(
      decodedAs(makeMeeting(), {
        topic: 123,
        notes: true,
        decisions: false,
        risks: { severity: 'high' },
        is_sample: true,
      }),
    );

    const [meeting] = await repo.findAll();

    expect(meeting?.topic).toBe('123');
    expect(meeting?.notes).toBe('true');
    expect(meeting?.decisions).toBe('false');
    expect(meeting?.risks).toBe('{"severity":"high"}');
    // is_sample is a real INTEGER column: a boolean becomes the 0/1 the schema declares.
    expect(meeting?.is_sample).toBe(1);
  });

  it('keeps a BLOB-decoded byte array as text so the page still renders', async () => {
    // The bytes are not reinterpreted as UTF-8 — the row simply stays valid.
    const repo = meetingsFrom(decodedAs(makeMeeting(), { agenda: [104, 105] }));

    const [meeting] = await repo.findAll();

    expect(meeting?.agenda).toBe('[104,105]');
  });

  it('never stringifies numeric task columns', async () => {
    const repo = createTaskRepository(
      new DecodedRowsExecutor([
        decodedAs(makeTask(), {
          title: 123,
          description: true,
          progress: 40,
          estimated_hours: 1.5,
          actual_hours: 0,
          is_sample: 0,
        }),
      ]),
    );

    const [task] = await repo.findByProject('p1');

    expect(task?.title).toBe('123');
    expect(task?.description).toBe('true');
    expect(task?.progress).toBe(40);
    expect(task?.estimated_hours).toBe(1.5);
    expect(task?.actual_hours).toBe(0);
    expect(task?.is_sample).toBe(0);
  });

  it('normalizes project, milestone, action item, dependency and setting rows alike', async () => {
    const projects = createProjectRepository(
      new DecodedRowsExecutor([decodedAs(makeProject(), { name: 2026, description: ['a'] })]),
    );
    const milestones = createMilestoneRepository(
      new DecodedRowsExecutor([decodedAs(makeMilestone(), { name: 1, description: { a: 1 } })]),
    );
    const actionItems = createActionItemRepository(
      new DecodedRowsExecutor([decodedAs(makeActionItem(), { content: 42, owner: true })]),
    );
    const dependencies = createTaskDependencyRepository(
      new DecodedRowsExecutor([
        {
          id: 'd1',
          predecessor_id: 1,
          successor_id: 2,
          dep_type: 'FS',
          lag_days: 3,
          created_at: NOW,
          updated_at: NOW,
        },
      ]),
    );
    const settings = createAppSettingRepository(
      new DecodedRowsExecutor([
        { key: 'theme', value: { mode: 'dark' }, created_at: NOW, updated_at: NOW },
      ]),
    );

    const [project] = await projects.findAll();
    const [milestone] = await milestones.findByProject('p1');
    const [actionItem] = await actionItems.findByMeeting('m1');
    const [dependency] = await dependencies.findAll();
    const [setting] = await settings.findAll();

    expect(project?.name).toBe('2026');
    expect(project?.description).toBe('["a"]');
    expect(milestone?.name).toBe('1');
    expect(milestone?.description).toBe('{"a":1}');
    expect(actionItem?.content).toBe('42');
    expect(actionItem?.owner).toBe('true');
    expect(dependency?.predecessor_id).toBe('1');
    expect(dependency?.lag_days).toBe(3);
    expect(setting?.value).toBe('{"mode":"dark"}');
  });

  it('still rejects rows that no coercion can rescue', async () => {
    const repo = meetingsFrom(decodedAs(makeMeeting(), { date: 20260714 }));

    await expect(repo.findAll()).rejects.toThrow(/date/);
  });

  it('returns canonical rows by reference, leaving the better-sqlite3 path unchanged', () => {
    const row: unknown = makeMeeting({ attendees: '["张三"]' });

    expect(normalizeRow(meetingRowSchema, row)).toBe(row);
  });
});
