import { ArrowRightLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toAppError } from '@/lib/errors';
import { ACTION_ITEM_STATUS_LABELS, ACTION_ITEM_STATUS_VARIANTS } from '@/lib/labels';
import { canConvert, conversionState } from '@/services/actionItemConversion';
import type { ActionItemInput } from '@/services/schemas';
import type { ActionItem, Project } from '@/types';
import { ActionItemForm } from './ActionItemForm';
import { ConvertToTaskDialog } from './ConvertToTaskDialog';

interface ActionItemSectionProps {
  items: readonly ActionItem[];
  /** The meeting's own project; when null the user is asked per conversion. */
  meetingProjectId: string | null;
  projects: readonly Project[];
  onCreate: (input: ActionItemInput) => Promise<void>;
  onUpdate: (id: string, input: ActionItemInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Resolves with the created task's id. */
  onConvert: (id: string, projectId: string | null) => Promise<string>;
}

/**
 * Action items of one meeting, plus the convert-to-task action.
 *
 * Conversion is one-way and one-shot: an already-converted item offers a link to
 * its task instead of a second conversion, and an item whose task was later
 * deleted stays terminal rather than becoming convertible again. The button is
 * disabled for the whole round-trip so a double click cannot start two writes.
 */
export function ActionItemSection({
  items,
  meetingProjectId,
  projects,
  onCreate,
  onUpdate,
  onDelete,
  onConvert,
}: ActionItemSectionProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ActionItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ActionItem | null>(null);
  const [pendingConvert, setPendingConvert] = useState<ActionItem | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [convertedTaskId, setConvertedTaskId] = useState<string | null>(null);

  const runConvert = (item: ActionItem, projectId: string | null): void => {
    setSectionError(null);
    setConvertedTaskId(null);
    setConvertingId(item.id);
    void onConvert(item.id, projectId)
      .then((taskId) => {
        setPendingConvert(null);
        setConvertedTaskId(taskId);
      })
      .catch((caught: unknown) => {
        setSectionError(toAppError(caught).message);
      })
      .finally(() => {
        setConvertingId(null);
      });
  };

  const startConvert = (item: ActionItem): void => {
    if (meetingProjectId === null) {
      setSectionError(null);
      setPendingConvert(item);
      return;
    }
    runConvert(item, null);
  };

  const confirmDelete = (): void => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (target === null) {
      return;
    }
    setBusy(true);
    void onDelete(target.id)
      .catch((caught: unknown) => {
        setSectionError(toAppError(caught).message);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          行动项可一键转为任务；每个行动项只能转换一次，转换后可直接跳转到任务。
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden />
          新建行动项
        </Button>
      </div>

      {sectionError !== null && <p className="text-sm text-destructive">{sectionError}</p>}
      {convertedTaskId !== null && (
        <p className="rounded-md border bg-muted/30 p-3 text-sm">
          已创建任务。
          <Link
            to={`/tasks?taskId=${encodeURIComponent(convertedTaskId)}`}
            className="ml-1 underline"
          >
            前往任务
          </Link>
        </p>
      )}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          本次会议暂无行动项。新建行动项后可以转为任务跟踪。
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {items.map((item) => {
            const state = conversionState(item);
            return (
              <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">{item.content}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={ACTION_ITEM_STATUS_VARIANTS[item.status]}>
                      {ACTION_ITEM_STATUS_LABELS[item.status]}
                    </Badge>
                    {item.owner !== '' && <span>{`负责人：${item.owner}`}</span>}
                    {item.due_date !== null && <span>{`截止：${item.due_date}`}</span>}
                    {state === 'converted' && <Badge variant="outline">已转为任务</Badge>}
                    {state === 'task_deleted' && <Badge variant="outline">任务已删除</Badge>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {state === 'converted' && item.converted_task_id !== null && (
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/tasks?taskId=${encodeURIComponent(item.converted_task_id)}`}>
                        查看任务
                      </Link>
                    </Button>
                  )}
                  {state === 'task_deleted' && (
                    <span className="px-2 text-xs text-muted-foreground">任务已删除</span>
                  )}
                  {canConvert(item) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={convertingId !== null || busy}
                      onClick={() => {
                        startConvert(item);
                      }}
                    >
                      <ArrowRightLeft className="h-4 w-4" aria-hidden />
                      {convertingId === item.id ? '转换中…' : '转为任务'}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`编辑行动项：${item.content}`}
                    disabled={busy}
                    onClick={() => {
                      setEditing(item);
                      setFormOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`删除行动项：${item.content}`}
                    disabled={busy}
                    onClick={() => {
                      setPendingDelete(item);
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ActionItemForm
        open={formOpen}
        item={editing}
        onSubmit={async (input) => {
          if (editing === null) {
            await onCreate(input);
          } else {
            await onUpdate(editing.id, input);
          }
        }}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />

      <ConvertToTaskDialog
        item={pendingConvert}
        projects={projects}
        busy={convertingId !== null}
        onConfirm={(projectId) => {
          if (pendingConvert !== null) {
            runConvert(pendingConvert, projectId);
          }
        }}
        onCancel={() => {
          setPendingConvert(null);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除行动项"
        description={
          pendingDelete === null
            ? ''
            : `确定删除行动项「${pendingDelete.content}」吗？${
                conversionState(pendingDelete) === 'unconverted'
                  ? '此操作不可撤销。'
                  : '已转换出的任务会保留，不会被删除。'
              }`
        }
        confirmLabel="删除"
        destructive
        busy={busy}
        onCancel={() => {
          setPendingDelete(null);
        }}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
