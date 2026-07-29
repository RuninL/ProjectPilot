import { create } from 'zustand';

interface DashboardState {
  /** Optional invalidation marker for future dashboard refresh coordination. */
  stale: boolean;
  invalidate: () => void;
  markFresh: () => void;
}

/** Dashboard cache invalidation flag; dashboard aggregates are always read-only. */
export const useDashboardStore = create<DashboardState>((set) => ({
  stale: true,
  invalidate: () => {
    set({ stale: true });
  },
  markFresh: () => {
    set({ stale: false });
  },
}));
