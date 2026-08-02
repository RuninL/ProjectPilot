import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));

import { listenForDesktopWidgetState } from '@/features/settings/services/desktopWidgetEvents.service';

describe('listenForDesktopWidgetState', () => {
  it('converts a synchronous Tauri bridge throw into a rejected promise', async () => {
    mocks.listen.mockImplementation(() => {
      throw new Error('bridge unavailable');
    });
    await expect(listenForDesktopWidgetState(() => undefined)).rejects.toThrow(
      'bridge unavailable',
    );
  });

  it('propagates a rejected subscription', async () => {
    mocks.listen.mockRejectedValue(new Error('subscription rejected'));
    await expect(listenForDesktopWidgetState(() => undefined)).rejects.toThrow(
      'subscription rejected',
    );
  });
});
