import { listen, type Event, type UnlistenFn } from '@tauri-apps/api/event';
import type { DesktopWidgetStatus } from '@/lib/commands';

const WIDGET_STATE_EVENT = 'projectpilot:desktop-widget-state';

/**
 * Isolates the Tauri event bridge from React so unavailable runtime APIs can be
 * reported to the settings UI instead of becoming an unhandled rejection.
 */
export async function listenForDesktopWidgetState(
  handler: (event: Event<DesktopWidgetStatus>) => void,
): Promise<UnlistenFn> {
  try {
    return await Promise.resolve().then(() => listen<DesktopWidgetStatus>(WIDGET_STATE_EVENT, handler));
  } catch (error) {
    console.error('Unable to subscribe to desktop widget state.', error);
    throw error;
  }
}
