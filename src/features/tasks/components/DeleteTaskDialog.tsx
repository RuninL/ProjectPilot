import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { toAppError } from '@/lib/errors';
import type { TaskWithProject } from '@/types';

interface DeleteTaskDialogProps {
  task: TaskWithProject | null;
  loadChildCount: (id: string) => Promise<number>;
  onConfirm: (task: TaskWithProject) => Promise<void>;
  onCancel: () => void;
}

/**
 * Delete confirmation. A task with children cannot be deleted — the sub-tree
 * must never vanish behind one click — so the action is refused up front with the
 * real child count instead of relying on the schema's cascade.
 */
export function DeleteTaskDialog({
  task,
  loadChildCount,
  onConfirm,
  onCancel,
}: DeleteTaskDialogProps) {
  const [childCount, setChildCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (task === null) {
      setChildCount(null);
      setError(null);
      return;
    }
    let active = true;
    setChildCount(null);
    setError(null);
    loadChildCount(task.id)
      .then((count) => {
        if (active) {
          setChildCount(count);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(toAppError(caught).message);
        }
      });
    return () => {
      active = false;
    };
  }, [task, loadChildCount]);

  if (task === null) {
    return null;
  }

  const blocked = childCount !== null && childCount > 0;

  return (
    <ConfirmDialog
      open
      destructive
      busy={busy || childCount === null || blocked}
      title="删除任务"
      confirmLabel="删除"
      description={
        <span className="block space-y-2">
          <span className="block">将删除任务「{task.title}」，此操作无法撤销。</span>
          <span className="block">
            {error !== null
              ? `无法读取子任务数量：${error}`
              : childCount === null
                ? '正在检查子任务…'
                : blocked
                  ? `该任务下还有 ${String(childCount)} 个子任务，请先删除或移出子任务后再删除。`
                  : '该任务没有子任务，可以安全删除。'}
          </span>
        </span>
      }
      onCancel={onCancel}
      onConfirm={() => {
        setBusy(true);
        onConfirm(task)
          .catch((caught: unknown) => {
            setError(toAppError(caught).message);
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    />
  );
}
