import { create } from 'zustand';
import type { TaskQuery, TaskSort } from '@/repositories';
import type { TaskPriority, TaskStatus } from '@/types';

interface TaskFilterState {
  search: string;
  statuses: TaskStatus[];
  priorities: TaskPriority[];
  projectIds: string[];
  dueFrom: string | null;
  dueTo: string | null;
  sortBy: TaskSort;
  selectedIds: string[];
  setSearch: (search: string) => void;
  setStatuses: (statuses: TaskStatus[]) => void;
  setPriorities: (priorities: TaskPriority[]) => void;
  setProjectIds: (ids: string[]) => void;
  setDueRange: (from: string | null, to: string | null) => void;
  setSortBy: (sortBy: TaskSort) => void;
  toggleSelected: (id: string) => void;
  setSelectedIds: (ids: string[]) => void;
  clearSelection: () => void;
  reset: () => void;
}

const initial = {
  search: '',
  statuses: [] as TaskStatus[],
  priorities: [] as TaskPriority[],
  projectIds: [] as string[],
  dueFrom: null as string | null,
  dueTo: null as string | null,
  sortBy: 'due_date' as TaskSort,
  selectedIds: [] as string[],
};

/** Task list filter/search/sort/selection — pure UI state, never data itself. */
export const useTaskFilterStore = create<TaskFilterState>((set) => ({
  ...initial,
  setSearch: (search) => {
    set({ search });
  },
  setStatuses: (statuses) => {
    set({ statuses });
  },
  setPriorities: (priorities) => {
    set({ priorities });
  },
  setProjectIds: (projectIds) => {
    set({ projectIds });
  },
  setDueRange: (dueFrom, dueTo) => {
    set({ dueFrom, dueTo });
  },
  setSortBy: (sortBy) => {
    set({ sortBy });
  },
  toggleSelected: (id) => {
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((selected) => selected !== id)
        : [...state.selectedIds, id],
    }));
  },
  setSelectedIds: (selectedIds) => {
    set({ selectedIds });
  },
  clearSelection: () => {
    set({ selectedIds: [] });
  },
  reset: () => {
    set(initial);
  },
}));

/** Translate the UI filter state into a repository query. */
export function toTaskQuery(
  state: Pick<
    TaskFilterState,
    'search' | 'statuses' | 'priorities' | 'projectIds' | 'dueFrom' | 'dueTo' | 'sortBy'
  >,
  projectId?: string,
): TaskQuery {
  return {
    search: state.search,
    statuses: state.statuses,
    priorities: state.priorities,
    projectIds: projectId === undefined ? state.projectIds : [projectId],
    sort: state.sortBy,
    ...(state.dueFrom === null ? {} : { dueFrom: state.dueFrom }),
    ...(state.dueTo === null ? {} : { dueTo: state.dueTo }),
  };
}
