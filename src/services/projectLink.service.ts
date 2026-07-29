import { openUrl } from '@tauri-apps/plugin-opener';
import { localPathExists, openLocalPath } from '@/lib/commands';
import { nowIso } from '@/lib/date';
import { AppError, toAppError } from '@/lib/errors';
import { newId } from '@/lib/uuid';
import {
  getRepositories,
  type ProjectLinkRepository,
  type ProjectRepository,
} from '@/repositories';
import type { ProjectLink } from '@/types';
import {
  isAbsoluteWindowsPath,
  projectLinkInputSchema,
  type ProjectLinkInput,
} from './schemas';

export interface ProjectLinkOpenDeps {
  openUrl: (url: string) => Promise<void>;
  pathExists: (path: string) => Promise<boolean>;
  openPath: (path: string) => Promise<void>;
}

export interface ProjectLinkServiceDeps extends ProjectLinkOpenDeps {
  projectLinks: ProjectLinkRepository;
  projects: ProjectRepository;
}

export function isOpenableHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
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

  return {
    async listProjectLinks(projectId: string): Promise<ProjectLink[]> {
      await requireProject(projectId);
      return deps.projectLinks.findByProject(projectId);
    },

    async createProjectLink(projectId: string, input: ProjectLinkInput): Promise<ProjectLink> {
      await requireProject(projectId);
      const parsed = projectLinkInputSchema.parse(input);
      const now = nowIso();
      const link: ProjectLink = {
        id: newId(),
        project_id: projectId,
        label: parsed.label,
        link_type: parsed.link_type,
        target: parsed.target,
        description: parsed.description,
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
          if (!isOpenableHttpUrl(link.target)) {
            throw new AppError('validation', '仅支持 http/https 链接打开');
          }
          await deps.openUrl(link.target);
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
    openUrl,
    pathExists: localPathExists,
    openPath: openLocalPath,
  });
}
