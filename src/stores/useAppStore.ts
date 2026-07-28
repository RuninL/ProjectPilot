import { create } from 'zustand';
import type { AppError } from '@/lib/errors';
import type { Theme } from '@/lib/theme';

export type { Theme };

interface AppState {
  theme: Theme;
  sidebarOpen: boolean;
  dbReady: boolean;
  globalError: AppError | null;
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setDbReady: (ready: boolean) => void;
  setGlobalError: (error: AppError | null) => void;
}

/**
 * Global UI state: theme, sidebar, DB readiness, and the global error banner.
 * The product is dark-first, so `dark` is the default rather than `system`.
 */
export const useAppStore = create<AppState>((set) => ({
  theme: 'dark',
  sidebarOpen: true,
  dbReady: false,
  globalError: null,
  setTheme: (theme) => {
    set({ theme });
  },
  toggleSidebar: () => {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }));
  },
  setDbReady: (dbReady) => {
    set({ dbReady });
  },
  setGlobalError: (globalError) => {
    set({ globalError });
  },
}));
