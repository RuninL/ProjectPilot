import { Button } from '@/components/ui/button';

interface BulkEditBarProps {
  count: number;
  onEdit: () => void;
  onClear: () => void;
}

/** Action bar shown while tasks are selected. Hidden when the selection is empty. */
export function BulkEditBar({ count, onEdit, onClear }: BulkEditBarProps) {
  if (count === 0) {
    return null;
  }
  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3">
      <span className="text-sm font-medium">已选择 {String(count)} 个任务</span>
      <Button size="sm" onClick={onEdit}>
        批量修改
      </Button>
      <Button size="sm" variant="outline" onClick={onClear}>
        取消选择
      </Button>
    </div>
  );
}
