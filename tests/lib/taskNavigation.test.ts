import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import {
  createTaskNavigator,
  taskDetailPath,
  type TaskNavigationDeps,
  type TaskNavigationWindow,
} from '@/lib/taskNavigation';

function setup(options?: { label?: string; minimized?: boolean; missing?: boolean }) {
  const window: TaskNavigationWindow = {
    label: options?.label ?? 'main',
    isMinimized: vi.fn().mockResolvedValue(options?.minimized ?? false),
    unminimize: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
    setFocus: vi.fn().mockResolvedValue(undefined),
  };
  const deps: TaskNavigationDeps = {
    requireTask: vi.fn().mockImplementation(() => {
      if (options?.missing === true) {
        return Promise.reject(new AppError('not_found', '任务不存在或已被删除'));
      }
      return Promise.resolve();
    }),
    currentWindow: vi.fn(() => window),
    navigateMain: vi.fn().mockResolvedValue(undefined),
    navigateFromSecondary: vi.fn().mockResolvedValue(undefined),
  };
  return { window, deps, navigate: createTaskNavigator(deps) };
}

describe('task navigation adapter', () => {
  it('validates the real task id before touching a window', async () => {
    const { deps, navigate } = setup();

    await expect(navigate('')).rejects.toThrow('任务标识无效');

    expect(deps.requireTask).not.toHaveBeenCalled();
    expect(deps.currentWindow).not.toHaveBeenCalled();
    expect(deps.navigateMain).not.toHaveBeenCalled();
  });

  it('reports a missing task without falling back to the task list', async () => {
    const { deps, navigate } = setup({ missing: true });

    await expect(navigate('task-404')).rejects.toThrow('任务不存在或已被删除');

    expect(deps.requireTask).toHaveBeenCalledWith('task-404');
    expect(deps.currentWindow).not.toHaveBeenCalled();
    expect(deps.navigateMain).not.toHaveBeenCalled();
  });

  it('shows and focuses the main window before navigating directly to task detail', async () => {
    const { window, deps, navigate } = setup();

    await navigate('task-a');

    expect(window.show).toHaveBeenCalledOnce();
    expect(window.setFocus).toHaveBeenCalledOnce();
    expect(window.unminimize).not.toHaveBeenCalled();
    expect(deps.navigateMain).toHaveBeenCalledWith('/tasks/task-a');
  });

  it('restores a minimized main window before navigation', async () => {
    const { window, deps, navigate } = setup({ minimized: true });

    await navigate('task-b');

    expect(window.unminimize).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.setFocus).toHaveBeenCalledOnce();
    expect(deps.navigateMain).toHaveBeenCalledWith('/tasks/task-b');
  });

  it('uses the existing secondary-window bridge exactly once', async () => {
    const { window, deps, navigate } = setup({ label: 'desktop-widget' });

    await navigate('task-c');

    expect(deps.navigateFromSecondary).toHaveBeenCalledOnce();
    expect(deps.navigateFromSecondary).toHaveBeenCalledWith('/tasks/task-c');
    expect(deps.navigateMain).not.toHaveBeenCalled();
    expect(window.show).not.toHaveBeenCalled();
  });

  it('opens duplicate titles by their distinct persisted ids', async () => {
    const { deps, navigate } = setup();

    await navigate('duplicate-a');
    await navigate('duplicate-b');

    expect(deps.requireTask).toHaveBeenNthCalledWith(1, 'duplicate-a');
    expect(deps.requireTask).toHaveBeenNthCalledWith(2, 'duplicate-b');
    expect(deps.navigateMain).toHaveBeenNthCalledWith(1, '/tasks/duplicate-a');
    expect(deps.navigateMain).toHaveBeenNthCalledWith(2, '/tasks/duplicate-b');
  });

  it('builds only task-detail paths', () => {
    expect(taskDetailPath('task-1')).toBe('/tasks/task-1');
    expect(() => taskDetailPath('task/1')).toThrow('任务标识无效');
  });
});
