import { useCallback, useRef, useState, type DragEvent } from 'react';

export function useDragReorder(
  onMoveTo: (sourceId: string, targetId: string) => void,
  disabled: boolean,
) {
  const draggedId = useRef<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const reset = useCallback(() => {
    draggedId.current = null;
    setDropTargetId(null);
  }, []);

  return {
    dropTargetId,
    handleProps: (id: string) => ({
      draggable: !disabled,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        draggedId.current = id;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
      },
      onDragEnd: reset,
    }),
    dropProps: (id: string) => ({
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (disabled || draggedId.current === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropTargetId(id);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (disabled) return;
        event.preventDefault();
        const sourceId = draggedId.current ?? event.dataTransfer.getData('text/plain');
        if (sourceId !== '' && sourceId !== id) onMoveTo(sourceId, id);
        reset();
      },
    }),
  };
}
