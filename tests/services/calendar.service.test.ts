import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMeetingRepository,
  createMilestoneRepository,
  createProjectRepository,
  createTaskRepository,
} from '@/repositories';
import { createCalendarService, type CalendarService } from '@/services/calendar.service';
import { makeMeeting, makeMilestone, makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

const TODAY = '2026-07-14';

let db: TestDb;
let service: CalendarService;

function buildService(current: TestDb): CalendarService {
  return createCalendarService({
    tasks: createTaskRepository(current.executor),
    meetings: createMeetingRepository(current.executor),
    milestones: createMilestoneRepository(current.executor),
    projects: createProjectRepository(current.executor),
  });
}

function entriesOn(
  month: Awaited<ReturnType<CalendarService['loadMonth']>>,
  date: string,
): readonly { kind: string; title: string }[] {
  const day = month.weeks.flat().find((candidate) => candidate.date === date);
  return (day?.entries ?? []).map((entry) => ({ kind: entry.kind, title: entry.title }));
}

beforeEach(async () => {
  db = createTestDb();
  service = buildService(db);
  await createProjectRepository(db.executor).insert(makeProject({ id: 'p1', name: '示例项目' }));
});

afterEach(() => {
  db.close();
});

describe('loadMonth', () => {
  it('aggregates tasks, meetings and milestones onto the same day', async () => {
    await createTaskRepository(db.executor).insert(
      makeTask({ id: 't1', title: '写文档', due_date: TODAY }),
    );
    await createMeetingRepository(db.executor).insert(
      makeMeeting({ id: 'm1', date: TODAY, topic: '周会' }),
    );
    await createMilestoneRepository(db.executor).insert(
      makeMilestone({ id: 'ms1', date: TODAY, name: '第一阶段' }),
    );

    const month = await service.loadMonth('2026-07', TODAY);

    expect(entriesOn(month, TODAY)).toEqual([
      { kind: 'meeting', title: '周会' },
      { kind: 'milestone', title: '第一阶段' },
      { kind: 'task', title: '写文档' },
    ]);
    expect(month.entryCount).toBe(3);
  });

  it('returns an empty grid for a month with no data', async () => {
    const month = await service.loadMonth('2026-07', TODAY);

    expect(month.entryCount).toBe(0);
    expect(month.weeks).toHaveLength(6);
    expect(month.label).toBe('2026年7月');
  });

  it('excludes archived tasks, matching every other read path', async () => {
    const tasks = createTaskRepository(db.executor);
    await tasks.insert(makeTask({ id: 'live', title: '在办', due_date: TODAY }));
    await tasks.insert(
      makeTask({ id: 'gone', title: '归档', due_date: TODAY, archived_at: '2026-07-01T00:00:00Z' }),
    );

    const month = await service.loadMonth('2026-07', TODAY);

    expect(entriesOn(month, TODAY)).toEqual([{ kind: 'task', title: '在办' }]);
  });

  it('pulls in the adjacent-month days the grid shows', async () => {
    await createMeetingRepository(db.executor).insert(
      makeMeeting({ id: 'prev', date: '2026-06-30', topic: '上月末' }),
    );
    await createMeetingRepository(db.executor).insert(
      makeMeeting({ id: 'next', date: '2026-08-03', topic: '下月初' }),
    );

    const month = await service.loadMonth('2026-07', TODAY);

    expect(entriesOn(month, '2026-06-30')).toEqual([{ kind: 'meeting', title: '上月末' }]);
    expect(entriesOn(month, '2026-08-03')).toEqual([{ kind: 'meeting', title: '下月初' }]);
    // Neither counts towards this month's total.
    expect(month.entryCount).toBe(0);
  });

  it('crosses the year boundary in both directions', async () => {
    await createMeetingRepository(db.executor).insert(
      makeMeeting({ id: 'a', date: '2026-12-31', topic: '年终' }),
    );
    await createMeetingRepository(db.executor).insert(
      makeMeeting({ id: 'b', date: '2027-01-04', topic: '开年' }),
    );

    const december = await service.loadMonth('2026-12', '2026-12-31');
    expect(entriesOn(december, '2026-12-31')).toEqual([{ kind: 'meeting', title: '年终' }]);
    expect(entriesOn(december, '2027-01-04')).toEqual([{ kind: 'meeting', title: '开年' }]);

    const january = await service.loadMonth('2027-01', '2026-12-31');
    expect(entriesOn(january, '2026-12-31')).toEqual([{ kind: 'meeting', title: '年终' }]);
    expect(january.entryCount).toBe(1);
  });

  it('keeps a standalone meeting on the calendar', async () => {
    await createMeetingRepository(db.executor).insert(
      makeMeeting({ id: 'solo', project_id: null, date: TODAY, topic: '一对一' }),
    );

    const month = await service.loadMonth('2026-07', TODAY);

    expect(entriesOn(month, TODAY)).toEqual([{ kind: 'meeting', title: '一对一' }]);
  });

  it('spans several projects in one month', async () => {
    await createProjectRepository(db.executor).insert(
      makeProject({ id: 'p2', name: '第二项目', color: '#DC2626' }),
    );
    await createMilestoneRepository(db.executor).insert(
      makeMilestone({ id: 'ms1', project_id: 'p1', date: '2026-07-10', name: '甲' }),
    );
    await createMilestoneRepository(db.executor).insert(
      makeMilestone({ id: 'ms2', project_id: 'p2', date: '2026-07-20', name: '乙' }),
    );

    const month = await service.loadMonth('2026-07', TODAY);

    expect(entriesOn(month, '2026-07-10')).toEqual([{ kind: 'milestone', title: '甲' }]);
    expect(entriesOn(month, '2026-07-20')).toEqual([{ kind: 'milestone', title: '乙' }]);
    expect(month.entryCount).toBe(2);
  });

  it('loads a task spanning the complete visible range and retains undated tasks for the colour-bar view', async () => {
    const tasks = createTaskRepository(db.executor);
    await tasks.insert(
      makeTask({ id: 'spanning', start_date: '2026-06-01', due_date: '2026-09-01' }),
    );
    await tasks.insert(makeTask({ id: 'undated', start_date: null, due_date: null }));

    const month = await service.loadMonth('2026-07', TODAY);

    expect(month.colorBar.lanes.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: 'spanning',
          displayStart: '2026-06-29',
          displayEnd: '2026-08-09',
        }),
      ]),
    );
    expect(month.colorBar.unscheduledTasks.map((task) => task.id)).toEqual(['undated']);
  });
});
