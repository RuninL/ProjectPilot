import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GanttChart } from '@/features/gantt/components/GanttChart';
import { buildGanttViewModel } from '@/features/gantt/ganttViewModel';
import type { GanttScale } from '@/stores/useGanttStore';
import { makeTask } from '../helpers/fixtures';

let viewportWidth = 320;
let timelineWidth = 0;
let resizeCallback: ResizeObserverCallback | null = null;
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const originalScrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');

function model(scale: GanttScale) {
  return buildGanttViewModel({
    tasks: [
      makeTask({
        id: 'task-a',
        start_date: '2026-01-01',
        due_date: '2026-12-31',
      }),
    ],
    dependencies: [],
    conflicts: [],
    blockedRisks: [],
    scale,
    today: '2026-08-19',
  });
}

beforeEach(() => {
  viewportWidth = 320;
  timelineWidth = 0;
  resizeCallback = null;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return this.getAttribute('aria-label') === '可横向滚动的甘特图时间轴' ? viewportWidth : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get() {
      return this.getAttribute('aria-label') === '可横向滚动的甘特图时间轴' ? timelineWidth : 0;
    },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }

      observe(): void {}

      unobserve(): void {}

      disconnect(): void {}
    },
  );
});

afterEach(() => {
  if (originalClientWidth === undefined) {
    Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  } else {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
  }
  if (originalScrollWidth === undefined) {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth');
  } else {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', originalScrollWidth);
  }
  vi.unstubAllGlobals();
});

describe('GanttChart today focus', () => {
  it.each(['week', 'month', 'quarter'] as const)(
    'centers today after the %s timeline is laid out',
    (scale) => {
      const viewModel = model(scale);
      timelineWidth = viewModel.width;
      render(
        <GanttChart
          model={viewModel}
          selectedTaskId={null}
          onSelectTask={vi.fn()}
          onSelectMilestone={vi.fn()}
        />,
      );

      const timeline = screen.getByLabelText('可横向滚动的甘特图时间轴');
      const maximum = Math.max(viewModel.width - viewportWidth, 0);
      const expected = Math.min(Math.max(viewModel.focusX - viewportWidth / 2, 0), maximum);
      expect(timeline.scrollLeft).toBeCloseTo(expected);
    },
  );

  it('does not force-scroll again when unrelated filters rerender the same range', () => {
    const viewModel = model('week');
    timelineWidth = viewModel.width;
    const rendered = render(
      <GanttChart
        model={viewModel}
        selectedTaskId={null}
        onSelectTask={vi.fn()}
        onSelectMilestone={vi.fn()}
      />,
    );
    const timeline = screen.getByLabelText('可横向滚动的甘特图时间轴');
    timeline.scrollLeft = 17;

    rendered.rerender(
      <GanttChart
        model={viewModel}
        selectedTaskId="task-a"
        onSelectTask={vi.fn()}
        onSelectMilestone={vi.fn()}
      />,
    );

    expect(timeline.scrollLeft).toBe(17);
  });

  it('recenters from measured geometry when the viewport is resized', () => {
    const viewModel = model('week');
    timelineWidth = viewModel.width;
    render(
      <GanttChart
        model={viewModel}
        selectedTaskId={null}
        onSelectTask={vi.fn()}
        onSelectMilestone={vi.fn()}
      />,
    );
    const timeline = screen.getByLabelText('可横向滚动的甘特图时间轴');
    const todayX = viewModel.todayX;
    if (todayX === null) {
      throw new Error('测试数据应包含今天标记');
    }
    viewportWidth = 500;
    resizeCallback?.([], {} as ResizeObserver);

    expect(timeline.scrollLeft).toBeCloseTo(viewModel.focusX - viewportWidth / 2);
    expect(screen.getByText('今天')).toHaveAttribute('x', String(todayX + 3));
  });
});
