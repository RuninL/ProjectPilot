import { describe, expect, it } from 'vitest';
import { centeredScrollLeft, scrollGanttToFocus } from '@/features/gantt/ganttScroll';

describe('gantt today focus geometry', () => {
  it('centers today in the measured viewport', () => {
    expect(centeredScrollLeft(600, 300, 1200)).toBe(450);
  });

  it('clamps before and after the available data instead of showing blank space', () => {
    expect(centeredScrollLeft(-100, 300, 1200)).toBe(0);
    expect(centeredScrollLeft(1400, 300, 1200)).toBe(900);
  });

  it('does not scroll when all timeline content already fits', () => {
    expect(centeredScrollLeft(250, 600, 500)).toBe(0);
  });

  it('uses actual layout measurements and avoids duplicate scroll writes', () => {
    const container = document.createElement('div');
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 1200 },
    });
    container.scrollLeft = 0;

    expect(scrollGanttToFocus(container, 600, 1000)).toBe(true);
    expect(container.scrollLeft).toBe(450);
    expect(scrollGanttToFocus(container, 600, 1000)).toBe(true);
    expect(container.scrollLeft).toBe(450);
  });

  it('waits for a non-zero layout rather than relying on a fixed delay', () => {
    const container = document.createElement('div');
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 0 },
      scrollWidth: { configurable: true, value: 1200 },
    });

    expect(scrollGanttToFocus(container, 600, 1200)).toBe(false);
    expect(container.scrollLeft).toBe(0);
  });
});
