import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import type { DragEventHandler } from 'react';
import { Button } from '@/components/ui/button';

interface ReorderHandleProps {
  label: string;
  disabled: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  dragHandleProps?: {
    draggable: boolean;
    onDragStart: DragEventHandler<HTMLElement>;
    onDragEnd: DragEventHandler<HTMLElement>;
  };
}

export function ReorderHandle({
  label,
  disabled,
  onMoveUp,
  onMoveDown,
  dragHandleProps,
}: ReorderHandleProps) {
  return (
    <div className="flex items-center gap-1" aria-label={`${label} 排序操作`}>
      <span
        className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        aria-label={`拖动排序 ${label}`}
        {...dragHandleProps}
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        aria-label={`上移 ${label}`}
        onClick={onMoveUp}
      >
        <ArrowUp className="h-4 w-4" aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        aria-label={`下移 ${label}`}
        onClick={onMoveDown}
      >
        <ArrowDown className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
