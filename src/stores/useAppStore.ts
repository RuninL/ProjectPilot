import { create } from 'zustand';
import type { AppError } from '@/lib/errors';

export type Theme = 'light' | 'dark' | 'system';

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

/** Global UI state: theme, sidebar, DB readiness, and the global error banner. */
export const useAppStore = create<AppState>((set) => ({
  theme: 'system',
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
