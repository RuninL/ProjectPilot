import { create } from 'zustand';
import { toAppError } from '@/lib/errors';
import {
  getDependencyService,
  type DependencyService,
  type ProjectDependencyAnalysis,
} from '@/services/dependency.service';
import type { DependencyInput } from '@/services/schemas';

interface DependencyState {
  /** Null until a project has been loaded, so the UI can tell "empty" from "not yet". */
  analysis: ProjectDependencyAnalysis | null;
  loading: boolean;
  error: string | null;
  loadProject: (projectId: string) => Promise<void>;
  createDependency: (input: DependencyInput, projectId: string) => Promise<void>;
  deleteDependency: (id: string, projectId: string) => Promise<void>;
  reset: () => void;
}

/**
 * One project's dependency graph and everything derived from it. Mutations
 * reload the analysis rather than patching it locally: blocked risk and schedule
 * conflicts are projections of the whole graph, so a single new edge can change
 * rows the mutation never mentioned.
 *
 * Errors from mutations are stored *and* rethrown — the section shows the
 * message, and the calling dialog needs to know not to close itself.
 */
export const useDependencyStore = create<DependencyState>((set, get) => {
  async function mutate(
    projectId: string,
    run: (service: DependencyService) => Promise<unknown>,
  ): Promise<void> {
    try {
      const service = await getDependencyService();
      await run(service);
    } catch (caught) {
      set({ error: toAppError(caught).message });
      throw caught;
    }
    await get().loadProject(projectId);
  }

  return {
    analysis: null,
    loading: false,
    error: null,

    loadProject: async (projectId) => {
      set({ loading: true, error: null });
      try {
        const service = await getDependencyService();
        set({ analysis: await service.analyzeProject(projectId), loading: false });
      } catch (caught) {
        set({ error: toAppError(caught).message, loading: false });
      }
    },

    createDependency: async (input, projectId) => {
      await mutate(projectId, (service) => service.createDependency(input));
    },

    deleteDependency: async (id, projectId) => {
      await mutate(projectId, (service) => service.deleteDependency(id));
    },

    reset: () => {
      set({ analysis: null, loading: false, error: null });
    },
  };
});
