import { nowIso } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/uuid';
import type { ProjectQuery, ProjectRepository, TaskRepository } from '@/repositories';
import { getRepositories } from '@/repositories';
import type { Project } from '@/types';
import { computeProjectProgress, type ProjectProgress } from './projectProgress';
import { projectInputSchema, type ProjectInput } from './schemas';

export interface ProjectServiceDeps {
  projects: ProjectRepository;
  tasks: TaskRepository;
}

/** What a permanent delete would destroy, shown before the user confirms. */
export interface DeleteImpact {
  taskCount: number;
  meetingCount: number;
  milestoneCount: number;
  projectLinkCount: number;
}

function parseInput(input: ProjectInput): ProjectInput {
  // Re-validated here so a caller bypassing the form cannot write an invalid row.
  return projectInputSchema.parse(input);
}

export function createProjectService(deps: ProjectServiceDeps) {
  async function requireProject(id: string): Promise<Project> {
    const project = await deps.projects.findById(id);
    if (project === null) {
      throw new AppError('not_found', '项目不存在或已被删除');
    }
    return project;
  }

  return {
    async listProjects(query: ProjectQuery = {}): Promise<Project[]> {
      return deps.projects.findByQuery(query);
    },

    async getProject(id: string): Promise<Project> {
      return requireProject(id);
    },

    async createProject(input: ProjectInput): Promise<Project> {
      const parsed = parseInput(input);
      const now = nowIso();
      const project: Project = {
        id: newId(),
        name: parsed.name,
        description: parsed.description,
        status: parsed.status,
        color: parsed.color,
        start_date: parsed.start_date,
        target_end_date: parsed.target_end_date,
        archived_at: null,
        is_sample: 0,
        created_at: now,
        updated_at: now,
      };
      await deps.projects.insert(project);
      return project;
    },

    async updateProject(id: string, input: ProjectInput): Promise<Project> {
      await requireProject(id);
      const parsed = parseInput(input);
      const now = nowIso();
      await deps.projects.update(
        id,
        {
          name: parsed.name,
          description: parsed.description,
          status: parsed.status,
          color: parsed.color,
          start_date: parsed.start_date,
          target_end_date: parsed.target_end_date,
        },
        now,
      );
      return requireProject(id);
    },

    /**
     * Archiving is the only writer of `archived_at`, and it always moves
     * `status` in lockstep so the two can never disagree.
     */
    async archiveProject(id: string): Promise<void> {
      const project = await requireProject(id);
      if (project.archived_at !== null) {
        return;
      }
      const now = nowIso();
      await deps.projects.update(id, { archived_at: now, status: 'archived' }, now);
    },

    async restoreProject(id: string): Promise<void> {
      const project = await requireProject(id);
      if (project.archived_at === null) {
        return;
      }
      await deps.projects.update(id, { archived_at: null, status: 'active' }, nowIso());
    },

    /** Real counts for the delete confirmation — never an estimate or a placeholder. */
    async countDeleteImpact(id: string): Promise<DeleteImpact> {
      await requireProject(id);
      return deps.projects.countDeleteImpact(id);
    },

    /**
     * Permanent delete, allowed only from the archived state so a live project
     * can never be destroyed by a single mis-click. Tasks, milestones and links
     * go with it through the schema's ON DELETE CASCADE — one statement, so it
     * is already atomic and needs no batch.
     */
    async deleteProjectPermanently(id: string): Promise<void> {
      const project = await requireProject(id);
      if (project.archived_at === null) {
        throw new AppError('conflict', '只能永久删除已归档的项目，请先归档该项目');
      }
      await deps.projects.deleteById(id);
    },

    /** Completion rate over the project's non-archived tasks. */
    async getProgress(id: string): Promise<ProjectProgress> {
      return computeProjectProgress(await deps.tasks.findActiveByProject(id));
    },
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;

export async function getProjectService(): Promise<ProjectService> {
  const repos = await getRepositories();
  return createProjectService({ projects: repos.projects, tasks: repos.tasks });
}
