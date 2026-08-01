import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ReorderHandle } from '@/features/sorting/ReorderHandle';
import { SavedOrderControls } from '@/features/sorting/SavedOrderControls';
import { useDragReorder } from '@/features/sorting/useDragReorder';
import { useSavedListOrder } from '@/features/sorting/useSavedListOrder';
import { toAppError } from '@/lib/errors';
import { getTaskProgressService } from '@/services/taskProgress.service';
import type { TaskProgressUpdate } from '@/types';

interface Props {
  taskId: string;
  onChanged: () => Promise<void>;
}

function localDateTime(iso: string): string {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function TaskProgressSection({ taskId, onChanged }: Props) {
  const [updates, setUpdates] = useState<TaskProgressUpdate[]>([]);
  const [editing, setEditing] = useState<TaskProgressUpdate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskProgressUpdate | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [occurredAt, setOccurredAt] = useState(localDateTime(new Date().toISOString()));
  const [percent, setPercent] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const savedOrder = useSavedListOrder('task_progress', taskId, updates);
  const dragReorder = useDragReorder(savedOrder.moveTo, savedOrder.mode === 'dynamic');

  const load = useCallback(async () => {
    const service = await getTaskProgressService();
    setUpdates(await service.list(taskId));
  }, [taskId]);

  useEffect(() => {
    void load().catch((caught: unknown) => {
      setError(toAppError(caught).message);
    });
  }, [load]);

  const startEdit = (update: TaskProgressUpdate | null) => {
    setEditing(update);
    setTitle(update?.title ?? '');
    setDescription(update?.description ?? '');
    setOccurredAt(localDateTime(update?.occurred_at ?? new Date().toISOString()));
    setPercent(String(update?.contribution_percent ?? 0));
    setOpen(true);
  };

  const total = updates.reduce((sum, update) => sum + update.contribution_percent, 0);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">进展</h2>
        <Button
          onClick={() => {
            startEdit(null);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden />
          记录进展
        </Button>
      </div>
      <div
        className="flex h-8 w-full overflow-hidden rounded-md border bg-muted"
        aria-label={`任务进度 ${String(total)}%`}
      >
        {updates
          .filter((update) => update.contribution_percent > 0)
          .map((update, index) => (
            <div
              key={update.id}
              className={
                index % 2 === 0 ? 'bg-primary text-primary-foreground' : 'bg-blue-500 text-white'
              }
              style={{ width: `${String(update.contribution_percent)}%` }}
              title={`${update.title} ${String(update.contribution_percent)}%`}
            >
              <span className="block truncate px-2 text-center text-xs leading-8">
                {update.title} {String(update.contribution_percent)}%
              </span>
            </div>
          ))}
        {total < 100 && (
          <div
            className="truncate px-2 text-center text-xs leading-8 text-muted-foreground"
            style={{ width: `${String(100 - total)}%` }}
            title={`未完成 ${String(100 - total)}%`}
          >
            未完成 {String(100 - total)}%
          </div>
        )}
      </div>
      <SavedOrderControls controller={savedOrder} disabledReason={null} />
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
      {updates.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有进展记录。</p>
      ) : (
        <ol className="space-y-3">
          {savedOrder.displayedItems.map((update) => (
            <li
              key={update.id}
              {...dragReorder.dropProps(update.id)}
              className={`rounded-md border p-3 ${
                dragReorder.dropTargetId === update.id ? 'border-primary ring-1 ring-primary' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {update.title} · {String(update.contribution_percent)}%
                  </p>
                  <time className="text-xs text-muted-foreground">
                    {new Date(update.occurred_at).toLocaleString('zh-CN')}
                  </time>
                  {update.description !== '' && (
                    <p className="mt-2 whitespace-pre-wrap text-sm">{update.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {savedOrder.mode !== 'dynamic' && (
                    <ReorderHandle
                      label={update.title}
                      disabled={false}
                      onMoveUp={() => {
                        savedOrder.move(update.id, -1);
                      }}
                      onMoveDown={() => {
                        savedOrder.move(update.id, 1);
                      }}
                      dragHandleProps={dragReorder.handleProps(update.id)}
                    />
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`编辑进展 ${update.title}`}
                    onClick={() => {
                      startEdit(update);
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`删除进展 ${update.title}`}
                    onClick={() => {
                      setDeleteTarget(update);
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === null ? '记录任务进展' : '编辑任务进展'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Label htmlFor="progress-title">标题</Label>
            <Input
              id="progress-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
            <Label htmlFor="progress-description">具体内容</Label>
            <Textarea
              id="progress-description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
            <Label htmlFor="progress-time">发生时间</Label>
            <Input
              id="progress-time"
              type="datetime-local"
              value={occurredAt}
              onChange={(event) => {
                setOccurredAt(event.target.value);
              }}
            />
            <Label htmlFor="progress-percent">本次贡献百分比</Label>
            <Input
              id="progress-percent"
              type="number"
              min="0"
              max="100"
              value={percent}
              onChange={(event) => {
                setPercent(event.target.value);
              }}
            />
          </div>
          {error !== null && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
              }}
            >
              取消
            </Button>
            <Button
              disabled={title.trim() === '' || occurredAt === ''}
              onClick={() => {
                setError(null);
                void getTaskProgressService()
                  .then((service) =>
                    editing === null
                      ? service.create(taskId, {
                          title,
                          description,
                          occurred_at: new Date(occurredAt).toISOString(),
                          contribution_percent: Number(percent),
                        })
                      : service.update(taskId, editing.id, {
                          title,
                          description,
                          occurred_at: new Date(occurredAt).toISOString(),
                          contribution_percent: Number(percent),
                        }),
                  )
                  .then(async () => {
                    setOpen(false);
                    await load();
                    const service = await getTaskProgressService();
                    const latest = await service.list(taskId);
                    if (
                      latest.reduce((sum, update) => sum + update.contribution_percent, 0) ===
                        100 &&
                      window.confirm('任务进度已达到 100%。是否将任务标记为完成？')
                    ) {
                      await service.completeTask(taskId, false);
                    }
                    await onChanged();
                  })
                  .catch((caught: unknown) => {
                    setError(toAppError(caught).message);
                  });
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除进展"
        description="删除后任务总进度会重新计算。确定继续吗？"
        confirmLabel="删除"
        destructive
        onCancel={() => {
          setDeleteTarget(null);
        }}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target === null) return;
          void getTaskProgressService()
            .then((service) => service.delete(taskId, target.id))
            .then(async () => {
              await load();
              await onChanged();
            })
            .catch((caught: unknown) => {
              setError(toAppError(caught).message);
            });
        }}
      />
    </section>
  );
}
