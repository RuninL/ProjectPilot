import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopWidgetApp } from '@/features/widget/DesktopWidgetApp';
import type { CompanionTodayItem } from '@/services/companion.service';

const mocks = vi.hoisted(() => ({
  loadCompanionToday: vi.fn(),
  loadWidgetAgenda: vi.fn(),
  buildWidgetAgenda: vi.fn(),
  completeCompanionTask: vi.fn(),
  reopenCompanionTask: vi.fn(),
  emitInvalidation: vi.fn(),
  listenForInvalidation: vi.fn(),
  desktopWidgetStatus: vi.fn(),
  navigateFromDesktopWidget: vi.fn(),
  openTask: vi.fn(),
  loadDesktopWidgetSettings: vi.fn(),
  saveDesktopWidgetSettings: vi.fn(),
  listen: vi.fn(),
  setSize: vi.fn(),
  setPosition: vi.fn(),
  startDragging: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}));

vi.mock('@tauri-apps/api/dpi', () => ({
  PhysicalPosition: class PhysicalPosition {
    constructor(
      readonly x: number,
      readonly y: number,
    ) {}
  },
  PhysicalSize: class PhysicalSize {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}
  },
}));

vi.mock('@tauri-apps/api/window', () => ({
  availableMonitors: vi.fn().mockResolvedValue([]),
  currentMonitor: vi.fn().mockResolvedValue(null),
  primaryMonitor: vi.fn().mockResolvedValue(null),
  getCurrentWindow: () => ({
    startDragging: mocks.startDragging,
    setSize: mocks.setSize,
    setPosition: mocks.setPosition,
    outerPosition: vi.fn().mockResolvedValue({ x: 10, y: 20 }),
    outerSize: vi.fn().mockResolvedValue({ width: 380, height: 540 }),
    onResized: vi.fn().mockResolvedValue(() => undefined),
    onMoved: vi.fn().mockResolvedValue(() => undefined),
  }),
}));

vi.mock('@/lib/commands', () => ({
  desktopWidgetStatus: mocks.desktopWidgetStatus,
  navigateFromDesktopWidget: mocks.navigateFromDesktopWidget,
}));

vi.mock('@/lib/taskNavigation', () => ({
  openTask: mocks.openTask,
}));

vi.mock('@/lib/invalidation', () => ({
  emitInvalidation: mocks.emitInvalidation,
  listenForInvalidation: mocks.listenForInvalidation,
}));

vi.mock('@/services/companion.service', () => ({
  loadCompanionToday: mocks.loadCompanionToday,
  completeCompanionTask: mocks.completeCompanionTask,
  reopenCompanionTask: mocks.reopenCompanionTask,
}));

vi.mock('@/services/widget.service', () => ({
  loadWidgetAgenda: mocks.loadWidgetAgenda,
}));

vi.mock('@/features/widget/widgetModel', async (importActual) => {
  const actual = await importActual<typeof import('@/features/widget/widgetModel')>();
  return { ...actual, buildWidgetAgenda: mocks.buildWidgetAgenda };
});

vi.mock('@/features/settings/services/desktopWidgetSettings.service', async (importActual) => {
  const actual =
    await importActual<
      typeof import('@/features/settings/services/desktopWidgetSettings.service')
    >();
  return {
    ...actual,
    loadDesktopWidgetSettings: mocks.loadDesktopWidgetSettings,
    saveDesktopWidgetSettings: mocks.saveDesktopWidgetSettings,
  };
});

const pending: CompanionTodayItem = {
  id: 'task-1',
  taskId: 'task-1',
  kind: 'today-task',
  title: '待完成任务',
  subtitle: '项目甲',
  completed: false,
};

const completed: CompanionTodayItem = {
  ...pending,
  completed: true,
};

const newer: CompanionTodayItem = {
  ...pending,
  id: 'task-2',
  taskId: 'task-2',
  title: '刷新后的任务',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function renderLoaded() {
  render(<DesktopWidgetApp />);
  await screen.findByText(pending.title);
}

describe('DesktopWidgetApp task confirmation and refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadCompanionToday.mockResolvedValue([pending]);
    mocks.loadWidgetAgenda.mockResolvedValue({ entries: [] });
    mocks.buildWidgetAgenda.mockReturnValue([]);
    mocks.completeCompanionTask.mockResolvedValue(undefined);
    mocks.reopenCompanionTask.mockResolvedValue(undefined);
    mocks.emitInvalidation.mockResolvedValue(undefined);
    mocks.listenForInvalidation.mockResolvedValue(() => undefined);
    mocks.desktopWidgetStatus.mockResolvedValue({
      exists: true,
      visible: true,
      locked: true,
      click_through: true,
    });
    mocks.navigateFromDesktopWidget.mockResolvedValue(undefined);
    mocks.openTask.mockResolvedValue(undefined);
    mocks.loadDesktopWidgetSettings.mockResolvedValue({
      lastView: 'today',
      calendarView: 'today',
      monitorId: null,
      layouts: {},
    });
    mocks.saveDesktopWidgetSettings.mockResolvedValue(undefined);
    mocks.listen.mockResolvedValue(() => undefined);
    mocks.setSize.mockResolvedValue(undefined);
    mocks.setPosition.mockResolvedValue(undefined);
    mocks.startDragging.mockResolvedValue(undefined);
  });

  it('asks before completion and cancelling keeps the task unchanged', async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByRole('checkbox', { name: `完成 ${pending.title}` }));
    expect(screen.getByText('确定将该任务标记为已完成吗？')).toBeInTheDocument();
    expect(mocks.completeCompanionTask).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: `完成 ${pending.title}` })).not.toBeChecked();
    expect(mocks.completeCompanionTask).not.toHaveBeenCalled();
  });

  it('confirms once, then runs the shared full refresh', async () => {
    const user = userEvent.setup();
    const save = deferred<undefined>();
    mocks.completeCompanionTask.mockReturnValueOnce(save.promise);
    mocks.loadCompanionToday.mockResolvedValueOnce([pending]).mockResolvedValue([completed]);
    await renderLoaded();

    await user.click(screen.getByRole('checkbox', { name: `完成 ${pending.title}` }));
    await user.click(screen.getByRole('button', { name: '确认' }));
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(mocks.completeCompanionTask).toHaveBeenCalledTimes(1);

    save.resolve(undefined);
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: `完成 ${pending.title}` })).toBeChecked();
    });
    expect(mocks.emitInvalidation).toHaveBeenCalledWith(['tasks']);
    expect(mocks.loadCompanionToday).toHaveBeenCalledTimes(2);
    expect(mocks.loadWidgetAgenda).toHaveBeenCalledTimes(2);
  });

  it('keeps the original task and reports a save failure', async () => {
    const user = userEvent.setup();
    mocks.completeCompanionTask.mockRejectedValueOnce(new Error('数据库写入失败'));
    await renderLoaded();

    await user.click(screen.getByRole('checkbox', { name: `完成 ${pending.title}` }));
    await user.click(screen.getByRole('button', { name: '确认' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('更新任务失败：数据库写入失败');
    expect(screen.getByRole('checkbox', { name: `完成 ${pending.title}` })).not.toBeChecked();
    expect(mocks.loadCompanionToday).toHaveBeenCalledTimes(1);
  });

  it('refreshes tasks and calendar in place without changing window state', async () => {
    const user = userEvent.setup();
    mocks.loadCompanionToday.mockResolvedValueOnce([pending]).mockResolvedValueOnce([newer]);
    await renderLoaded();
    await waitFor(() => {
      expect(screen.getByText('ProjectPilot 小窗 · 已锁定')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: '刷新' }));

    expect(await screen.findByText(newer.title)).toBeInTheDocument();
    expect(screen.queryByText(pending.title)).not.toBeInTheDocument();
    expect(mocks.loadWidgetAgenda).toHaveBeenCalledTimes(2);
    expect(mocks.desktopWidgetStatus).toHaveBeenCalledTimes(1);
    expect(mocks.navigateFromDesktopWidget).not.toHaveBeenCalled();
    expect(mocks.setSize).not.toHaveBeenCalled();
    expect(mocks.setPosition).not.toHaveBeenCalled();
  });

  it('keeps old data and reports an understandable refresh failure', async () => {
    const user = userEvent.setup();
    mocks.loadCompanionToday
      .mockResolvedValueOnce([pending])
      .mockRejectedValueOnce(new Error('读取失败'));
    await renderLoaded();

    await user.click(screen.getByRole('button', { name: '刷新' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('刷新桌面小窗失败：读取失败');
    expect(screen.getByText(pending.title)).toBeInTheDocument();
  });

  it('opens a task through the shared task navigation adapter', async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByRole('button', { name: /待完成任务/ }));

    expect(mocks.openTask).toHaveBeenCalledWith('task-1');
    expect(mocks.navigateFromDesktopWidget).not.toHaveBeenCalled();
  });

  it('does not start concurrent refreshes on repeated clicks', async () => {
    const user = userEvent.setup();
    const taskRefresh = deferred<CompanionTodayItem[]>();
    const agendaRefresh = deferred<{ entries: never[] }>();
    await renderLoaded();
    mocks.loadCompanionToday.mockReturnValueOnce(taskRefresh.promise);
    mocks.loadWidgetAgenda.mockReturnValueOnce(agendaRefresh.promise);

    const refresh = screen.getByRole('button', { name: '刷新' });
    await user.click(refresh);
    await user.click(refresh);
    expect(refresh).toBeDisabled();
    expect(mocks.loadCompanionToday).toHaveBeenCalledTimes(2);
    expect(mocks.loadWidgetAgenda).toHaveBeenCalledTimes(2);

    taskRefresh.resolve([newer]);
    agendaRefresh.resolve({ entries: [] });
    await screen.findByText(newer.title);
  });
});
