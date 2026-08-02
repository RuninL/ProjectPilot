import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompanionApp } from '@/features/companion/CompanionApp';

const mocks = vi.hoisted(() => ({
  completeCompanionTask: vi.fn<() => Promise<void>>(),
  emitInvalidation: vi.fn<() => Promise<void>>(),
  getCalendarService: vi.fn(),
  createCompanionTask: vi.fn(),
  loadCompanionProjectOptions: vi.fn(),
  loadCompanionToday: vi.fn(),
  loadCompanionWeek: vi.fn(),
  reopenCompanionTask: vi.fn(),
  loadReminderSettings: vi.fn(),
  saveReminderSettings: vi.fn<() => Promise<void>>(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

vi.mock('@tauri-apps/api/dpi', () => ({
  PhysicalPosition: function PhysicalPosition() {
    return {};
  },
  PhysicalSize: function PhysicalSize() {
    return {};
  },
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getByLabel: vi.fn().mockResolvedValue(null) },
}));

vi.mock('@tauri-apps/api/window', () => ({
  availableMonitors: vi.fn().mockResolvedValue([]),
  currentMonitor: vi.fn().mockResolvedValue(null),
  primaryMonitor: vi.fn().mockResolvedValue(null),
  getCurrentWindow: vi.fn(() => ({
    onMoved: vi.fn().mockResolvedValue(() => undefined),
    onResized: vi.fn().mockResolvedValue(() => undefined),
    outerPosition: vi.fn(),
    outerSize: vi.fn(),
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
    setPosition: vi.fn().mockResolvedValue(undefined),
    setSize: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/lib/invalidation', () => ({
  emitInvalidation: mocks.emitInvalidation,
  listenForInvalidation: vi.fn().mockResolvedValue(() => undefined),
}));

vi.mock('@/lib/commands', () => ({
  setDesktopWorkspaceMode: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/theme', () => ({ applyTheme: vi.fn() }));

vi.mock('@/services/calendar.service', () => ({ getCalendarService: mocks.getCalendarService }));

vi.mock('@/services/companion.service', () => ({
  completeCompanionTask: mocks.completeCompanionTask,
  createCompanionTask: mocks.createCompanionTask,
  loadCompanionProjectOptions: mocks.loadCompanionProjectOptions,
  loadCompanionToday: mocks.loadCompanionToday,
  loadCompanionWeek: mocks.loadCompanionWeek,
  reopenCompanionTask: mocks.reopenCompanionTask,
}));

vi.mock('@/features/settings/services/reminderSettings.service', () => ({
  loadReminderSettings: mocks.loadReminderSettings,
  saveReminderSettings: mocks.saveReminderSettings,
}));

vi.mock('@/features/settings/services/desktopWorkspaceSettings.service', () => ({
  DEFAULT_DESKTOP_WORKSPACE_SETTINGS: {
    mode: 'off',
    defaultView: 'today',
    monitorId: null,
    layouts: {},
    scale: 1,
    opacity: 0.92,
    blur: false,
    locked: false,
    clickThrough: false,
    interactionShortcut: 'Ctrl+Alt+I',
    showCompleted: true,
    projectFilter: null,
    showMeetings: true,
    showRecurringMeetings: true,
    launchAtLogin: false,
    showAtLaunch: false,
    mainCloseBehavior: 'hide',
    fullscreenBehavior: 'reduce',
    batteryBehavior: 'reduce',
    workerwFallback: true,
  },
  loadDesktopWorkspaceSettings: vi.fn().mockResolvedValue({
    mode: 'off',
    defaultView: 'today',
    monitorId: null,
    layouts: {},
    scale: 1,
    opacity: 0.92,
    blur: false,
    locked: false,
    clickThrough: false,
    interactionShortcut: 'Ctrl+Alt+I',
    showCompleted: true,
    projectFilter: null,
    showMeetings: true,
    showRecurringMeetings: true,
    launchAtLogin: false,
    showAtLaunch: false,
    mainCloseBehavior: 'hide',
    fullscreenBehavior: 'reduce',
    batteryBehavior: 'reduce',
    workerwFallback: true,
  }),
  saveDesktopWorkspaceSettings: vi.fn().mockResolvedValue(undefined),
}));

describe('CompanionApp', () => {
  beforeEach(() => {
    mocks.completeCompanionTask.mockReset();
    mocks.completeCompanionTask.mockResolvedValue(undefined);
    mocks.emitInvalidation.mockReset();
    mocks.emitInvalidation.mockResolvedValue(undefined);
    mocks.loadCompanionToday.mockReset();
    mocks.loadCompanionToday.mockResolvedValue([
      {
        id: 'task-1',
        kind: 'today-task',
        title: '填写周报',
        subtitle: '示例项目',
        taskId: 'task-1',
      },
    ]);
    mocks.loadCompanionProjectOptions.mockReset();
    mocks.loadCompanionProjectOptions.mockResolvedValue([]);
    mocks.loadCompanionWeek.mockReset();
    mocks.loadCompanionWeek.mockResolvedValue([]);
    mocks.createCompanionTask.mockReset();
    mocks.createCompanionTask.mockResolvedValue('task-new');
    mocks.loadReminderSettings.mockReset();
    mocks.loadReminderSettings.mockResolvedValue({
      companionAlwaysOnTop: false,
      companionGeometry: null,
      companionView: 'today',
      companionShowCompleted: true,
    });
    mocks.saveReminderSettings.mockReset();
    mocks.saveReminderSettings.mockResolvedValue(undefined);
    mocks.getCalendarService.mockReset();
  });

  it('requires confirmation before completing a task', async () => {
    const user = userEvent.setup();
    render(<CompanionApp />);

    await user.click(await screen.findByRole('button', { name: '完成' }));

    expect(screen.getByRole('heading', { name: '确认完成任务' })).toBeInTheDocument();
    expect(mocks.completeCompanionTask).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '确认完成' }));

    await waitFor(() => {
      expect(mocks.completeCompanionTask).toHaveBeenCalledWith('task-1');
    });
  });

  it('shows the shared seven-day calendar entries', async () => {
    mocks.loadCompanionWeek.mockResolvedValue([
      {
        date: '2026-08-02',
        entries: [
          {
            key: 'meeting:meeting-1',
            kind: 'meeting',
            sourceId: 'meeting-1',
            date: '2026-08-02',
            title: '周会',
            kindLabel: '会议',
            detail: '09:00',
            href: '/meetings/meeting-1',
            color: null,
            recurrence: null,
          },
        ],
      },
    ]);
    const user = userEvent.setup();
    render(<CompanionApp />);

    await user.click(screen.getByRole('tab', { name: '七天' }));
    expect(await screen.findByText('周会')).toBeInTheDocument();
    expect(mocks.loadCompanionWeek).toHaveBeenCalledTimes(1);
  });

  it('creates a quick task through the task service facade and keeps necessary fields', async () => {
    mocks.loadCompanionProjectOptions.mockResolvedValue([{ id: 'project-1', name: '项目一' }]);
    const user = userEvent.setup();
    render(<CompanionApp />);

    await user.click(screen.getByRole('button', { name: '快速新建任务' }));
    await user.type(screen.getByLabelText('名称'), '桌面任务');
    await user.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(mocks.createCompanionTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '桌面任务',
          projectId: 'project-1',
          priority: 'medium',
        }),
      );
    });
    expect(mocks.emitInvalidation).toHaveBeenCalledWith(['tasks']);
  });
});
