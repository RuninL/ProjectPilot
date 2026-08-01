import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMeetingRepository } from '@/repositories/meeting.repo';
import { createProjectRepository } from '@/repositories/project.repo';
import { createTaskMeetingRepository } from '@/repositories/taskMeeting.repo';
import { createTaskRepository } from '@/repositories/task.repo';
import { createTaskMeetingService, type TaskMeetingService } from '@/services/taskMeeting.service';
import { makeMeeting, makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

describe('taskMeeting.service', () => {
  let db: TestDb;
  let service: TaskMeetingService;

  beforeEach(async () => {
    db = createTestDb();
    const projects = createProjectRepository(db.executor);
    const tasks = createTaskRepository(db.executor);
    const meetings = createMeetingRepository(db.executor);
    service = createTaskMeetingService({
      taskMeetings: createTaskMeetingRepository(db.executor),
      tasks,
      meetings,
    });
    await projects.insert(makeProject());
    await tasks.insert(makeTask());
    await meetings.insert(makeMeeting());
    await meetings.insert(makeMeeting({ id: 'm2', topic: '评审会' }));
  });

  afterEach(() => {
    db.close();
  });

  it('关联会议后可按任务列出，且不影响项目或参与人数据', async () => {
    await service.link('t1', 'm1');
    const links = await service.listByTask('t1');
    expect(links.map((link) => link.meeting_id)).toEqual(['m1']);
    expect((await service.listMeetingsByTask('t1')).map((meeting) => meeting.id)).toEqual(['m1']);
    expect((await service.listTasksByMeeting('m1')).map((task) => task.id)).toEqual(['t1']);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM project_participants').get()).toEqual({
      n: 0,
    });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM task_participants').get()).toEqual({ n: 0 });
  });

  it('同一会议不能重复关联', async () => {
    await service.link('t1', 'm1');
    await expect(service.link('t1', 'm1')).rejects.toThrow('该会议已与此任务关联');
  });

  it('任务或会议不存在时拒绝关联', async () => {
    await expect(service.link('missing', 'm1')).rejects.toThrow('任务不存在或已被删除');
    await expect(service.link('t1', 'missing')).rejects.toThrow('会议不存在或已被删除');
  });

  it('可以取消关联，重复取消会报错', async () => {
    await service.link('t1', 'm1');
    await service.unlink('t1', 'm1');
    expect(await service.listByTask('t1')).toEqual([]);
    await expect(service.unlink('t1', 'm1')).rejects.toThrow('关联不存在或已被移除');
  });

  it('删除任务或会议时级联清理关联记录', async () => {
    await service.link('t1', 'm1');
    await service.link('t1', 'm2');
    db.raw.prepare('DELETE FROM meetings WHERE id = ?').run('m1');
    expect((await service.listByTask('t1')).map((link) => link.meeting_id)).toEqual(['m2']);
    db.raw.prepare('DELETE FROM tasks WHERE id = ?').run('t1');
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM task_meetings').get()).toEqual({ n: 0 });
  });
});
