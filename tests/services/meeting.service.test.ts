import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createActionItemRepository,
  createMeetingRepository,
  createProjectRepository,
} from '@/repositories';
import {
  createMeetingService,
  parseAttendees,
  type MeetingService,
} from '@/services/meeting.service';
import type { MeetingInput } from '@/services/schemas';
import { makeActionItem, makeProject } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb;
let service: MeetingService;

function buildService(current: TestDb): MeetingService {
  return createMeetingService({
    meetings: createMeetingRepository(current.executor),
    actionItems: createActionItemRepository(current.executor),
    projects: createProjectRepository(current.executor),
  });
}

/** The raw form shape, before the schema normalizes attendees and empty strings. */
function input(overrides: Partial<Record<keyof MeetingInput, unknown>> = {}): MeetingInput {
  return {
    project_id: 'p1',
    topic: '周会',
    date: '2026-07-14',
    start_time: null,
    attendees: '',
    agenda: '',
    notes: '',
    decisions: '',
    risks: '',
    ...overrides,
  } as unknown as MeetingInput;
}

beforeEach(async () => {
  db = createTestDb();
  service = buildService(db);
  await createProjectRepository(db.executor).insert(makeProject({ id: 'p1' }));
});

afterEach(() => {
  db.close();
});

describe('createMeeting', () => {
  it('persists a meeting attached to a project', async () => {
    const meeting = await service.createMeeting(input({ topic: '  规划会  ' }));

    expect(meeting.topic).toBe('规划会');
    expect(meeting.project_id).toBe('p1');
    expect(meeting.start_time).toBeNull();
    expect(meeting.is_sample).toBe(0);
    expect(await service.getMeeting(meeting.id)).toStrictEqual(meeting);
  });

  it('persists a standalone meeting with no project', async () => {
    const meeting = await service.createMeeting(input({ project_id: '' }));

    expect(meeting.project_id).toBeNull();
    expect(await service.listMeetings()).toHaveLength(1);
  });

  it('stores an optional start time and rejects a malformed one', async () => {
    const meeting = await service.createMeeting(input({ start_time: '09:30' }));
    expect(meeting.start_time).toBe('09:30');

    await expect(service.createMeeting(input({ start_time: '25:00' }))).rejects.toThrow(
      '时间必须为有效的 HH:MM（24 小时制）',
    );
  });

  it('rejects an empty topic and an empty date with Chinese messages', async () => {
    await expect(service.createMeeting(input({ topic: '   ' }))).rejects.toThrow(
      '会议主题不能为空',
    );
    await expect(service.createMeeting(input({ date: '' }))).rejects.toThrow('日期不能为空');
  });

  it('rejects an invalid calendar date', async () => {
    await expect(service.createMeeting(input({ date: '2026-02-30' }))).rejects.toThrow(
      '日期必须为有效的 YYYY-MM-DD',
    );
  });

  it('rejects a project that does not exist', async () => {
    await expect(service.createMeeting(input({ project_id: 'ghost' }))).rejects.toThrow(
      '所属项目不存在或已被删除',
    );
  });

  it('normalizes free-text attendees into a JSON array', async () => {
    const meeting = await service.createMeeting(
      input({ attendees: '张三, 李四\n王五，\n  \n赵六' }),
    );

    expect(parseAttendees(meeting.attendees)).toEqual(['张三', '李四', '王五', '赵六']);
  });

  it('allows a meeting about an archived project (recording history is not a new task)', async () => {
    await createProjectRepository(db.executor).insert(
      makeProject({ id: 'p-old', archived_at: '2026-07-01T00:00:00Z' }),
    );

    const meeting = await service.createMeeting(input({ project_id: 'p-old' }));
    expect(meeting.project_id).toBe('p-old');
  });
});

describe('updateMeeting', () => {
  it('changes fields and can detach the meeting from its project', async () => {
    const created = await service.createMeeting(input());

    const updated = await service.updateMeeting(
      created.id,
      input({ project_id: '', topic: '改名了', start_time: '14:05', notes: '纪要' }),
    );

    expect(updated.project_id).toBeNull();
    expect(updated.topic).toBe('改名了');
    expect(updated.start_time).toBe('14:05');
    expect(updated.notes).toBe('纪要');
    expect(updated.created_at).toBe(created.created_at);
  });

  it('rejects an unknown meeting', async () => {
    await expect(service.updateMeeting('ghost', input())).rejects.toThrow('会议不存在或已被删除');
  });
});

describe('deleteMeeting', () => {
  it('reports the real number of action items it would take with it', async () => {
    const meeting = await service.createMeeting(input());
    const items = createActionItemRepository(db.executor);
    await items.insert(makeActionItem({ id: 'a1', meeting_id: meeting.id }));
    await items.insert(makeActionItem({ id: 'a2', meeting_id: meeting.id }));

    expect(await service.countActionItems(meeting.id)).toBe(2);
  });

  it('cascades to its own action items without touching another meeting', async () => {
    const keep = await service.createMeeting(input({ topic: '保留' }));
    const drop = await service.createMeeting(input({ topic: '删除' }));
    const items = createActionItemRepository(db.executor);
    await items.insert(makeActionItem({ id: 'a1', meeting_id: drop.id }));
    await items.insert(makeActionItem({ id: 'a2', meeting_id: drop.id }));
    await items.insert(makeActionItem({ id: 'b1', meeting_id: keep.id }));

    await service.deleteMeeting(drop.id);

    expect(await items.findByMeeting(drop.id)).toHaveLength(0);
    expect(await items.findByMeeting(keep.id)).toHaveLength(1);
    expect(await service.listMeetings()).toHaveLength(1);
  });

  it('rejects an unknown meeting so a stale list cannot delete twice', async () => {
    await expect(service.deleteMeeting('ghost')).rejects.toThrow('会议不存在或已被删除');
  });
});

describe('listing', () => {
  it('orders meetings newest first and filters by project', async () => {
    await service.createMeeting(input({ date: '2026-07-01', topic: '早' }));
    await service.createMeeting(input({ date: '2026-07-20', topic: '晚' }));
    await service.createMeeting(input({ project_id: '', date: '2026-07-10', topic: '独立' }));

    expect((await service.listMeetings()).map((m) => m.topic)).toEqual(['晚', '独立', '早']);
    expect((await service.listByProject('p1')).map((m) => m.topic)).toEqual(['晚', '早']);
  });
});

describe('parseAttendees', () => {
  it('reads a JSON array of names', () => {
    expect(parseAttendees('["张三","李四"]')).toEqual(['张三', '李四']);
  });

  it('degrades to an empty list rather than throwing on bad data', () => {
    expect(parseAttendees('')).toEqual([]);
    expect(parseAttendees('not json')).toEqual([]);
    expect(parseAttendees('"张三"')).toEqual([]);
    expect(parseAttendees('[1, null, "张三", ""]')).toEqual(['张三']);
  });
});
