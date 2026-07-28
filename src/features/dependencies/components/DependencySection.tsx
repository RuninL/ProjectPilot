import { Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toAppError } from '@/lib/errors';
import type { ProjectDependencyAnalysis } from '@/services/dependency.service';
import { wouldCreateCycle } from '@/services/dependencyGraph';
import { useGanttStore } from '@/stores/useGanttStore';
import type { Task } from '@/types';

/**
 * Dependency management for one project: the existing finish-to-start edges,
 * an add form whose candidate lists are pre-filtered, and a second-confirmation
 * delete.
 *
 * The dropdown filtering is a convenience only — it hides self, archived,
 * already-linked and cycle-forming candidates so the user is not led into an
 * error. The service re-checks every one of those rules, so a stale dropdown
 * cannot write a bad row.
 */

interface DependencySectionProps {
  analysis: ProjectDependencyAnalysis | null;
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  editHint: string | null;
  onCreate: (predecessorId: string, successorId: string) => Promise<void>;
  onDelete: (dependencyId: string) => Promise<void>;
  onRetry: () => void;
}

function isSelectable(task: Task): boolean {
  return task.archived_at === null;
}

export function DependencySection({
  analysis,
  loading,
  error,
  canEdit,
  editHint,
  onCreate,
  onDelete,
  onRetry,
}: DependencySectionProps) {
  const setSelectedTaskId = useGanttStore((state) => state.setSelectedTaskId);
  const [predecessorId, setPredecessorId] = useState('');
  const [successorId, setSuccessorId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const tasks = useMemo(() => analysis?.tasks ?? [], [analysis]);
  const titleOf = useMemo(() => new Map(tasks.map((task) => [task.id, task.title])), [tasks]);
  const name = (id: string): string => titleOf.get(id) ?? id;

  const predecessorOptions = useMemo(() => tasks.filter(isSelectable), [tasks]);

  /**
   * Successor candidates for the chosen predecessor: never itself, never an
   * archived task, never a pair that already exists, never one that would close
   * a cycle.
   */
  const successorOptions = useMemo(() => {
    if (analysis === null || predecessorId === '') {
      return [];
    }
    const linked = new Set(
      analysis.dependencies
        .filter((dependency) => dependency.predecessor_id === predecessorId)
        .map((dependency) => dependency.successor_id),
    );
    return tasks.filter(
      (task) =>
        isSelectable(task) &&
        task.id !== predecessorId &&
        !linked.has(task.id) &&
        !wouldCreateCycle(analysis.graph, predecessorId, task.id),
    );
  }, [analysis, predecessorId, tasks]);

  const riskByTask = useMemo(
    () => new Map((analysis?.blockedRisks ?? []).map((risk) => [risk.taskId, risk.blockedBy])),
    [analysis],
  );
  const conflictEdges = useMemo(
    () => new Set((analysis?.conflicts ?? []).map((conflict) => conflict.edgeId)),
    [analysis],
  );

  const submit = async (): Promise<void> => {
    setFormError(null);
    setBusy(true);
    try {
      await onCreate(predecessorId, successorId);
      setPredecessorId('');
      setSuccessorId('');
    } catch (caught) {
      setFormError(toAppError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (): void => {
    const id = pendingDelete;
    setPendingDelete(null);
    if (id === null) {
      return;
    }
    setBusy(true);
    void onDelete(id)
      .catch((caught: unknown) => {
        setFormError(toAppError(caught).message);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  if (loading && analysis === null) {
    return <LoadingState label="正在加载任务依赖…" />;
  }

  if (error !== null) {
    return <ErrorState title="无法加载任务依赖" message={error} onRetry={onRetry} />;
  }

  const selectClass =
    'h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-medium">添加依赖（完成后开始）</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          后继任务必须等待前驱任务完成。仅支持同一项目内、未归档的任务，且不能形成循环。
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="dep-predecessor">前驱任务</Label>
            <select
              id="dep-predecessor"
              className={selectClass}
              value={predecessorId}
              disabled={!canEdit || busy}
              onChange={(event) => {
                setPredecessorId(event.target.value);
                setSuccessorId('');
                setFormError(null);
              }}
            >
              <option value="">请选择前驱任务</option>
              {predecessorOptions.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dep-successor">后继任务</Label>
            <select
              id="dep-successor"
              className={selectClass}
              value={successorId}
              disabled={!canEdit || busy || predecessorId === ''}
              onChange={(event) => {
                setSuccessorId(event.target.value);
                setFormError(null);
              }}
            >
              <option value="">请选择后继任务</option>
              {successorOptions.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </div>
          <Button
            disabled={!canEdit || busy || predecessorId === '' || successorId === ''}
            onClick={() => {
              void submit();
            }}
          >
            添加依赖
          </Button>
        </div>
        {predecessorId !== '' && successorOptions.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            没有可选的后继任务：其余任务或已建立依赖，或会形成循环依赖，或已归档。
          </p>
        )}
        {editHint !== null && <p className="mt-2 text-xs text-muted-foreground">{editHint}</p>}
        {formError !== null && <p className="mt-2 text-sm text-destructive">{formError}</p>}
      </div>

      {analysis !== null && analysis.dependencies.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          该项目暂无任务依赖。添加依赖后，甘特图会画出依赖箭头。
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {(analysis?.dependencies ?? []).map((dependency) => (
            <li
              key={dependency.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <div className="min-w-0">
                <span className="font-medium">{name(dependency.predecessor_id)}</span>
                <span className="mx-2 text-muted-foreground" aria-label="先于">
                  →
                </span>
                <span className="font-medium">{name(dependency.successor_id)}</span>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">完成后开始（FS）</Badge>
                  {conflictEdges.has(dependency.id) && (
                    <Badge variant="destructive">排期冲突</Badge>
                  )}
                  {(riskByTask.get(dependency.successor_id) ?? []).length > 0 && (
                    <Badge variant="destructive">
                      {`受阻风险：${(riskByTask.get(dependency.successor_id) ?? [])
                        .map(name)
                        .join('、')}`}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelectedTaskId(dependency.successor_id);
                  }}
                >
                  在甘特图中定位
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`删除依赖：${name(dependency.predecessor_id)} → ${name(dependency.successor_id)}`}
                  disabled={busy}
                  onClick={() => {
                    setPendingDelete(dependency.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {analysis !== null && analysis.cyclicTaskIds.length > 0 && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {`检测到循环依赖，涉及任务：${analysis.cyclicTaskIds.map(name).join('、')}。请删除其中一条依赖后重试。`}
        </p>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除任务依赖"
        description={
          pendingDelete === null
            ? ''
            : (() => {
                const target = (analysis?.dependencies ?? []).find(
                  (dependency) => dependency.id === pendingDelete,
                );
                if (target === undefined) {
                  return '该依赖不存在或已被删除。';
                }
                return `确定删除「${name(target.predecessor_id)}」→「${name(target.successor_id)}」的依赖吗？两个任务的状态不会改变。`;
              })()
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
