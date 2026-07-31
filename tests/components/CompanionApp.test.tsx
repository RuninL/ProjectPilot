import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompanionApp } from '@/features/companion/CompanionApp';

const mocks = vi.hoisted(() => ({
  completeCompanionTask: vi.fn<() => Promise<void>>(),
  emitInvalidation: vi.fn<() => Promise<void>>(),
  getCalendarService: vi.fn(),
  loadCompanionToday: vi.fn(),
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
  currentMonitor: vi.fn().mockResolvedValue(null),
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

vi.mock('@/lib/theme', () => ({ applyTheme: vi.fn() }));

vi.mock('@/services/calendar.service', () => ({ getCalendarService: mocks.getCalendarService }));

vi.mock('@/services/companion.service', () => ({
  completeCompanionTask: mocks.completeCompanionTask,
  loadCompanionToday: mocks.loadCompanionToday,
}));

vi.mock('@/features/settings/services/reminderSettings.service', () => ({
  loadReminderSettings: mocks.loadReminderSettings,
  saveReminderSettings: mocks.saveReminderSettings,
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
    mocks.loadReminderSettings.mockReset();
    mocks.loadReminderSettings.mockResolvedValue({
      companionAlwaysOnTop: false,
      companionGeometry: null,
      companionView: 'today',
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
});
