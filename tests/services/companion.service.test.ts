import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMeetingRepository,
  createMilestoneRepository,
  createProjectRepository,
  createTaskRepository,
} from '@/repositories';
import { createCompanionService, type CompanionService } from '@/services/companion.service';
import { makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

const TODAY = '2026-07-20';

let db: TestDb;
let service: CompanionService;

beforeEach(async () => {
  db = createTestDb();
  const projects = createProjectRepository(db.executor);
  await projects.insert(makeProject({ id: 'p1', name: '当前项目' }));
  service = createCompanionService({
    tasks: createTaskRepository(db.executor),
    meetings: createMeetingRepository(db.executor),
    milestones: createMilestoneRepository(db.executor),
    projects,
  });
});

afterEach(() => {
  db.close();
});

describe('Companion today tasks', () => {
  it('includes tasks due, starting, or in progress on the selected date', async () => {
    const tasks = createTaskRepository(db.executor);
    await tasks.insert(makeTask({ id: 'due-today', project_id: 'p1', due_date: TODAY }));
    await tasks.insert(
      makeTask({
        id: 'starts-today',
        project_id: 'p1',
        start_date: TODAY,
        due_date: '2026-07-23',
      }),
    );
    await tasks.insert(
      makeTask({
        id: 'spans-today',
        project_id: 'p1',
        start_date: '2026-07-18',
        due_date: '2026-07-23',
      }),
    );
    await tasks.insert(
      makeTask({ id: 'start-only-today', project_id: 'p1', start_date: TODAY, due_date: null }),
    );
    await tasks.insert(makeTask({ id: 'overdue', project_id: 'p1', due_date: '2026-07-19' }));
    await tasks.insert(
      makeTask({ id: 'done-today', project_id: 'p1', due_date: TODAY, status: 'done' }),
    );
    await tasks.insert(
      makeTask({
        id: 'future',
        project_id: 'p1',
        start_date: '2026-07-21',
        due_date: '2026-07-22',
      }),
    );

    const items = await service.loadToday(TODAY);

    expect(
      items
        .filter((item) => item.kind === 'today-task')
        .map((item) => item.id)
        .sort(),
    ).toEqual(['due-today', 'spans-today', 'start-only-today', 'starts-today']);
    expect(items.filter((item) => item.kind === 'overdue-task').map((item) => item.id)).toEqual([
      'overdue',
    ]);
    expect(items.find((item) => item.id === 'starts-today')?.subtitle).toBe('当前项目');
  });
});
