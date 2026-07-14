import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { getDb } from '@/lib/db';
import { toAppError } from '@/lib/errors';
import { router } from '@/router';
import { useAppStore } from '@/stores/useAppStore';

/**
 * Initialize the database (runs migration 0001 + the foreign-keys assertion)
 * before rendering the app. A failed init blocks the UI, per architecture §8.
 */
export function App() {
  const dbReady = useAppStore((state) => state.dbReady);
  const setDbReady = useAppStore((state) => state.setDbReady);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        await getDb();
        if (!controller.signal.aborted) {
          setDbReady(true);
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(toAppError(caught).message);
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, [setDbReady]);

  if (error !== null) {
    return <ErrorState title="数据库初始化失败" message={error} />;
  }
  if (!dbReady) {
    return <LoadingState label="正在初始化数据库…" />;
  }
  return <RouterProvider router={router} />;
}
