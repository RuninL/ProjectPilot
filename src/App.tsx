import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { getDb, takeDatabaseRecoveryNotice } from '@/lib/db';
import { toAppError } from '@/lib/errors';
import { applyTheme, subscribeToSystemTheme } from '@/lib/theme';
import {
  activeThemeProfile,
  loadThemeProfileBundle,
} from '@/features/settings/services/themeProfile.service';
import { applyThemeProfile, normalizeThemeProfile } from '@/features/settings/theme/themeProfile';
import { router } from '@/router';
import {
  ensureSampleDataSeeded,
  skipSampleDataForMigrationRecovery,
} from '@/services/sampleData.service';
import { loadThemePreference } from '@/features/settings/services/settingsPreference.service';
import { useAppStore } from '@/stores/useAppStore';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emit, listen } from '@tauri-apps/api/event';
import { DesktopWidgetApp } from '@/features/widget/DesktopWidgetApp';
import { WidgetErrorBoundary } from '@/features/widget/WidgetErrorBoundary';
import { addDays, todayHK } from '@/lib/date';
import {
  loadReminderSettings,
  saveReminderSettings,
} from '@/features/settings/services/reminderSettings.service';
import { createReminderCoordinator } from '@/services/reminderCoordinator';
import { scanAndNotifyReminders } from '@/services/reminderRuntime.service';
import { loadDesktopWorkspaceSettings } from '@/features/settings/services/desktopWorkspaceSettings.service';
import { setMainCloseBehavior } from '@/lib/commands';

/**
 * Initialize the database (runs migration 0001 + the foreign-keys assertion)
 * before rendering the app. A failed init blocks the UI, per architecture §8.
 * First-launch sample seeding runs after init but is non-fatal: a seed failure
 * surfaces as the global error banner instead of blocking the app.
 */
export function App() {
  const theme = useAppStore((state) => state.theme);
  const dbReady = useAppStore((state) => state.dbReady);
  const setDbReady = useAppStore((state) => state.setDbReady);
  const setTheme = useAppStore((state) => state.setTheme);
  const setGlobalError = useAppStore((state) => state.setGlobalError);
  const [error, setError] = useState<string | null>(null);
  const [startupRecoveryNotice, setStartupRecoveryNotice] = useState<string | null>(null);

  useEffect(() => {
    const syncTheme = () => {
      applyTheme(theme);
      if (getCurrentWebviewWindow().label === 'main') {
        void emit('projectpilot:theme-changed', theme);
      }
    };
    syncTheme();
    return subscribeToSystemTheme(() => {
      syncTheme();
    });
  }, [theme]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      let recoveredDatabase = false;
      try {
        await getDb();
        const recoveryNotice = takeDatabaseRecoveryNotice();
        if (recoveryNotice !== null && !controller.signal.aborted) {
          setStartupRecoveryNotice(recoveryNotice);
        }
        recoveredDatabase = recoveryNotice !== null;
        const savedTheme = await loadThemePreference();
        if (savedTheme !== null && !controller.signal.aborted) {
          setTheme(savedTheme);
        }
        const profile = activeThemeProfile(await loadThemeProfileBundle());
        if (profile !== null && !controller.signal.aborted) {
          setTheme(profile.baseTheme);
          applyThemeProfile(profile);
        }
        if (getCurrentWebviewWindow().label === 'main') {
          // Legacy workspace settings only decide the main-close behaviour.
          // The old widget/WorkerW mode is never auto-started: WorkerW's
          // entry points and runtime path are fully disabled this round.
          const workspace = await loadDesktopWorkspaceSettings();
          await setMainCloseBehavior(workspace.mainCloseBehavior === 'exit');
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(toAppError(caught).message);
        }
        return;
      }
      // Seeding is awaited before the app renders so the Dashboard cannot read
      // the database mid-seed, but a seed failure must not block startup. The
      // shared promise is what keeps StrictMode's second mount from seeding a
      // duplicate — abort only gates the state updates below. The desktop
      // widget webview never seeds: bootstrap (sample data, reminder
      // scheduler, workspace settings) belongs to the main window only.
      if (getCurrentWebviewWindow().label === 'main') {
        try {
          if (recoveredDatabase) {
            await skipSampleDataForMigrationRecovery();
          } else {
            await ensureSampleDataSeeded();
          }
        } catch (caught) {
          if (!controller.signal.aborted) {
            setGlobalError(toAppError(caught));
          }
        }
      }
      if (!controller.signal.aborted) {
        setDbReady(true);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [setDbReady, setGlobalError, setTheme]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<unknown>('projectpilot:theme-profile-changed', (event) => {
      try {
        const profile = normalizeThemeProfile(event.payload);
        setTheme(profile.baseTheme);
        applyThemeProfile(profile);
      } catch {
        applyThemeProfile(null);
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, [setTheme]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<string>('projectpilot:tray-command', (event) => {
      if (event.payload === 'settings') {
        void router.navigate('/settings');
        return;
      }
      if (
        event.payload !== 'pause' &&
        event.payload !== 'pause-hour' &&
        event.payload !== 'pause-tomorrow'
      )
        return;
      void loadReminderSettings().then((settings) => {
        const pausedUntil =
          event.payload === 'pause'
            ? settings.pausedUntil
            : event.payload === 'pause-hour'
              ? new Date(Date.now() + 3_600_000).toISOString()
              : `${addDays(todayHK(), 1)}T00:00:00+08:00`;
        return saveReminderSettings({
          ...settings,
          enabled: event.payload === 'pause' ? false : settings.enabled,
          pausedUntil,
        });
      });
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<{ target?: string }>('projectpilot:navigate', (event) => {
      const target = event.payload.target;
      if (target === 'dashboard') void router.navigate('/');
      else if (
        typeof target === 'string' &&
        (/^\/tasks\/[a-zA-Z0-9-]+$/.test(target) ||
          /^\/meetings\/[a-zA-Z0-9-]+$/.test(target) ||
          target === '/settings')
      ) {
        void router.navigate(target);
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!dbReady || getCurrentWebviewWindow().label !== 'main') return;
    const coordinator = createReminderCoordinator({ scan: () => scanAndNotifyReminders() });
    coordinator.start();
    return () => {
      coordinator.stop();
    };
  }, [dbReady]);

  if (error !== null) {
    return <ErrorState title="数据库初始化失败" message={error} />;
  }
  if (!dbReady) {
    return <LoadingState label="正在初始化数据库…" />;
  }
  return getCurrentWebviewWindow().label === 'desktop-widget' ? (
    <WidgetErrorBoundary>
      <DesktopWidgetApp />
    </WidgetErrorBoundary>
  ) : (
    <>
      {startupRecoveryNotice !== null && (
        <div
          className="border-b border-amber-500/40 bg-amber-100 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
          role="alert"
        >
          <strong>数据库已安全恢复：</strong> {startupRecoveryNotice}
        </div>
      )}
      <RouterProvider router={router} />
    </>
  );
}
