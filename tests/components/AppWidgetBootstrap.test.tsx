import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/App';
import { useAppStore } from '@/stores/useAppStore';

/**
 * Regression tests for the desktop-widget global-loading incident: the second
 * (widget) webview must never re-run the main window's bootstrap — sample-data
 * seeding, the reminder scheduler or the close-behaviour sync — and the main
 * window's bootstrap must never depend on widget state.
 */
const mocks = vi.hoisted(() => ({
  label: { value: 'main' },
  getDb: vi.fn().mockResolvedValue({}),
  ensureSampleDataSeeded: vi.fn().mockResolvedValue(true),
  skipSampleDataForMigrationRecovery: vi.fn().mockResolvedValue(undefined),
  loadThemePreference: vi.fn().mockResolvedValue(null),
  loadThemeProfileBundle: vi.fn().mockResolvedValue({ activeId: null, profiles: [] }),
  loadDesktopWorkspaceSettings: vi.fn().mockResolvedValue({ mainCloseBehavior: 'minimize' }),
  setMainCloseBehavior: vi.fn().mockResolvedValue(undefined),
  createReminderCoordinator: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  listen: vi.fn().mockResolvedValue(() => undefined),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: mocks.label.value }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen, emit: mocks.emit }));
vi.mock('@/lib/db', () => ({
  getDb: mocks.getDb,
  takeDatabaseRecoveryNotice: () => null,
}));
vi.mock('@/services/sampleData.service', () => ({
  ensureSampleDataSeeded: mocks.ensureSampleDataSeeded,
  skipSampleDataForMigrationRecovery: mocks.skipSampleDataForMigrationRecovery,
}));
vi.mock('@/features/settings/services/settingsPreference.service', () => ({
  loadThemePreference: mocks.loadThemePreference,
}));
vi.mock('@/features/settings/services/themeProfile.service', () => ({
  activeThemeProfile: () => null,
  loadThemeProfileBundle: mocks.loadThemeProfileBundle,
}));
vi.mock('@/features/settings/services/desktopWorkspaceSettings.service', () => ({
  loadDesktopWorkspaceSettings: mocks.loadDesktopWorkspaceSettings,
}));
vi.mock('@/lib/commands', () => ({
  setMainCloseBehavior: mocks.setMainCloseBehavior,
}));
vi.mock('@/services/reminderCoordinator', () => ({
  createReminderCoordinator: mocks.createReminderCoordinator,
}));
vi.mock('@/services/reminderRuntime.service', () => ({
  scanAndNotifyReminders: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/settings/services/reminderSettings.service', () => ({
  loadReminderSettings: vi.fn().mockResolvedValue({ enabled: true, pausedUntil: null }),
  saveReminderSettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/router', () => ({ router: { navigate: vi.fn() } }));
vi.mock('react-router-dom', () => ({
  RouterProvider: () => <div data-testid="main-router" />,
}));
vi.mock('@/features/widget/DesktopWidgetApp', () => ({
  DesktopWidgetApp: () => <div data-testid="widget-app" />,
}));
vi.mock('@/features/widget/WidgetErrorBoundary', () => ({
  WidgetErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('App bootstrap per webview window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ dbReady: false, globalError: null, theme: 'dark' });
  });

  it('主窗口执行完整 bootstrap：种子数据、关闭行为与提醒调度器', async () => {
    mocks.label.value = 'main';
    render(<App />);
    expect(await screen.findByTestId('main-router')).toBeInTheDocument();
    expect(mocks.ensureSampleDataSeeded).toHaveBeenCalledTimes(1);
    expect(mocks.setMainCloseBehavior).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(mocks.createReminderCoordinator).toHaveBeenCalledTimes(1);
    });
  });

  it('桌面小窗 WebView 不重复执行 bootstrap（种子数据 / 调度器 / 关闭行为）', async () => {
    mocks.label.value = 'desktop-widget';
    render(<App />);
    expect(await screen.findByTestId('widget-app')).toBeInTheDocument();
    expect(mocks.ensureSampleDataSeeded).not.toHaveBeenCalled();
    expect(mocks.skipSampleDataForMigrationRecovery).not.toHaveBeenCalled();
    expect(mocks.setMainCloseBehavior).not.toHaveBeenCalled();
    expect(mocks.loadDesktopWorkspaceSettings).not.toHaveBeenCalled();
    expect(mocks.createReminderCoordinator).not.toHaveBeenCalled();
  });

  it('小窗数据库初始化失败只影响小窗自身，不触发主窗口引导', async () => {
    mocks.label.value = 'desktop-widget';
    mocks.getDb.mockRejectedValueOnce(new Error('widget db failed'));
    render(<App />);
    expect(await screen.findByText('数据库初始化失败')).toBeInTheDocument();
    expect(mocks.ensureSampleDataSeeded).not.toHaveBeenCalled();
  });
});
