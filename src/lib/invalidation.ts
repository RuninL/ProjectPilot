import { emit, listen } from '@tauri-apps/api/event';

export type InvalidationArea = 'tasks' | 'meetings' | 'projects' | 'milestones' | 'recurrence';
const EVENT = 'projectpilot:invalidate';

export function emitInvalidation(areas: readonly InvalidationArea[]): Promise<void> {
  return emit(EVENT, { areas: [...new Set(areas)] });
}

export function listenForInvalidation(
  listener: (areas: readonly InvalidationArea[]) => void,
): Promise<() => void> {
  return listen<{ areas?: unknown }>(EVENT, (event) => {
    const areas = Array.isArray(event.payload.areas)
      ? event.payload.areas.filter(
          (area): area is InvalidationArea =>
            typeof area === 'string' &&
            ['tasks', 'meetings', 'projects', 'milestones', 'recurrence'].includes(area),
        )
      : [];
    listener(areas);
  });
}
