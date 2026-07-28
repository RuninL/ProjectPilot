import { nowIso, todayHK } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/uuid';
import type { MilestoneRepository, ProjectRepository, TaskRepository } from '@/repositories';
import { getRepositories } from '@/repositories';
import type { Milestone, MilestoneStatus, Task } from '@/types';
import { milestoneView, shouldPromptAchieved, type MilestoneView } from './milestoneStatus';
import { milestoneInputSchema, type MilestoneInput } from './schemas';

export interface MilestoneServiceDeps {
  milestones: MilestoneRepository;
  tasks: TaskRepository;
  projects: ProjectRepository;
}

/** A milestone plus its derived countdown and the linked task, ready to render. */
export interface MilestoneDetail {
  readonly milestone: Milestone;
  readonly view: MilestoneView;
  readonly linkedTask: Task | null;
  /**
   * The linked task is done and the milestone is still `upcoming`, so the UI may
   * ask. It is only ever a question — see `milestoneStatus.shouldPromptAchieved`.
   */
  readonly promptAchieved: boolean;
}

export function createMilestoneService(deps: MilestoneServiceDeps) {
  async function requireMilestone(id: string): Promise<Milestone> {
    const milestone = await deps.milestones.findById(id);
    if (milestone === null) {
      throw new AppError('not_found', '里程碑不存在或已被删除');
    }
    return milestone;
  }

  /** A linked task must exist and live in the same project as the milestone. */
  async function validateLink(linkedTaskId: string | null, projectId: string): Promise<void> {
    if (linkedTaskId === null) {
      return;
    }
    const task = await deps.tasks.findById(linkedTaskId);
    if (task === null) {
      throw new AppError('validation', '关联任务不存在或已被删除');
    }
    if (task.project_id !== projectId) {
      throw new AppError('validation', '关联任务必须属于同一个项目');
    }
  }

  async function requireProject(projectId: string): Promise<void> {
    if ((await deps.projects.findById(projectId)) === null) {
      throw new AppError('validation', '所属项目不存在或已被删除');
    }
  }

  async function toDetail(milestone: Milestone, today: string): Promise<MilestoneDetail> {
    const linkedTask =
      milestone.linked_task_id === null
        ? null
        : await deps.tasks.findById(milestone.linked_task_id);
    return {
      milestone,
      view: milestoneView(milestone, today),
      linkedTask,
      promptAchieved: shouldPromptAchieved(milestone, linkedTask),
    };
  }

  return {
    async listByProject(projectId: string, today: string = todayHK()): Promise<MilestoneDetail[]> {
      const milestones = await deps.milestones.findByProject(projectId);
      return Promise.all(milestones.map((milestone) => toDetail(milestone, today)));
    },

    async getMilestone(id: string, today: string = todayHK()): Promise<MilestoneDetail> {
      return toDetail(await requireMilestone(id), today);
    },

    async createMilestone(input: MilestoneInput): Promise<Milestone> {
      const parsed = milestoneInputSchema.parse(input);
      await requireProject(parsed.project_id);
      await validateLink(parsed.linked_task_id, parsed.project_id);

      const now = nowIso();
      const milestone: Milestone = {
        id: newId(),
        project_id: parsed.project_id,
        linked_task_id: parsed.linked_task_id,
        name: parsed.name,
        description: parsed.description,
        date: parsed.date,
        status: parsed.status,
        achieved_at: parsed.status === 'achieved' ? now : null,
        is_sample: 0,
        created_at: now,
        updated_at: now,
      };
      await deps.milestones.insert(milestone);
      return milestone;
    },

    async updateMilestone(id: string, input: MilestoneInput): Promise<Milestone> {
      const existing = await requireMilestone(id);
      const parsed = milestoneInputSchema.parse(input);
      if (parsed.project_id !== existing.project_id) {
        throw new AppError('validation', '里程碑不能移动到其他项目');
      }
      await validateLink(parsed.linked_task_id, parsed.project_id);

      const now = nowIso();
      await deps.milestones.update(
        id,
        {
          linked_task_id: parsed.linked_task_id,
          name: parsed.name,
          description: parsed.description,
          date: parsed.date,
          status: parsed.status,
          achieved_at: achievedAtFor(parsed.status, existing, now),
        },
        now,
      );
      return requireMilestone(id);
    },

    /**
     * Set a milestone's status. Every caller is a deliberate user action — the
     * completed-link prompt routes here only after the user answers "是". Nothing
     * in this service changes a status on its own, so answering "否" simply never
     * reaches this method and the row stays exactly as it was.
     */
    async setStatus(id: string, status: MilestoneStatus): Promise<Milestone> {
      const existing = await requireMilestone(id);
      const now = nowIso();
      await deps.milestones.update(
        id,
        { status, achieved_at: achievedAtFor(status, existing, now) },
        now,
      );
      return requireMilestone(id);
    },

    async deleteMilestone(id: string): Promise<void> {
      await requireMilestone(id);
      await deps.milestones.deleteById(id);
    },
  };
}

/** `achieved_at` is stamped on the way into `achieved` and cleared on the way out. */
function achievedAtFor(status: MilestoneStatus, previous: Milestone, now: string): string | null {
  if (status !== 'achieved') {
    return null;
  }
  return previous.achieved_at ?? now;
}

export type MilestoneService = ReturnType<typeof createMilestoneService>;

export async function getMilestoneService(): Promise<MilestoneService> {
  const repos = await getRepositories();
  return createMilestoneService({
    milestones: repos.milestones,
    tasks: repos.tasks,
    projects: repos.projects,
  });
}
