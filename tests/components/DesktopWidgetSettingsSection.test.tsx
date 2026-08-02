import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DesktopWidgetSettingsSection,
  WIDGET_STATUS_TIMEOUT_MS,
} from '@/features/settings/components/DesktopWidgetSettingsSection';

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn().mockResolvedValue(() => undefined),
  status: vi.fn(),
  open: vi.fn(),
  show: vi.fn().mockResolvedValue(undefined),
  hide: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  setLocked: vi.fn().mockResolvedValue(undefined),
  setClickThrough: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/features/settings/services/desktopWidgetEvents.service', () => ({
  listenForDesktopWidgetState: mocks.subscribe,
}));
vi.mock('@/lib/commands', () => ({
  desktopWidgetStatus: mocks.status,
  openDesktopWidget: mocks.open,
  showDesktopWidget: mocks.show,
  hideDesktopWidget: mocks.hide,
  closeDesktopWidget: mocks.close,
  setDesktopWidgetLocked: mocks.setLocked,
  setDesktopWidgetClickThrough: mocks.setClickThrough,
}));

function statusOf(overrides: Partial<Record<string, boolean>> = {}) {
  return {
    exists: false,
    visible: false,
    locked: false,
    click_through: false,
    ...overrides,
  };
}

describe('DesktopWidgetSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscribe.mockResolvedValue(() => undefined);
  });

  it('未运行时只提供“打开桌面小窗”，没有模式选择器和 WorkerW', async () => {
    mocks.status.mockResolvedValue(statusOf());
    render(<DesktopWidgetSettingsSection />);
    expect(await screen.findByRole('button', { name: '打开桌面小窗' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('未运行');
    expect(screen.queryByText(/WorkerW/)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText(/月历/)).not.toBeInTheDocument();
  });

  it('打开时显示 loading 并防止重复点击', async () => {
    mocks.status.mockResolvedValue(statusOf());
    let resolveOpen: () => void = () => undefined;
    mocks.open.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<DesktopWidgetSettingsSection />);
    const openButton = await screen.findByRole('button', { name: '打开桌面小窗' });
    await user.click(openButton);
    const loading = await screen.findByRole('button', { name: '正在打开…' });
    expect(loading).toBeDisabled();
    await user.click(loading);
    expect(mocks.open).toHaveBeenCalledTimes(1);
    mocks.status.mockResolvedValue(statusOf({ exists: true, visible: true }));
    resolveOpen();
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('正在显示');
    });
  });

  it('可见状态提供隐藏、关闭、锁定和点击穿透', async () => {
    mocks.status.mockResolvedValue(statusOf({ exists: true, visible: true }));
    render(<DesktopWidgetSettingsSection />);
    expect(await screen.findByRole('button', { name: '隐藏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '锁定位置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开启点击穿透' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开桌面小窗' })).not.toBeInTheDocument();
  });

  it('隐藏状态只提供显示和关闭', async () => {
    mocks.status.mockResolvedValue(statusOf({ exists: true, visible: false }));
    render(<DesktopWidgetSettingsSection />);
    expect(await screen.findByRole('button', { name: '显示' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('已隐藏');
    expect(screen.queryByRole('button', { name: '锁定位置' })).not.toBeInTheDocument();
  });

  it('隐藏走 hide、关闭走 destroy（两条不同命令）', async () => {
    mocks.status.mockResolvedValue(statusOf({ exists: true, visible: true }));
    const user = userEvent.setup();
    render(<DesktopWidgetSettingsSection />);
    await user.click(await screen.findByRole('button', { name: '隐藏' }));
    expect(mocks.hide).toHaveBeenCalledTimes(1);
    expect(mocks.close).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('失败时显示中文错误、重试和复制诊断信息', async () => {
    mocks.status.mockResolvedValue(statusOf());
    mocks.open.mockRejectedValue(new Error('无法创建桌面小窗：测试失败'));
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<DesktopWidgetSettingsSection />);
    await user.click(await screen.findByRole('button', { name: '打开桌面小窗' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('无法创建桌面小窗：测试失败');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '复制诊断信息' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(writeText.mock.calls[0]?.[0]).toContain('无法创建桌面小窗');
    // Retry re-invokes the open command.
    mocks.open.mockResolvedValue(undefined);
    mocks.status.mockResolvedValue(statusOf({ exists: true, visible: true }));
    await user.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('正在显示');
    });
  });

  it('状态查询永久挂起时超时报错，不再永久“正在读取状态…”，重新读取可恢复', async () => {
    vi.useFakeTimers();
    mocks.status.mockImplementation(() => new Promise(() => undefined));
    render(<DesktopWidgetSettingsSection />);
    expect(screen.getByRole('status')).toHaveTextContent('正在读取状态…');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WIDGET_STATUS_TIMEOUT_MS + 1);
    });
    vi.useRealTimers();
    expect(screen.getByRole('status')).toHaveTextContent('状态读取失败');
    expect(screen.getByRole('alert')).toHaveTextContent('读取桌面小窗状态超时');
    // Recovery: the command answers again and one click restores the state.
    mocks.status.mockResolvedValue(statusOf({ exists: true, visible: true }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '重新读取' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('正在显示');
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('运行状态来自真实窗口事件而非持久化标记', async () => {
    mocks.status.mockResolvedValue(statusOf({ exists: true, visible: true }));
    const handlers: ((event: { payload: unknown }) => void)[] = [];
    mocks.subscribe.mockImplementation((callback: (e: { payload: unknown }) => void) => {
      handlers.push(callback);
      return Promise.resolve(() => undefined);
    });
    render(<DesktopWidgetSettingsSection />);
    await screen.findByRole('button', { name: '隐藏' });
    act(() => {
      handlers[0]?.({ payload: statusOf({ exists: false }) });
    });
    expect(await screen.findByRole('button', { name: '打开桌面小窗' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('未运行');
  });

  it('订阅失败时显示可处理错误而非产生未处理拒绝', async () => {
    mocks.status.mockResolvedValue(statusOf());
    mocks.subscribe.mockRejectedValue(new Error('事件桥不可用'));
    render(<DesktopWidgetSettingsSection />);
    expect(await screen.findByRole('alert')).toHaveTextContent('事件桥不可用');
  });

  it('卸载后延迟订阅成功会立刻清理', async () => {
    mocks.status.mockResolvedValue(statusOf());
    let resolve: (unlisten: () => void) => void = () => undefined;
    const unlisten = vi.fn();
    mocks.subscribe.mockReturnValue(
      new Promise<() => void>((next) => {
        resolve = next;
      }),
    );
    const view = render(<DesktopWidgetSettingsSection />);
    view.unmount();
    resolve(unlisten);
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
