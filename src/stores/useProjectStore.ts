import { create } from 'zustand';
import { toAppError } from '@/lib/errors';
import type { ProjectQuery, ProjectScope, ProjectSort } from '@/repositories';
import {
  getProjectService,
  type DeleteImpact,
  type ProjectService,
} from '@/services/project.service';
import type { ProjectProgress } from '@/services/projectProgress';
import type { ProjectInput } from '@/services/schemas';
import type { Project, ProjectStatus } from '@/types';

interface ProjectFilters {
  search: string;
  status: ProjectStatus | null;
  scope: ProjectScope;
  sort: ProjectSort;
}

interface ProjectState {
  projects: Project[];
  /** Completion rate per project id, refreshed together with the list. */
  progress: Record<string, ProjectProgress>;
  loading: boolean;
  error: string | null;
  filters: ProjectFilters;
  /** Non-archived projects for selects and filters — independent of `filters`. */
  options: Project[];
  setFilters: (patch: Partial<ProjectFilters>) => void;
  loadProjects: () => Promise<void>;
  loadOptions: () => Promise<void>;
  /** Read-only single-project fetch for the detail page. */
  getProject: (id: string) => Promise<Project>;
  createProject: (input: ProjectInput) => Promise<void>;
  updateProject: (id: string, input: ProjectInput) => Promise<void>;
  archiveProject: (id: string) => Promise<void>;
  restoreProject: (id: string) => Promise<void>;
  countDeleteImpact: (id: string) => Promise<DeleteImpact>;
  deleteProjectPermanently: (id: string) => Promise<void>;
}

const INITIAL_FILTERS: ProjectFilters = {
  search: '',
  status: null,
  scope: 'active',
  sort: 'updated_at',
};

function toQuery(filters: ProjectFilters): ProjectQuery {
  return {
    search: filters.search,
    scope: filters.scope,
    sort: filters.sort,
    ...(filters.status === null ? {} : { status: filters.status }),
  };
}

/**
 * Project list state. Every mutation goes service → repository → SQLite and is
 * followed by a re-read, so the list always shows what the database holds.
 * Mutation errors are re-thrown for the caller to surface inline; only the list
 * load stores an error, because that one has no dialog to report into.
 */
export const useProjectStore = create<ProjectState>((set, get) => {
  async function mutate(run: (service: ProjectService) => Promise<unknown>): Promise<void> {
    const service = await getProjectService();
    await run(service);
    await get().loadProjects();
  }

  return {
    projects: [],
    progress: {},
    loading: false,
    error: null,
    filters: INITIAL_FILTERS,
    options: [],

    setFilters: (patch) => {
      set((state) => ({ filters: { ...state.filters, ...patch } }));
    },

    loadProjects: async () => {
      set({ loading: true, error: null });
      try {
        const service = await getProjectService();
        const projects = await service.listProjects(toQuery(get().filters));
        const rates = await Promise.all(
          projects.map(
            async (project) => [project.id, await service.getProgress(project.id)] as const,
          ),
        );
        set({ projects, progress: Object.fromEntries(rates), loading: false });
      } catch (caught) {
        set({ error: toAppError(caught).message, loading: false });
      }
    },

    loadOptions: async () => {
      const service = await getProjectService();
      set({ options: await service.listProjects({ scope: 'active', sort: 'name' }) });
    },

    getProject: async (id) => {
      const service = await getProjectService();
      return service.getProject(id);
    },

    createProject: async (input) => {
      await mutate((service) => service.createProject(input));
    },

    updateProject: async (id, input) => {
      await mutate((service) => service.updateProject(id, input));
    },

    archiveProject: async (id) => {
      await mutate((service) => service.archiveProject(id));
    },

    restoreProject: async (id) => {
      await mutate((service) => service.restoreProject(id));
    },

    /** Read-only: the real task count shown in the delete confirmation. */
    countDeleteImpact: async (id) => {
      const service = await getProjectService();
      return service.countDeleteImpact(id);
    },

    deleteProjectPermanently: async (id) => {
      await mutate((service) => service.deleteProjectPermanently(id));
    },
  };
});
