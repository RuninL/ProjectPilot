import { create } from 'zustand';
import { toAppError } from '@/lib/errors';
import {
  getMilestoneService,
  type MilestoneDetail,
  type MilestoneService,
} from '@/services/milestone.service';
import type { MilestoneInput } from '@/services/schemas';
import type { MilestoneStatus } from '@/types';

interface MilestoneState {
  /** Null until a project has been loaded, so the section can tell "empty" from "not yet". */
  details: MilestoneDetail[] | null;
  loading: boolean;
  error: string | null;
  loadProject: (projectId: string) => Promise<void>;
  createMilestone: (input: MilestoneInput, projectId: string) => Promise<void>;
  updateMilestone: (id: string, input: MilestoneInput, projectId: string) => Promise<void>;
  setStatus: (id: string, status: MilestoneStatus, projectId: string) => Promise<void>;
  deleteMilestone: (id: string, projectId: string) => Promise<void>;
  reset: () => void;
}

/**
 * One project's milestones with their derived countdowns.
 *
 * `setStatus` is the only path that changes a status, and nothing calls it
 * without a user having said so — the achieve prompt calls it after 是 and
 * simply returns after 否, which is what makes "答否即不变" true by construction
 * rather than by a revert.
 */
export const useMilestoneStore = create<MilestoneState>((set, get) => {
  async function mutate(
    projectId: string,
    run: (service: MilestoneService) => Promise<unknown>,
  ): Promise<void> {
    try {
      await run(await getMilestoneService());
    } catch (caught) {
      set({ error: toAppError(caught).message });
      throw caught;
    }
    await get().loadProject(projectId);
  }

  return {
    details: null,
    loading: false,
    error: null,

    loadProject: async (projectId) => {
      set({ loading: true, error: null });
      try {
        const service = await getMilestoneService();
        set({ details: await service.listByProject(projectId), loading: false });
      } catch (caught) {
        set({ error: toAppError(caught).message, loading: false });
      }
    },

    createMilestone: async (input, projectId) => {
      await mutate(projectId, (service) => service.createMilestone(input));
    },

    updateMilestone: async (id, input, projectId) => {
      await mutate(projectId, (service) => service.updateMilestone(id, input));
    },

    setStatus: async (id, status, projectId) => {
      await mutate(projectId, (service) => service.setStatus(id, status));
    },

    deleteMilestone: async (id, projectId) => {
      await mutate(projectId, (service) => service.deleteMilestone(id));
    },

    reset: () => {
      set({ details: null, loading: false, error: null });
    },
  };
});
