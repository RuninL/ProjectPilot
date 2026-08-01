import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ReorderHandle } from '@/features/sorting/ReorderHandle';
import { SavedOrderControls } from '@/features/sorting/SavedOrderControls';
import { useDragReorder } from '@/features/sorting/useDragReorder';
import { useSavedListOrder } from '@/features/sorting/useSavedListOrder';
import { toAppError } from '@/lib/errors';
import { getTaskChecklistService } from '@/services/taskChecklist.service';
import type { TaskChecklistItem } from '@/types';

export function TaskChecklistSection({ taskId }: { taskId: string }) {
  const [items, setItems] = useState<TaskChecklistItem[]>([]);
  const [content, setContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const savedOrder = useSavedListOrder('task_checklist', taskId, items);
  const dragReorder = useDragReorder(savedOrder.moveTo, savedOrder.mode === 'dynamic');
  const load = useCallback(async () => {
    setItems(await (await getTaskChecklistService()).list(taskId));
  }, [taskId]);

  useEffect(() => {
    void load().catch((caught: unknown) => {
      setError(toAppError(caught).message);
    });
  }, [load]);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">待办</h2>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          void getTaskChecklistService()
            .then((service) => service.create(taskId, { content }))
            .then(async () => {
              setContent('');
              await load();
            })
            .catch((caught: unknown) => {
              setError(toAppError(caught).message);
            });
        }}
      >
        <Input
          aria-label="待办内容"
          placeholder="添加轻量待办"
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
          }}
        />
        <Button type="submit" disabled={content.trim() === ''}>
          <Plus className="h-4 w-4" aria-hidden />
          添加
        </Button>
      </form>
      <SavedOrderControls controller={savedOrder} disabledReason={null} />
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有待办。</p>
      ) : (
        <ul className="space-y-2">
          {savedOrder.displayedItems.map((item) => (
            <li
              key={item.id}
              {...dragReorder.dropProps(item.id)}
              className={`flex items-center gap-2 rounded-md border p-2 ${
                dragReorder.dropTargetId === item.id ? 'border-primary ring-1 ring-primary' : ''
              } ${dragReorder.activeId === item.id ? 'opacity-60' : ''}`}
            >
              {savedOrder.mode !== 'dynamic' && (
                <ReorderHandle
                  label={item.content}
                  disabled={false}
                  onMoveUp={() => {
                    savedOrder.move(item.id, -1);
                  }}
                  onMoveDown={() => {
                    savedOrder.move(item.id, 1);
                  }}
                  dragHandleProps={dragReorder.handleProps(item.id)}
                />
              )}
              <input
                type="checkbox"
                checked={item.is_completed === 1}
                aria-label={`完成 ${item.content}`}
                onChange={(event) => {
                  void getTaskChecklistService()
                    .then((service) => service.setCompleted(taskId, item.id, event.target.checked))
                    .then(load)
                    .catch((caught: unknown) => {
                      setError(toAppError(caught).message);
                    });
                }}
              />
              {editingId === item.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void getTaskChecklistService()
                      .then((service) =>
                        service.update(taskId, item.id, { content: editingContent }),
                      )
                      .then(async () => {
                        setEditingId(null);
                        await load();
                      })
                      .catch((caught: unknown) => {
                        setError(toAppError(caught).message);
                      });
                  }}
                >
                  <Input
                    aria-label={`编辑待办 ${item.content}`}
                    value={editingContent}
                    onChange={(event) => {
                      setEditingContent(event.target.value);
                    }}
                  />
                  <Button type="submit" size="sm" disabled={editingContent.trim() === ''}>
                    保存
                  </Button>
                </form>
              ) : (
                <span className={item.is_completed === 1 ? 'flex-1 line-through' : 'flex-1'}>
                  {item.content}
                </span>
              )}
              <Button
                size="icon"
                variant="ghost"
                aria-label={`编辑待办 ${item.content}`}
                onClick={() => {
                  setEditingId(item.id);
                  setEditingContent(item.content);
                }}
              >
                <Pencil className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`删除待办 ${item.content}`}
                onClick={() => {
                  void getTaskChecklistService()
                    .then((service) => service.delete(taskId, item.id))
                    .then(load)
                    .catch((caught: unknown) => {
                      setError(toAppError(caught).message);
                    });
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
