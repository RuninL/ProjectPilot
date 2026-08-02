import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DesktopWorkspaceSettingsSection } from '@/features/settings/components/DesktopWorkspaceSettingsSection';
import {
  DEFAULT_DESKTOP_WORKSPACE_SETTINGS,
  desktopWorkspaceSettingsSchema,
} from '@/features/settings/services/desktopWorkspaceSettings.service';

const mocks = vi.hoisted(() => ({
  emit: vi.fn().mockResolvedValue(undefined),
  setMode: vi.fn(),
  setLocked: vi.fn().mockResolvedValue(undefined),
  setClickThrough: vi.fn().mockResolvedValue(undefined),
  save: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({ emit: mocks.emit }));
vi.mock('@tauri-apps/api/window', () => ({
  availableMonitors: vi.fn().mockResolvedValue([{ name: 'DISPLAY-1', position: { x: 0, y: 0 } }]),
}));
vi.mock('@/lib/commands', () => ({
  setDesktopWorkspaceMode: mocks.setMode,
  setDesktopWorkspaceLocked: mocks.setLocked,
  setDesktopWorkspaceClickThrough: mocks.setClickThrough,
  setLaunchAtLogin: vi.fn().mockResolvedValue(undefined),
  setMainCloseBehavior: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/settings/services/desktopWorkspaceSettings.service', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('@/features/settings/services/desktopWorkspaceSettings.service')
    >();
  return {
    ...original,
    loadDesktopWorkspaceSettings: vi
      .fn()
      .mockResolvedValue(original.DEFAULT_DESKTOP_WORKSPACE_SETTINGS),
    saveDesktopWorkspaceSettings: mocks.save,
  };
});

describe('DesktopWorkspaceSettingsSection', () => {
  it('defaults to a safe disabled, interactive workspace configuration', () => {
    expect(DEFAULT_DESKTOP_WORKSPACE_SETTINGS).toMatchObject({
      mode: 'off',
      locked: false,
      clickThrough: false,
      workerwFallback: true,
    });
    expect(() =>
      desktopWorkspaceSettingsSchema.parse({
        ...DEFAULT_DESKTOP_WORKSPACE_SETTINGS,
        opacity: 2,
      }),
    ).toThrow();
  });

  it('falls back to the fixed widget when WorkerW attachment fails', async () => {
    mocks.setMode.mockReset();
    mocks.setMode
      .mockRejectedValueOnce(new Error('WorkerW unavailable'))
      .mockResolvedValueOnce(undefined);
    mocks.save.mockClear();
    const user = userEvent.setup();
    render(<DesktopWorkspaceSettingsSection />);

    await user.selectOptions(await screen.findByLabelText('运行模式'), 'workerw');

    await waitFor(() => {
      expect(mocks.setMode).toHaveBeenNthCalledWith(1, 'workerw');
      expect(mocks.setMode).toHaveBeenNthCalledWith(2, 'widget');
      expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ mode: 'widget' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('已回退桌面固定组件');
  });

  it('restores native lock and hit testing with the safe layout', async () => {
    mocks.setMode.mockReset().mockResolvedValue(undefined);
    mocks.setLocked.mockClear();
    mocks.setClickThrough.mockClear();
    const user = userEvent.setup();
    render(<DesktopWorkspaceSettingsSection />);

    await user.click(await screen.findByRole('button', { name: '恢复默认布局与安全交互' }));

    await waitFor(() => {
      expect(mocks.setMode).toHaveBeenCalledWith('widget');
      expect(mocks.setLocked).toHaveBeenCalledWith(false);
      expect(mocks.setClickThrough).toHaveBeenCalledWith(false);
    });
  });
});
