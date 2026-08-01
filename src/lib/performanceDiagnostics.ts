export type PerformanceEventKind = 'ipc' | 'react' | 'sqlite';

interface PerformanceEvent {
  kind: PerformanceEventKind;
  name: string;
  durationMs: number;
  atMs: number;
}

interface PerformanceSummary {
  kind: PerformanceEventKind;
  name: string;
  count: number;
  totalMs: number;
  maxMs: number;
}

export interface PerformanceSnapshot {
  label: string;
  elapsedMs: number;
  eventCount: number;
  droppedEventCount: number;
  usedJsHeapBytes: number | null;
  summaries: PerformanceSummary[];
}

export interface ProjectPilotPerformanceApi {
  start: (label?: string) => void;
  stop: () => PerformanceSnapshot;
  reset: () => void;
  snapshot: () => PerformanceSnapshot;
}

const MAX_EVENTS = 5_000;
let active = false;
let label = 'manual';
let startedAt = performance.now();
let droppedEventCount = 0;
let events: PerformanceEvent[] = [];

function usedJsHeapBytes(): number | null {
  const measured = performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  };
  return measured.memory?.usedJSHeapSize ?? null;
}

function snapshot(): PerformanceSnapshot {
  const grouped = new Map<string, PerformanceSummary>();
  for (const event of events) {
    const key = `${event.kind}\u0000${event.name}`;
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, {
        kind: event.kind,
        name: event.name,
        count: 1,
        totalMs: event.durationMs,
        maxMs: event.durationMs,
      });
    } else {
      existing.count += 1;
      existing.totalMs += event.durationMs;
      existing.maxMs = Math.max(existing.maxMs, event.durationMs);
    }
  }
  return {
    label,
    elapsedMs: performance.now() - startedAt,
    eventCount: events.length,
    droppedEventCount,
    usedJsHeapBytes: usedJsHeapBytes(),
    summaries: [...grouped.values()].sort(
      (left, right) => right.totalMs - left.totalMs || right.count - left.count,
    ),
  };
}

export const projectPilotPerformance: ProjectPilotPerformanceApi = {
  start(nextLabel = 'manual') {
    label = nextLabel;
    startedAt = performance.now();
    droppedEventCount = 0;
    events = [];
    active = true;
  },
  stop() {
    active = false;
    return snapshot();
  },
  reset() {
    active = false;
    label = 'manual';
    startedAt = performance.now();
    droppedEventCount = 0;
    events = [];
  },
  snapshot,
};

export function recordPerformanceEvent(
  kind: PerformanceEventKind,
  name: string,
  durationMs: number,
): void {
  if (!import.meta.env.DEV || !active) return;
  if (events.length === MAX_EVENTS) {
    events.shift();
    droppedEventCount += 1;
  }
  events.push({ kind, name, durationMs, atMs: performance.now() });
}

declare global {
  interface Window {
    projectPilotPerformance?: ProjectPilotPerformanceApi;
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.projectPilotPerformance = projectPilotPerformance;
}
