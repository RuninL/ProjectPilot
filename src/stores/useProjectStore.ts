import { create } from 'zustand';
import type { Project } from '@/types';

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
  showArchived: boolean;
  setProjects: (projects: Project[]) => void;
  setActiveProjectId: (id: string | null) => void;
  setShowArchived: (show: boolean) => void;
}

/**
 * Project list cache + active selection (UI state only). Phase 2 wires the
 * data flow: writes go through service → repository → DB, then re-fetch.
 */
export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  activeProjectId: null,
  showArchived: false,
  setProjects: (projects) => {
    set({ projects });
  },
  setActiveProjectId: (activeProjectId) => {
    set({ activeProjectId });
  },
  setShowArchived: (showArchived) => {
    set({ showArchived });
  },
}));
