import { create } from 'zustand';
import type { TaskQuery, TaskScope, TaskSort } from '@/repositories';
import type { TaskPriority, TaskStatus } from '@/types';

interface TaskFilterState {
  search: string;
  statuses: TaskStatus[];
  priorities: TaskPriority[];
  projectIds: string[];
  participantIds: string[];
  dueFrom: string | null;
  dueTo: string | null;
  sortBy: TaskSort;
  /** 活动 / 已归档 / 全部 view; 'active' also excludes project-archived tasks. */
  scope: TaskScope;
  selectedIds: string[];
  setSearch: (search: string) => void;
  setStatuses: (statuses: TaskStatus[]) => void;
  setPriorities: (priorities: TaskPriority[]) => void;
  setProjectIds: (ids: string[]) => void;
  setParticipantIds: (ids: string[]) => void;
  setDueRange: (from: string | null, to: string | null) => void;
  setSortBy: (sortBy: TaskSort) => void;
  setScope: (scope: TaskScope) => void;
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
  participantIds: [] as string[],
  dueFrom: null as string | null,
  dueTo: null as string | null,
  sortBy: 'due_date' as TaskSort,
  scope: 'active' as TaskScope,
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
  setParticipantIds: (participantIds) => {
    set({ participantIds });
  },
  setDueRange: (dueFrom, dueTo) => {
    set({ dueFrom, dueTo });
  },
  setSortBy: (sortBy) => {
    set({ sortBy });
  },
  setScope: (scope) => {
    set({ scope });
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
    | 'search'
    | 'statuses'
    | 'priorities'
    | 'projectIds'
    | 'participantIds'
    | 'dueFrom'
    | 'dueTo'
    | 'sortBy'
    | 'scope'
  >,
  projectId?: string,
): TaskQuery {
  return {
    search: state.search,
    statuses: state.statuses,
    priorities: state.priorities,
    projectIds: projectId === undefined ? state.projectIds : [projectId],
    participantIds: state.participantIds,
    sort: state.sortBy,
    scope: state.scope,
    ...(state.dueFrom === null ? {} : { dueFrom: state.dueFrom }),
    ...(state.dueTo === null ? {} : { dueTo: state.dueTo }),
  };
}
