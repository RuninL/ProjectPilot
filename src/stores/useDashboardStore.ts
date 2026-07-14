import { create } from 'zustand';

interface DashboardState {
  /** Set false whenever underlying data changes, so Phase 5 re-computes risk cards. */
  stale: boolean;
  invalidate: () => void;
  markFresh: () => void;
}

/** Dashboard risk-card cache invalidation flag. Computation arrives in Phase 5. */
export const useDashboardStore = create<DashboardState>((set) => ({
  stale: true,
  invalidate: () => {
    set({ stale: true });
  },
  markFresh: () => {
    set({ stale: false });
  },
}));
