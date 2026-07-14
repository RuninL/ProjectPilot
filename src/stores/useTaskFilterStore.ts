import { create } from 'zustand';
import type { TaskPriority, TaskStatus } from '@/types';

export type TaskSortKey = 'due_date' | 'priority' | 'updated_at';

interface TaskFilterState {
  search: string;
  statuses: TaskStatus[];
  priorities: TaskPriority[];
  sortBy: TaskSortKey;
  selectedIds: string[];
  setSearch: (search: string) => void;
  setStatuses: (statuses: TaskStatus[]) => void;
  setPriorities: (priorities: TaskPriority[]) => void;
  setSortBy: (sortBy: TaskSortKey) => void;
  setSelectedIds: (ids: string[]) => void;
  reset: () => void;
}

const initial = {
  search: '',
  statuses: [] as TaskStatus[],
  priorities: [] as TaskPriority[],
  sortBy: 'due_date' as TaskSortKey,
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
  setSortBy: (sortBy) => {
    set({ sortBy });
  },
  setSelectedIds: (selectedIds) => {
    set({ selectedIds });
  },
  reset: () => {
    set(initial);
  },
}));
