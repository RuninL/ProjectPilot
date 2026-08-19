import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { navigateFromDesktopWidget } from '@/lib/commands';
import { AppError } from '@/lib/errors';
import { getTaskService } from '@/services/task.service';

const TASK_ID_PATTERN = /^[A-Za-z0-9-]+$/;

export interface TaskNavigationWindow {
  readonly label: string;
  isMinimized: () => Promise<boolean>;
  unminimize: () => Promise<void>;
  show: () => Promise<void>;
  setFocus: () => Promise<void>;
}

export interface TaskNavigationDeps {
  requireTask: (taskId: string) => Promise<void>;
  currentWindow: () => TaskNavigationWindow;
  navigateMain: (target: string) => Promise<void>;
  navigateFromSecondary: (target: string) => Promise<void>;
}

export function taskDetailPath(taskId: string): string {
  if (!TASK_ID_PATTERN.test(taskId)) {
    throw new AppError('validation', '任务标识无效，无法打开任务详情');
  }
  return `/tasks/${encodeURIComponent(taskId)}`;
}

/**
 * One task-detail navigation protocol for dashboard links and the desktop
 * widget. It validates the persisted id, verifies the target exists, restores
 * the existing main window, and then performs exactly one router navigation.
 */
export function createTaskNavigator(deps: TaskNavigationDeps) {
  return async (taskId: string): Promise<void> => {
    const target = taskDetailPath(taskId);
    await deps.requireTask(taskId);

    const current = deps.currentWindow();
    if (current.label !== 'main') {
      await deps.navigateFromSecondary(target);
      return;
    }

    if (await current.isMinimized()) {
      await current.unminimize();
    }
    await current.show();
    await current.setFocus();
    await deps.navigateMain(target);
  };
}

const openTaskWithDefaults = createTaskNavigator({
  requireTask: async (taskId) => {
    await (await getTaskService()).getTask(taskId);
  },
  currentWindow: getCurrentWebviewWindow,
  navigateMain: async (target) => {
    // Lazy import avoids a router -> DashboardPage -> taskNavigation cycle.
    const { router } = await import('@/router');
    await router.navigate(target);
  },
  navigateFromSecondary: navigateFromDesktopWidget,
});

export async function openTask(taskId: string): Promise<void> {
  await openTaskWithDefaults(taskId);
}
