import { create } from 'zustand';

export type GanttScale = 'week' | 'month' | 'quarter';

interface GanttState {
  scale: GanttScale;
  selectedTaskId: string | null;
  showConflicts: boolean;
  showMilestones: boolean;
  setScale: (scale: GanttScale) => void;
  setSelectedTaskId: (id: string | null) => void;
  setShowConflicts: (show: boolean) => void;
  setShowMilestones: (show: boolean) => void;
}

/** Gantt view state: scale, selection, conflict overlay. Rendering arrives in Phase 3. */
export const useGanttStore = create<GanttState>((set) => ({
  scale: 'month',
  selectedTaskId: null,
  showConflicts: true,
  showMilestones: true,
  setScale: (scale) => {
    set({ scale });
  },
  setSelectedTaskId: (selectedTaskId) => {
    set({ selectedTaskId });
  },
  setShowConflicts: (showConflicts) => {
    set({ showConflicts });
  },
  setShowMilestones: (showMilestones) => {
    set({ showMilestones });
  },
}));
