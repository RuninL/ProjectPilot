import { describe, expect, it, vi } from 'vitest';
import { createReminderCoordinator } from '@/services/reminderCoordinator';

describe('reminder coordinator', () => {
  it('creates one low-frequency scheduler and stops it', async () => {
    vi.useFakeTimers();
    const scan = vi.fn<() => Promise<void>>().mockResolvedValue();
    const coordinator = createReminderCoordinator({ scan, intervalMs: 60_000 });
    coordinator.start();
    coordinator.start();
    await vi.runAllTicks();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(coordinator.isRunning()).toBe(true);
    coordinator.stop();
    expect(coordinator.isRunning()).toBe(false);
    vi.useRealTimers();
  });
});
