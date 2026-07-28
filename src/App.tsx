import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { getDb } from '@/lib/db';
import { toAppError } from '@/lib/errors';
import { applyTheme, subscribeToSystemTheme } from '@/lib/theme';
import { router } from '@/router';
import { ensureSampleDataSeeded } from '@/services/sampleData.service';
import { useAppStore } from '@/stores/useAppStore';

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
  const setGlobalError = useAppStore((state) => state.setGlobalError);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    applyTheme(theme);
    return subscribeToSystemTheme(() => {
      applyTheme(theme);
    });
  }, [theme]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        await getDb();
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(toAppError(caught).message);
        }
        return;
      }
      // Seeding is awaited before the app renders so the Dashboard cannot read
      // the database mid-seed, but a seed failure must not block startup. The
      // shared promise is what keeps StrictMode's second mount from seeding a
      // duplicate — abort only gates the state updates below.
      try {
        await ensureSampleDataSeeded();
      } catch (caught) {
        if (!controller.signal.aborted) {
          setGlobalError(toAppError(caught));
        }
      }
      if (!controller.signal.aborted) {
        setDbReady(true);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [setDbReady, setGlobalError]);

  if (error !== null) {
    return <ErrorState title="数据库初始化失败" message={error} />;
  }
  if (!dbReady) {
    return <LoadingState label="正在初始化数据库…" />;
  }
  return <RouterProvider router={router} />;
}
