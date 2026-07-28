import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toAppError } from '@/lib/errors';
import {
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_LABELS,
  TASK_STATUS_OPTIONS,
} from '@/lib/labels';
import { bulkTaskUpdateSchema, type BulkTaskUpdate } from '@/services/schemas';
import type { TaskPriority, TaskStatus } from '@/types';

interface BulkEditDialogProps {
  open: boolean;
  count: number;
  onSubmit: (patch: BulkTaskUpdate) => Promise<void>;
  onClose: () => void;
}

/**
 * Compose a patch, then confirm it. Only the fields the user explicitly sets are
 * sent; the service applies them to every selected task in one transaction.
 */
export function BulkEditDialog({ open, count, onSubmit, onClose }: BulkEditDialogProps) {
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [changeDueDate, setChangeDueDate] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setStatus('');
      setPriority('');
      setChangeDueDate(false);
      setDueDate('');
      setConfirming(false);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const patch: BulkTaskUpdate = {
    ...(status === '' ? {} : { status }),
    ...(priority === '' ? {} : { priority }),
    ...(changeDueDate ? { due_date: dueDate === '' ? null : dueDate } : {}),
  };

  const review = () => {
    const parsed = bulkTaskUpdateSchema.safeParse(patch);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '请检查输入内容');
      return;
    }
    setError(null);
    setConfirming(true);
  };

  const apply = () => {
    setBusy(true);
    onSubmit(patch)
      .then(() => {
        onClose();
      })
      .catch((caught: unknown) => {
        setError(toAppError(caught).message);
        setConfirming(false);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const changes: string[] = [
    ...(status === '' ? [] : [`状态改为「${TASK_STATUS_LABELS[status]}」`]),
    ...(priority === '' ? [] : [`优先级改为「${TASK_PRIORITY_LABELS[priority]}」`]),
    ...(changeDueDate ? [dueDate === '' ? '清除截止日期' : `截止日期改为 ${dueDate}`] : []),
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>批量修改任务</DialogTitle>
          <DialogDescription>
            将对已选中的 {String(count)} 个任务生效，修改在同一个事务中完成，失败时全部回滚。
          </DialogDescription>
        </DialogHeader>

        {confirming ? (
          <div className="grid gap-3">
            <p className="text-sm">确认对 {String(count)} 个任务执行以下修改？</p>
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
            {error !== null && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                }}
              >
                返回修改
              </Button>
              <Button disabled={busy} onClick={apply}>
                确认修改
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="bulk-status">状态</Label>
              <select
                id="bulk-status"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={status}
                onChange={(event) => {
                  const next = event.target.value;
                  setStatus(next === '' ? '' : (next as TaskStatus));
                }}
              >
                <option value="">不修改</option>
                {TASK_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="bulk-priority">优先级</Label>
              <select
                id="bulk-priority"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={priority}
                onChange={(event) => {
                  const next = event.target.value;
                  setPriority(next === '' ? '' : (next as TaskPriority));
                }}
              >
                <option value="">不修改</option>
                {TASK_PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="bulk-change-due"
                  checked={changeDueDate}
                  onCheckedChange={(checked) => {
                    setChangeDueDate(checked === true);
                  }}
                />
                <Label htmlFor="bulk-change-due">修改截止日期</Label>
              </div>
              <Input
                id="bulk-due-date"
                type="date"
                aria-label="批量截止日期"
                disabled={!changeDueDate}
                value={dueDate}
                onChange={(event) => {
                  setDueDate(event.target.value);
                }}
              />
              {changeDueDate && dueDate === '' && (
                <p className="text-xs text-muted-foreground">留空表示清除这些任务的截止日期。</p>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              状态改为「已完成」时，进度会一并记为 100%。
            </p>

            {error !== null && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button onClick={review}>下一步</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
