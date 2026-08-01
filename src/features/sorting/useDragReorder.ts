import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

/**
 * Movement (px) before a pointer press on the handle becomes a drag, so plain
 * clicks on or near the handle never start one.
 */
const ACTIVATION_DISTANCE = 5;

/** Props the drag handle element must spread. */
export interface DragHandleProps {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  draggable: false;
  'data-drag-handle': 'true';
}

/** Props every sortable row must spread so pointer hit-testing can find it. */
export interface DropTargetProps {
  'data-reorder-id': string;
  'data-reorder-scope': string;
}

interface DragSession {
  id: string;
  pointerId: number | undefined;
  startX: number;
  startY: number;
  active: boolean;
  dropTargetId: string | null;
  previousUserSelect: string;
  listeners: {
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
    cancel: (event: PointerEvent) => void;
    key: (event: KeyboardEvent) => void;
  };
}

function matchesPointer(drag: DragSession, event: PointerEvent): boolean {
  return (
    drag.pointerId === undefined ||
    typeof event.pointerId !== 'number' ||
    Number.isNaN(event.pointerId) ||
    event.pointerId === drag.pointerId
  );
}

/**
 * Pointer-events based list reordering shared by every sortable list.
 *
 * The previous implementation relied on native HTML5 drag-and-drop
 * (`draggable` + dragstart/dragover/drop). Inside the Tauri WebView on
 * Windows the OS drag layer never reliably delivers `dragstart` from the
 * handle, so no real list could be dragged even though synthetic-event tests
 * passed. This version uses only Pointer Events, which behave identically in
 * WebView2 and ordinary browsers:
 *
 * - `pointerdown` on the handle arms a drag; it activates after a small
 *   movement threshold, so inline buttons/checkboxes/menus never trigger it.
 * - While active, `pointermove` on `window` hit-tests the element under the
 *   cursor for a row of the same list (matching `data-reorder-scope`).
 * - `pointerup` commits exactly one `onMoveTo(sourceId, targetId)`; dropping
 *   on the original row (or outside the list) writes nothing.
 * - `Escape` cancels the drag without writing.
 */
export function useDragReorder(
  onMoveTo: (sourceId: string, targetId: string) => void,
  disabled: boolean,
) {
  const scopeId = useId();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const onMoveToRef = useRef(onMoveTo);
  onMoveToRef.current = onMoveTo;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const controller = useMemo(() => {
    const teardown = () => {
      const drag = sessionRef.current;
      if (drag === null) return;
      if (drag.active) {
        document.body.style.userSelect = drag.previousUserSelect;
      }
      window.removeEventListener('pointermove', drag.listeners.move);
      window.removeEventListener('pointerup', drag.listeners.up);
      window.removeEventListener('pointercancel', drag.listeners.cancel);
      window.removeEventListener('keydown', drag.listeners.key, true);
      sessionRef.current = null;
      setActiveId(null);
      setDropTargetId(null);
    };

    const findRowId = (event: PointerEvent): string | null => {
      const target = event.target;
      if (!(target instanceof Element)) return null;
      const row = target.closest('[data-reorder-id]');
      if (row === null || row.getAttribute('data-reorder-scope') !== scopeId) return null;
      return row.getAttribute('data-reorder-id');
    };

    const handleMove = (event: PointerEvent) => {
      const drag = sessionRef.current;
      if (drag === null || !matchesPointer(drag, event)) return;
      if (!drag.active) {
        const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (distance < ACTIVATION_DISTANCE) return;
        drag.active = true;
        drag.previousUserSelect = document.body.style.userSelect;
        document.body.style.userSelect = 'none';
        setActiveId(drag.id);
      }
      if (event.cancelable) event.preventDefault();
      const rowId = findRowId(event);
      if (rowId === drag.dropTargetId) return;
      drag.dropTargetId = rowId;
      setDropTargetId(rowId);
    };

    const handleUp = (event: PointerEvent) => {
      const drag = sessionRef.current;
      if (drag === null || !matchesPointer(drag, event)) return;
      const shouldCommit =
        drag.active &&
        !disabledRef.current &&
        drag.dropTargetId !== null &&
        drag.dropTargetId !== drag.id;
      const sourceId = drag.id;
      const targetId = drag.dropTargetId;
      teardown();
      // Committed exactly once per completed drag, after all listeners are gone.
      if (shouldCommit && targetId !== null) {
        onMoveToRef.current(sourceId, targetId);
      }
    };

    const handleCancel = (event: PointerEvent) => {
      const drag = sessionRef.current;
      if (drag === null || !matchesPointer(drag, event)) return;
      teardown();
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || sessionRef.current === null) return;
      event.stopPropagation();
      teardown();
    };

    const start = (id: string, event: ReactPointerEvent<HTMLElement>) => {
      if (disabledRef.current || sessionRef.current !== null) return;
      if (event.button !== 0) return;
      const listeners = {
        move: handleMove,
        up: handleUp,
        cancel: handleCancel,
        key: handleKey,
      };
      sessionRef.current = {
        id,
        pointerId: typeof event.pointerId === 'number' ? event.pointerId : undefined,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        dropTargetId: null,
        previousUserSelect: '',
        listeners,
      };
      window.addEventListener('pointermove', listeners.move);
      window.addEventListener('pointerup', listeners.up);
      window.addEventListener('pointercancel', listeners.cancel);
      window.addEventListener('keydown', listeners.key, true);
    };

    return { teardown, start };
  }, [scopeId]);

  useEffect(() => controller.teardown, [controller]);

  useEffect(() => {
    if (disabled) controller.teardown();
  }, [disabled, controller]);

  return {
    /** Row currently being dragged (for source feedback). */
    activeId,
    /** Row currently under the pointer (for target feedback). */
    dropTargetId,
    handleProps: (id: string): DragHandleProps => ({
      draggable: false,
      'data-drag-handle': 'true',
      // A stray native drag (e.g. from selected text) must never start.
      onDragStart: (event) => {
        event.preventDefault();
      },
      onPointerDown: (event) => {
        controller.start(id, event);
      },
    }),
    dropProps: (id: string): DropTargetProps => ({
      'data-reorder-id': id,
      'data-reorder-scope': scopeId,
    }),
  };
}
