import { addDays, todayHK } from '@/lib/date';
import type {
  ActionItemRepository,
  MeetingRepository,
  MilestoneRepository,
  ProjectRepository,
  RiskRepository,
  TaskDependencyRepository,
  TaskRepository,
} from '@/repositories';
import { getRepositories } from '@/repositories';
import type {
  ActionItem,
  Meeting,
  Milestone,
  Project,
  RiskWithProject,
  TaskWithProject,
} from '@/types';
import { buildDependencyGraph, deriveBlockedRisks, predecessorsOf } from './dependencyGraph';
import { computeProjectProgress, type ProjectProgress } from './projectProgress';

const CLOSED_TASK_STATUSES = new Set(['done', 'cancelled']);
const REMINDER_EXCLUDED_TASK_STATUSES = new Set(['done', 'cancelled', 'postponed']);

export interface DashboardServiceDeps {
  projects: ProjectRepository;
  tasks: TaskRepository;
  dependencies: TaskDependencyRepository;
  milestones: MilestoneRepository;
  meetings: MeetingRepository;
  actionItems: ActionItemRepository;
  risks: RiskRepository;
}

export interface DashboardProject {
  readonly project: Project;
  readonly progress: ProjectProgress;
}

export interface DashboardMeeting {
  readonly meeting: Meeting;
  readonly project: Project | null;
  readonly actionItems: readonly ActionItem[];
}

export interface DashboardMilestone {
  readonly milestone: Milestone;
  readonly project: Project | null;
}

export interface BlockedPropagationRisk {
  readonly task: TaskWithProject;
  readonly blockedBy: readonly TaskWithProject[];
}

export interface MilestonePredecessorRisk {
  readonly milestone: Milestone;
  readonly project: Project | null;
  readonly blockingTasks: readonly TaskWithProject[];
}

export interface DashboardData {
  readonly today: string;
  readonly projects: readonly DashboardProject[];
  readonly todayTasks: readonly TaskWithProject[];
  readonly upcomingTasks: readonly TaskWithProject[];
  readonly overdueTasks: readonly TaskWithProject[];
  readonly upcomingMeetings: readonly DashboardMeeting[];
  readonly todayMilestones: readonly DashboardMilestone[];
  readonly overdueMilestones: readonly DashboardMilestone[];
  readonly futureMilestones: readonly DashboardMilestone[];
  readonly overdueRisks: readonly TaskWithProject[];
  readonly lowProgressRisks: readonly TaskWithProject[];
  readonly blockedPropagationRisks: readonly BlockedPropagationRisk[];
  readonly milestonePredecessorRisks: readonly MilestonePredecessorRisk[];
  readonly openRisks: readonly RiskWithProject[];
}

function isReminderEligible(task: TaskWithProject): boolean {
  return task.archived_at === null && !REMINDER_EXCLUDED_TASK_STATUSES.has(task.status);
}

function unfinishedPredecessors(
  graph: ReturnType<typeof buildDependencyGraph>,
  taskId: string,
): readonly string[] {
  const visited = new Set<string>();
  const blocking: string[] = [];
  const queue = [...predecessorsOf(graph, taskId)];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || visited.has(current)) {
      continue;
    }
    visited.add(current);
    const task = graph.nodes.get(current);
    if (task !== undefined && task.archived_at === null && !CLOSED_TASK_STATUSES.has(task.status)) {
      blocking.push(current);
    }
    queue.push(...predecessorsOf(graph, current));
  }
  return blocking;
}

/**
 * Loads each dashboard source in a bounded query, then derives all risk signals
 * in memory. No derived result is persisted or causes a dashboard-side write.
 */
export function createDashboardService(deps: DashboardServiceDeps) {
  return {
    async load(today: string = todayHK()): Promise<DashboardData> {
      const sevenDays = addDays(today, 7);
      const fourteenDays = addDays(today, 14);
      const thirtyDays = addDays(today, 30);
      const [projects, tasks, dependencies, milestones, meetings, risks] = await Promise.all([
        deps.projects.findAll(),
        deps.tasks.findByQuery({ sort: 'due_date' }),
        deps.dependencies.findAll(),
        deps.milestones.findPendingThrough(thirtyDays),
        deps.meetings.findByDateRange(today, sevenDays),
        deps.risks.findByQuery(),
      ]);
      const actionItems = await deps.actionItems.findUnfinishedByMeetingIds(
        meetings.map((meeting) => meeting.id),
      );
      const projectById = new Map(projects.map((project) => [project.id, project]));
      const actionsByMeeting = new Map<string, ActionItem[]>();
      for (const actionItem of actionItems) {
        const current = actionsByMeeting.get(actionItem.meeting_id);
        if (current === undefined) {
          actionsByMeeting.set(actionItem.meeting_id, [actionItem]);
        } else {
          current.push(actionItem);
        }
      }

      const openTasks = tasks.filter(isReminderEligible);
      const graph = buildDependencyGraph(tasks, dependencies);
      const tasksById = new Map(tasks.map((task) => [task.id, task]));
      const overdueTasks = openTasks.filter(
        (task) => task.due_date !== null && task.due_date < today,
      );
      const overdueRisks = overdueTasks;
      const lowProgressRisks = openTasks.filter(
        (task) =>
          task.due_date !== null &&
          task.due_date >= today &&
          task.due_date <= sevenDays &&
          task.progress < 50,
      );
      const blockedPropagationRisks = deriveBlockedRisks(graph).flatMap((risk) => {
        const task = tasksById.get(risk.taskId);
        if (task === undefined) {
          return [];
        }
        return [
          {
            task,
            blockedBy: risk.blockedBy.flatMap((taskId) => {
              const blocker = tasksById.get(taskId);
              return blocker === undefined ? [] : [blocker];
            }),
          },
        ];
      });
      const milestonePredecessorRisks = milestones.flatMap((milestone) => {
        if (
          milestone.status === 'achieved' ||
          milestone.status === 'cancelled' ||
          milestone.date < today ||
          milestone.date > fourteenDays ||
          milestone.linked_task_id === null
        ) {
          return [];
        }
        const blockingTasks = unfinishedPredecessors(graph, milestone.linked_task_id).flatMap(
          (taskId) => {
            const task = tasksById.get(taskId);
            return task === undefined ? [] : [task];
          },
        );
        if (blockingTasks.length === 0) {
          return [];
        }
        return [
          { milestone, project: projectById.get(milestone.project_id) ?? null, blockingTasks },
        ];
      });
      const toDashboardMilestone = (milestone: Milestone): DashboardMilestone => ({
        milestone,
        project: projectById.get(milestone.project_id) ?? null,
      });

      return {
        today,
        projects: projects
          .filter((project) => project.archived_at === null)
          .map((project) => ({
            project,
            progress: computeProjectProgress(
              tasks.filter((task) => task.project_id === project.id),
            ),
          })),
        todayTasks: openTasks.filter((task) => task.due_date === today),
        upcomingTasks: openTasks.filter(
          (task) => task.due_date !== null && task.due_date > today && task.due_date <= sevenDays,
        ),
        overdueTasks,
        upcomingMeetings: meetings.map((meeting) => ({
          meeting,
          project:
            meeting.project_id === null ? null : (projectById.get(meeting.project_id) ?? null),
          actionItems: actionsByMeeting.get(meeting.id) ?? [],
        })),
        todayMilestones: milestones
          .filter((milestone) => milestone.date === today)
          .map(toDashboardMilestone),
        overdueMilestones: milestones
          .filter((milestone) => milestone.date < today)
          .map(toDashboardMilestone),
        futureMilestones: milestones
          .filter((milestone) => milestone.date > today && milestone.date <= thirtyDays)
          .map(toDashboardMilestone),
        overdueRisks,
        lowProgressRisks,
        blockedPropagationRisks,
        milestonePredecessorRisks,
        openRisks: risks.filter((risk) => risk.status === 'open' || risk.status === 'monitoring'),
      };
    },
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;

export async function getDashboardService(): Promise<DashboardService> {
  const repos = await getRepositories();
  return createDashboardService({
    projects: repos.projects,
    tasks: repos.tasks,
    dependencies: repos.taskDependencies,
    milestones: repos.milestones,
    meetings: repos.meetings,
    actionItems: repos.actionItems,
    risks: repos.risks,
  });
}
