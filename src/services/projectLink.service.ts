import { openUrl } from '@tauri-apps/plugin-opener';
import { localPathExists, openLocalPath } from '@/lib/commands';
import { nowIso } from '@/lib/date';
import { AppError, toAppError } from '@/lib/errors';
import { newId } from '@/lib/uuid';
import { resolveWebAddressForOpen } from '@/lib/webAddress';
import {
  getRepositories,
  type ProjectLinkQuery,
  type ProjectLinkRepository,
  type ProjectRepository,
  type TaskRepository,
} from '@/repositories';
import type { ProjectLink, ProjectLinkWithProject } from '@/types';
import { isAbsoluteWindowsPath, projectLinkInputSchema, type ProjectLinkInput } from './schemas';

export interface ProjectLinkOpenDeps {
  openUrl: (url: string) => Promise<void>;
  pathExists: (path: string) => Promise<boolean>;
  openPath: (path: string) => Promise<void>;
}

export interface ProjectLinkServiceDeps extends ProjectLinkOpenDeps {
  projectLinks: ProjectLinkRepository;
  projects: ProjectRepository;
  tasks?: TaskRepository;
}

export function isOpenableHttpUrl(value: string): boolean {
  return resolveWebAddressForOpen(value).ok;
}

export function createProjectLinkService(deps: ProjectLinkServiceDeps) {
  async function requireProject(projectId: string): Promise<void> {
    if ((await deps.projects.findById(projectId)) === null) {
      throw new AppError('not_found', '所属项目不存在或已被删除');
    }
  }

  async function requireOwnedLink(projectId: string, id: string): Promise<ProjectLink> {
    const link = await deps.projectLinks.findById(id);
    if (link === null || link.project_id !== projectId) {
      throw new AppError('not_found', '文件或链接不存在，或不属于当前项目');
    }
    return link;
  }

  async function validateTask(projectId: string, taskId: string | null): Promise<void> {
    if (taskId === null) return;
    const task = deps.tasks === undefined ? null : await deps.tasks.findById(taskId);
    if (task === null || task.project_id !== projectId) {
      throw new AppError('validation', '关联任务必须属于当前项目');
    }
  }

  return {
    async listProjectLinks(projectId: string): Promise<ProjectLink[]> {
      await requireProject(projectId);
      return deps.projectLinks.findByProject(projectId);
    },

    async listAllProjectLinks(query: ProjectLinkQuery = {}): Promise<ProjectLinkWithProject[]> {
      return deps.projectLinks.findAllWithProject(query);
    },

    async createProjectLink(projectId: string, input: ProjectLinkInput): Promise<ProjectLink> {
      await requireProject(projectId);
      const parsed = projectLinkInputSchema.parse(input);
      await validateTask(projectId, parsed.task_id ?? null);
      const now = nowIso();
      const link: ProjectLink = {
        id: newId(),
        project_id: projectId,
        label: parsed.label,
        link_type: parsed.link_type,
        target: parsed.target,
        description: parsed.description,
        task_id: parsed.task_id ?? null,
        is_sample: 0,
        created_at: now,
        updated_at: now,
      };
      await deps.projectLinks.insert(link);
      return link;
    },

    async updateProjectLink(
      projectId: string,
      id: string,
      input: ProjectLinkInput,
    ): Promise<ProjectLink> {
      await requireOwnedLink(projectId, id);
      const parsed = projectLinkInputSchema.parse(input);
      await validateTask(projectId, parsed.task_id ?? null);
      await deps.projectLinks.update(id, parsed, nowIso());
      return requireOwnedLink(projectId, id);
    },

    async deleteProjectLink(projectId: string, id: string): Promise<void> {
      await requireOwnedLink(projectId, id);
      await deps.projectLinks.deleteById(id);
    },

    async openProjectLink(projectId: string, id: string): Promise<void> {
      const link = await requireOwnedLink(projectId, id);
      try {
        if (link.link_type === 'url') {
          const resolved = resolveWebAddressForOpen(link.target);
          if (!resolved.ok) {
            throw new AppError(
              'validation',
              resolved.reason === 'unsupported' ? '暂不支持该链接类型' : '该链接不安全或无效',
            );
          }
          await deps.openUrl(resolved.value);
          return;
        }
        if (!isAbsoluteWindowsPath(link.target)) {
          throw new AppError('validation', '仅支持 Windows 绝对本地路径');
        }
        if (!(await deps.pathExists(link.target))) {
          throw new AppError('not_found', '文件或目录不存在');
        }
        await deps.openPath(link.target);
      } catch (caught) {
        throw toAppError(caught);
      }
    },
  };
}

export type ProjectLinkService = ReturnType<typeof createProjectLinkService>;

export async function getProjectLinkService(): Promise<ProjectLinkService> {
  const repositories = await getRepositories();
  return createProjectLinkService({
    projectLinks: repositories.projectLinks,
    projects: repositories.projects,
    tasks: repositories.tasks,
    openUrl,
    pathExists: localPathExists,
    openPath: openLocalPath,
  });
}
