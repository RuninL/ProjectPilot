export interface ReminderCoordinatorDeps {
  scan: (reason: 'start' | 'refresh' | 'clock-drift') => Promise<void>;
  intervalMs?: number;
  now?: () => number;
}

/** One process-wide, low-frequency coordinator. UI components only request refreshes. */
export function createReminderCoordinator(deps: ReminderCoordinatorDeps) {
  const now = deps.now ?? Date.now;
  const intervalMs = deps.intervalMs ?? 5 * 60_000;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastNow = 0;
  let running = false;
  let queued = false;

  async function scan(reason: 'start' | 'refresh' | 'clock-drift') {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      await deps.scan(reason);
    } finally {
      running = false;
      if (queued) {
        queued = false;
        void scan('refresh');
      }
    }
  }

  return {
    start() {
      if (timer !== null) return;
      lastNow = now();
      void scan('start');
      timer = setInterval(() => {
        const current = now();
        const drifted = Math.abs(current - lastNow - intervalMs) > intervalMs;
        lastNow = current;
        void scan(drifted ? 'clock-drift' : 'refresh');
      }, intervalMs);
    },
    refresh() {
      void scan('refresh');
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      queued = false;
    },
    isRunning: () => timer !== null,
  };
}
