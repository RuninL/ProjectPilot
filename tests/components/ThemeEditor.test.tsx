import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeEditor } from '@/features/settings/components/ThemeEditor';

const { saveBundle, emit } = vi.hoisted(() => ({
  saveBundle: vi.fn(),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({ emit }));
vi.mock('@/features/settings/services/themeProfile.service', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/features/settings/services/themeProfile.service')>();
  return {
    ...original,
    loadThemeProfileBundle: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      selectedProfileId: null,
      profiles: [],
    }),
    saveThemeProfileBundle: saveBundle,
  };
});

describe('ThemeEditor', () => {
  beforeEach(() => {
    saveBundle.mockReset().mockResolvedValue(undefined);
    emit.mockClear();
  });

  it('keeps edits as a cancellable draft', async () => {
    const user = userEvent.setup();
    render(<ThemeEditor theme="dark" onThemeChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '新建自定义主题' }));
    const name = screen.getByLabelText('主题名称');
    await user.clear(name);
    await user.type(name, '未保存草稿');
    expect(screen.getByText('实时预览')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByDisplayValue('未保存草稿')).not.toBeInTheDocument();
    expect(saveBundle).not.toHaveBeenCalled();
  });

  it('saves and applies a valid profile only after explicit action', async () => {
    const user = userEvent.setup();
    const onThemeChange = vi.fn();
    render(<ThemeEditor theme="dark" onThemeChange={onThemeChange} />);

    await user.click(screen.getByRole('button', { name: '新建自定义主题' }));
    await user.click(screen.getByRole('button', { name: '保存并应用' }));

    await waitFor(() => {
      expect(saveBundle).toHaveBeenCalledTimes(1);
    });
    expect(onThemeChange).toHaveBeenCalledWith('dark');
    expect(emit).toHaveBeenCalledWith(
      'projectpilot:theme-profile-changed',
      expect.objectContaining({ name: '我的自定义主题' }),
    );
  });

  it('provides accessible text labels alongside color inputs and contrast results', async () => {
    const user = userEvent.setup();
    render(<ThemeEditor theme="light" onThemeChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '新建自定义主题' }));

    expect(screen.getByLabelText('应用背景十六进制')).toHaveValue('#ffffff');
    expect(screen.getByText(/正文 \/ 应用背景：/)).toHaveTextContent('良好');
    expect(screen.getByRole('group', { name: '六色顺序预览' })).toBeInTheDocument();
  });
});
