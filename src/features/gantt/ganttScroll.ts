import { useLayoutEffect, useRef, type RefObject } from 'react';

export function centeredScrollLeft(
  focusX: number,
  viewportWidth: number,
  contentWidth: number,
): number {
  if (viewportWidth <= 0 || contentWidth <= viewportWidth) {
    return 0;
  }
  const boundedFocus = Math.min(Math.max(focusX, 0), contentWidth);
  const maximum = contentWidth - viewportWidth;
  return Math.min(Math.max(boundedFocus - viewportWidth / 2, 0), maximum);
}

export function scrollGanttToFocus(
  container: HTMLElement,
  focusX: number,
  modelWidth: number,
): boolean {
  const viewportWidth = container.clientWidth;
  if (viewportWidth <= 0) {
    return false;
  }
  const contentWidth = Math.max(container.scrollWidth, modelWidth);
  const next = centeredScrollLeft(focusX, viewportWidth, contentWidth);
  if (Math.abs(container.scrollLeft - next) > 0.5) {
    container.scrollLeft = next;
  }
  return true;
}

interface GanttTodayFocusOptions {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly focusX: number;
  readonly modelWidth: number;
  readonly layoutKey: string;
  readonly request: number;
}

/**
 * Focus the timeline after DOM layout and again when its measured viewport changes.
 * The signature guard prevents ResizeObserver feedback from causing scroll loops.
 */
export function useGanttTodayFocus({
  containerRef,
  focusX,
  modelWidth,
  layoutKey,
  request,
}: GanttTodayFocusOptions): void {
  const lastApplied = useRef('');

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const apply = (): void => {
      const signature = [
        layoutKey,
        String(request),
        String(focusX),
        String(modelWidth),
        String(container.clientWidth),
        String(container.scrollWidth),
      ].join(':');
      if (signature === lastApplied.current) {
        return;
      }
      if (scrollGanttToFocus(container, focusX, modelWidth)) {
        lastApplied.current = signature;
      }
    };

    apply();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(apply);
    observer.observe(container);
    const timeline = container.firstElementChild;
    if (timeline instanceof HTMLElement || timeline instanceof SVGElement) {
      observer.observe(timeline);
    }
    return () => {
      observer.disconnect();
    };
  }, [containerRef, focusX, layoutKey, modelWidth, request]);
}
