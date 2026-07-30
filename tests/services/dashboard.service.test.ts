import { afterEach, describe, expect, it } from 'vitest';
import { addDays } from '@/lib/date';
import {
  createActionItemRepository,
  createMeetingRepository,
  createMilestoneRepository,
  createProjectRepository,
  createRiskRepository,
  createTaskDependencyRepository,
  createTaskRepository,
} from '@/repositories';
import { createDashboardService } from '@/services/dashboard.service';
import { NOW, createTestDb, type TestDb } from '../helpers/testDb';
import {
  makeActionItem,
  makeMeeting,
  makeMilestone,
  makeProject,
  makeTask,
} from '../helpers/fixtures';

let db: TestDb | null = null;

function useDashboardService() {
  db = createTestDb();
  const repos = getRepositoriesFor(db);
  return {
    repos,
    service: createDashboardService({
      projects: repos.projects,
      tasks: repos.tasks,
      dependencies: repos.taskDependencies,
      milestones: repos.milestones,
      meetings: repos.meetings,
      actionItems: repos.actionItems,
      risks: repos.risks,
    }),
  };
}

function getRepositoriesFor(testDb: TestDb) {
  return {
    projects: createProjectRepository(testDb.executor),
    tasks: createTaskRepository(testDb.executor),
    taskDependencies: createTaskDependencyRepository(testDb.executor),
    milestones: createMilestoneRepository(testDb.executor),
    meetings: createMeetingRepository(testDb.executor),
    actionItems: createActionItemRepository(testDb.executor),
    risks: createRiskRepository(testDb.executor),
  };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('dashboard aggregation', () => {
  it('derives task, meeting, milestone and all four risk regions at inclusive date boundaries', async () => {
    const today = '2028-02-28';
    const { repos, service } = useDashboardService();
    await repos.projects.insert(makeProject({ id: 'p1', name: '飞控升级' }));
    await repos.tasks.insert(makeTask({ id: 'overdue', due_date: '2028-02-27' }));
    await repos.tasks.insert(
      makeTask({ id: 'today-low', title: '今天低进度', due_date: today, progress: 49 }),
    );
    await repos.tasks.insert(
      makeTask({
        id: 'boundary-low',
        title: '第七天低进度',
        due_date: addDays(today, 7),
        progress: 20,
      }),
    );
    await repos.tasks.insert(
      makeTask({ id: 'after-window', due_date: addDays(today, 8), progress: 20 }),
    );
    await repos.tasks.insert(
      makeTask({ id: 'done', due_date: '2028-02-27', status: 'done', progress: 100 }),
    );
    await repos.tasks.insert(
      makeTask({ id: 'cancelled', due_date: today, status: 'cancelled', progress: 0 }),
    );
    await repos.tasks.insert(
      makeTask({ id: 'postponed-overdue', due_date: '2028-02-27', status: 'postponed' }),
    );
    await repos.tasks.insert(
      makeTask({ id: 'postponed-today', due_date: today, status: 'postponed', progress: 10 }),
    );
    await repos.tasks.insert(
      makeTask({
        id: 'postponed-upcoming',
        due_date: addDays(today, 3),
        status: 'postponed',
        progress: 10,
      }),
    );
    await repos.tasks.insert(makeTask({ id: 'blocked', status: 'blocked' }));
    await repos.tasks.insert(makeTask({ id: 'downstream', title: '受阻后续任务' }));
    await repos.tasks.insert(makeTask({ id: 'done-downstream', status: 'done', progress: 100 }));
    await repos.tasks.insert(makeTask({ id: 'milestone-predecessor', title: '前置开发' }));
    await repos.tasks.insert(makeTask({ id: 'milestone-target', title: '发布准备' }));
    await repos.taskDependencies.insert({
      id: 'blocked-edge',
      predecessor_id: 'blocked',
      successor_id: 'downstream',
      dep_type: 'FS',
      lag_days: 0,
      created_at: NOW,
      updated_at: NOW,
    });
    await repos.taskDependencies.insert({
      id: 'done-edge',
      predecessor_id: 'blocked',
      successor_id: 'done-downstream',
      dep_type: 'FS',
      lag_days: 0,
      created_at: NOW,
      updated_at: NOW,
    });
    await repos.taskDependencies.insert({
      id: 'milestone-edge',
      predecessor_id: 'milestone-predecessor',
      successor_id: 'milestone-target',
      dep_type: 'FS',
      lag_days: 0,
      created_at: NOW,
      updated_at: NOW,
    });
    await repos.milestones.insert(
      makeMilestone({ id: 'overdue-milestone', name: '逾期节点', date: addDays(today, -1) }),
    );
    await repos.milestones.insert(
      makeMilestone({ id: 'today-milestone', name: '今日节点', date: today }),
    );
    await repos.milestones.insert(
      makeMilestone({ id: 'future-30', name: '第 30 天节点', date: addDays(today, 30) }),
    );
    await repos.milestones.insert(
      makeMilestone({ id: 'outside-30', name: '第 31 天节点', date: addDays(today, 31) }),
    );
    await repos.milestones.insert(
      makeMilestone({
        id: 'milestone-risk',
        name: '第 14 天发布',
        linked_task_id: 'milestone-target',
        date: addDays(today, 14),
      }),
    );
    await repos.milestones.insert(
      makeMilestone({
        id: 'achieved',
        name: '已达成节点',
        date: today,
        status: 'achieved',
        achieved_at: NOW,
      }),
    );
    await repos.milestones.insert(
      makeMilestone({
        id: 'cancelled-milestone',
        name: '已取消节点',
        date: today,
        status: 'cancelled',
      }),
    );
    await repos.meetings.insert(
      makeMeeting({ id: 'meeting-today', date: today, topic: '今日评审' }),
    );
    await repos.meetings.insert(
      makeMeeting({ id: 'meeting-boundary', date: addDays(today, 7), topic: '第七天评审' }),
    );
    await repos.meetings.insert(
      makeMeeting({ id: 'meeting-after', date: addDays(today, 8), topic: '不应出现的会议' }),
    );
    await repos.actionItems.insert(
      makeActionItem({ id: 'open-action', meeting_id: 'meeting-today', content: '跟进接口' }),
    );
    await repos.actionItems.insert(
      makeActionItem({
        id: 'done-action',
        meeting_id: 'meeting-today',
        content: '已完成事项',
        status: 'done',
      }),
    );

    const dashboard = await service.load(today);

    expect(dashboard.todayTasks.map((task) => task.id)).toEqual(['today-low']);
    expect(dashboard.upcomingTasks.map((task) => task.id)).toContain('boundary-low');
    expect(dashboard.upcomingTasks.map((task) => task.id)).not.toContain('after-window');
    expect(dashboard.overdueTasks.map((task) => task.id)).toEqual(['overdue']);
    expect(dashboard.lowProgressRisks.map((task) => task.id)).toEqual([
      'today-low',
      'boundary-low',
    ]);
    const reminderIds = [
      ...dashboard.todayTasks,
      ...dashboard.upcomingTasks,
      ...dashboard.overdueTasks,
      ...dashboard.lowProgressRisks,
    ].map((task) => task.id);
    expect(reminderIds).not.toContain('postponed-overdue');
    expect(reminderIds).not.toContain('postponed-today');
    expect(reminderIds).not.toContain('postponed-upcoming');
    expect(dashboard.blockedPropagationRisks.map((risk) => risk.task.id)).toEqual(['downstream']);
    expect(dashboard.milestonePredecessorRisks).toHaveLength(1);
    expect(dashboard.milestonePredecessorRisks[0]).toMatchObject({
      milestone: { id: 'milestone-risk' },
      blockingTasks: [{ id: 'milestone-predecessor' }],
    });
    expect(dashboard.upcomingMeetings.map(({ meeting }) => meeting.id)).toEqual([
      'meeting-today',
      'meeting-boundary',
    ]);
    expect(dashboard.upcomingMeetings[0]?.actionItems.map((item) => item.id)).toEqual([
      'open-action',
    ]);
    expect(dashboard.overdueMilestones.map(({ milestone }) => milestone.id)).toEqual([
      'overdue-milestone',
    ]);
    expect(dashboard.todayMilestones.map(({ milestone }) => milestone.id)).toEqual([
      'today-milestone',
    ]);
    expect(dashboard.futureMilestones.map(({ milestone }) => milestone.id)).toContain('future-30');
    expect(dashboard.futureMilestones.map(({ milestone }) => milestone.id)).not.toContain(
      'outside-30',
    );
    expect(dashboard.todayMilestones.map(({ milestone }) => milestone.id)).not.toContain(
      'achieved',
    );
    expect(dashboard.todayMilestones.map(({ milestone }) => milestone.id)).not.toContain(
      'cancelled-milestone',
    );
  });

  it('handles a Dec 31 horizon across the year boundary', async () => {
    const today = '2026-12-31';
    const { repos, service } = useDashboardService();
    await repos.projects.insert(makeProject({ id: 'p1' }));
    await repos.tasks.insert(
      makeTask({ id: 'year-boundary', due_date: '2027-01-07', progress: 10 }),
    );
    await repos.milestones.insert(makeMilestone({ id: 'year-milestone', date: '2027-01-30' }));

    const dashboard = await service.load(today);

    expect(dashboard.upcomingTasks.map((task) => task.id)).toEqual(['year-boundary']);
    expect(dashboard.futureMilestones.map(({ milestone }) => milestone.id)).toEqual([
      'year-milestone',
    ]);
  });

  it('returns empty, readable aggregate collections for an empty database', async () => {
    const { service } = useDashboardService();

    const dashboard = await service.load('2026-07-14');

    expect(dashboard.projects).toEqual([]);
    expect(dashboard.todayTasks).toEqual([]);
    expect(dashboard.upcomingMeetings).toEqual([]);
    expect(dashboard.futureMilestones).toEqual([]);
    expect(dashboard.overdueRisks).toEqual([]);
    expect(dashboard.milestonePredecessorRisks).toEqual([]);
  });
});
