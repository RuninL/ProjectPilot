import { afterEach, describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import {
  createActionItemRepository,
  createMeetingRepository,
  createMilestoneRepository,
  createProjectRepository,
  createRiskRepository,
  createTaskDependencyRepository,
  createTaskRepository,
} from '@/repositories';
import { createCalendarService } from '@/services/calendar.service';
import { createDashboardService } from '@/services/dashboard.service';
import { buildDependencyGraph } from '@/services/dependencyGraph';
import { buildGanttViewModel } from '@/features/gantt/ganttViewModel';
import { DEFAULT_REMINDER_SETTINGS } from '@/features/settings/services/reminderSettings.service';
import { buildReminderCandidates } from '@/services/reminderRuntime.service';
import { makeMeeting, makeMilestone, makeProject, makeRisk, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb | null = null;

function elapsed<T>(operation: () => T): { value: T; milliseconds: number } {
  const startedAt = performance.now();
  const value = operation();
  return { value, milliseconds: performance.now() - startedAt };
}

describe('release performance benchmark', () => {
  afterEach(() => {
    db?.close();
    db = null;
  });

  it('measures list, Dashboard, Gantt, and calendar work with 1000 tasks', async () => {
    db = createTestDb();
    const repositories = {
      projects: createProjectRepository(db.executor),
      tasks: createTaskRepository(db.executor),
      dependencies: createTaskDependencyRepository(db.executor),
      milestones: createMilestoneRepository(db.executor),
      meetings: createMeetingRepository(db.executor),
      actionItems: createActionItemRepository(db.executor),
      risks: createRiskRepository(db.executor),
    };
    const tasks = Array.from({ length: 1000 }, (_, index) =>
      makeTask({
        id: `task-${String(index)}`,
        title: `性能任务 ${String(index)}`,
        start_date: `2026-07-${String((index % 28) + 1).padStart(2, '0')}`,
        due_date: `2026-08-${String((index % 28) + 1).padStart(2, '0')}`,
      }),
    );

    const project = makeProject();
    await repositories.projects.insert(project);
    for (const task of tasks) {
      await repositories.tasks.insert(task);
    }
    for (let index = 1; index < 100; index += 1) {
      await repositories.dependencies.insert({
        id: `edge-${String(index)}`,
        predecessor_id: tasks[index - 1]?.id ?? '',
        successor_id: tasks[index]?.id ?? '',
        dep_type: 'FS',
        lag_days: 0,
        created_at: '2026-07-14T00:00:00Z',
        updated_at: '2026-07-14T00:00:00Z',
      });
    }
    await repositories.milestones.insert(makeMilestone({ date: '2026-08-15' }));
    await repositories.meetings.insert(makeMeeting({ date: '2026-08-12' }));
    await repositories.risks.insert(makeRisk({ due_date: '2026-08-13' }));

    const taskListStartedAt = performance.now();
    const taskList = await repositories.tasks.findByQuery({ sort: 'due_date' });
    const taskListMilliseconds = performance.now() - taskListStartedAt;

    const dashboard = createDashboardService({
      projects: repositories.projects,
      tasks: repositories.tasks,
      dependencies: repositories.dependencies,
      milestones: repositories.milestones,
      meetings: repositories.meetings,
      actionItems: repositories.actionItems,
      risks: repositories.risks,
    });
    const dashboardStartedAt = performance.now();
    await dashboard.load('2026-08-12');
    const dashboardMilliseconds = performance.now() - dashboardStartedAt;

    const dependencyRows = await repositories.dependencies.findAll();
    const graphResult = elapsed(() => buildDependencyGraph(taskList, dependencyRows));
    const ganttResult = elapsed(() =>
      buildGanttViewModel({
        tasks: taskList,
        dependencies: dependencyRows,
        conflicts: [],
        blockedRisks: [],
        scale: 'month',
        today: '2026-08-12',
      }),
    );

    const calendar = createCalendarService({
      tasks: repositories.tasks,
      meetings: repositories.meetings,
      milestones: repositories.milestones,
      projects: repositories.projects,
    });
    const calendarStartedAt = performance.now();
    await calendar.loadMonth('2026-08', '2026-08-12');
    const calendarMilliseconds = performance.now() - calendarStartedAt;

    const reminderResult = elapsed(() =>
      buildReminderCandidates(
        {
          tasks: taskList,
          projects: [project],
          meetings: [],
          milestones: [],
        },
        DEFAULT_REMINDER_SETTINGS,
        '2026-08-12',
      ),
    );

    console.info(
      `release benchmark: task-list=${taskListMilliseconds.toFixed(2)}ms dashboard=${dashboardMilliseconds.toFixed(2)}ms graph=${graphResult.milliseconds.toFixed(2)}ms gantt=${ganttResult.milliseconds.toFixed(2)}ms calendar=${calendarMilliseconds.toFixed(2)}ms reminders=${reminderResult.milliseconds.toFixed(2)}ms`,
    );
    expect(taskList).toHaveLength(1000);
    expect(graphResult.milliseconds).toBeLessThan(100);
    expect(ganttResult.milliseconds).toBeLessThan(100);
    expect(reminderResult.milliseconds).toBeLessThan(100);
  });
});
