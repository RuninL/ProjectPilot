import { CheckCircle2, Flag, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toAppError } from '@/lib/errors';
import { MILESTONE_STATUS_LABELS, MILESTONE_STATUS_VARIANTS } from '@/lib/labels';
import { achievePromptMessage } from '@/services/milestoneStatus';
import { useMilestoneStore } from '@/stores/useMilestoneStore';
import { useTaskStore } from '@/stores/useTaskStore';
import type { Milestone, TaskWithProject } from '@/types';
import { MilestoneForm } from './MilestoneForm';

interface MilestoneSectionProps {
  projectId: string;
  canEdit: boolean;
  editHint: string | null;
}

/**
 * One project's milestones with their countdowns.
 *
 * A linked task reaching 已完成 only ever *asks* whether to mark the milestone
 * achieved. Answering 否 dismisses the question for this visit and writes
 * nothing at all — the status stays exactly as stored, which is why the answer
 * needs no undo.
 */
export function MilestoneSection({ projectId, canEdit, editHint }: MilestoneSectionProps) {
  const details = useMilestoneStore((state) => state.details);
  const loading = useMilestoneStore((state) => state.loading);
  const error = useMilestoneStore((state) => state.error);
  const loadProject = useMilestoneStore((state) => state.loadProject);
  const createMilestone = useMilestoneStore((state) => state.createMilestone);
  const updateMilestone = useMilestoneStore((state) => state.updateMilestone);
  const setStatus = useMilestoneStore((state) => state.setStatus);
  const deleteMilestone = useMilestoneStore((state) => state.deleteMilestone);

  const listByProject = useTaskStore((state) => state.listByProject);
  // Re-read after any task write: a completed link is what raises the prompt.
  const taskVersion = useTaskStore((state) => state.tasks);

  const [tasks, setTasks] = useState<TaskWithProject[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Milestone | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Milestone | null>(null);
  const [dismissedPrompts, setDismissedPrompts] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sectionError, setSectionError] = useState<string | null>(null);

  useEffect(() => {
    void loadProject(projectId);
  }, [loadProject, projectId, taskVersion]);

  useEffect(() => {
    let active = true;
    void listByProject(projectId).then((loaded) => {
      if (active) {
        setTasks(loaded);
      }
    });
    return () => {
      active = false;
    };
  }, [listByProject, projectId, taskVersion]);

  const prompt =
    (details ?? []).find(
      (detail) => detail.promptAchieved && !dismissedPrompts.includes(detail.milestone.id),
    ) ?? null;

  const changeStatus = (milestone: Milestone): void => {
    setSectionError(null);
    setBusy(true);
    void setStatus(milestone.id, 'achieved', projectId)
      .catch((caught: unknown) => {
        setSectionError(toAppError(caught).message);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const confirmDelete = (): void => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (target === null) {
      return;
    }
    setBusy(true);
    void deleteMilestone(target.id, projectId)
      .catch((caught: unknown) => {
        setSectionError(toAppError(caught).message);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  if (loading && details === null) {
    return <LoadingState label="正在加载里程碑…" />;
  }

  if (error !== null && details === null) {
    return (
      <ErrorState
        title="无法加载里程碑"
        message={error}
        onRetry={() => {
          void loadProject(projectId);
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          倒计时按香港时区（Asia/Hong_Kong）计算。状态只会在你确认后改变。
        </p>
        <Button
          size="sm"
          disabled={!canEdit}
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden />
          新建里程碑
        </Button>
      </div>

      {editHint !== null && <p className="text-xs text-muted-foreground">{editHint}</p>}
      {sectionError !== null && <p className="text-sm text-destructive">{sectionError}</p>}

      {details !== null && details.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          该项目暂无里程碑。新建里程碑后会显示倒计时与逾期提醒。
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {(details ?? []).map(({ milestone, view, linkedTask }) => (
            <li
              key={milestone.id}
              className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Flag className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{milestone.name}</span>
                  <Badge variant={MILESTONE_STATUS_VARIANTS[milestone.status]}>
                    {MILESTONE_STATUS_LABELS[milestone.status]}
                  </Badge>
                  {view.needsAttention ? (
                    <Badge variant="destructive">{view.label}</Badge>
                  ) : (
                    <Badge variant="outline">{view.label}</Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{`目标日期：${milestone.date}`}</span>
                  {linkedTask !== null && (
                    <Link
                      to={`/tasks?taskId=${encodeURIComponent(linkedTask.id)}`}
                      className="hover:underline"
                    >
                      {`关联任务：${linkedTask.title}`}
                    </Link>
                  )}
                </div>
                {milestone.description !== '' && (
                  <p className="text-xs text-muted-foreground">{milestone.description}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {milestone.status === 'upcoming' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canEdit || busy}
                    onClick={() => {
                      changeStatus(milestone);
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden />
                    标记已达成
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`编辑里程碑：${milestone.name}`}
                  disabled={!canEdit || busy}
                  onClick={() => {
                    setEditing(milestone);
                    setFormOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`删除里程碑：${milestone.name}`}
                  disabled={!canEdit || busy}
                  onClick={() => {
                    setPendingDelete(milestone);
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <MilestoneForm
        open={formOpen}
        milestone={editing}
        projectId={projectId}
        tasks={tasks}
        onSubmit={async (input) => {
          if (editing === null) {
            await createMilestone(input, projectId);
          } else {
            await updateMilestone(editing.id, input, projectId);
          }
        }}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={prompt !== null}
        title="标记里程碑为已达成？"
        description={
          prompt === null || prompt.linkedTask === null
            ? ''
            : achievePromptMessage(prompt.milestone, prompt.linkedTask)
        }
        confirmLabel="是，标记为已达成"
        cancelLabel="否，保持当前状态"
        busy={busy}
        onCancel={() => {
          if (prompt !== null) {
            setDismissedPrompts((current) => [...current, prompt.milestone.id]);
          }
        }}
        onConfirm={() => {
          if (prompt !== null) {
            setDismissedPrompts((current) => [...current, prompt.milestone.id]);
            changeStatus(prompt.milestone);
          }
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除里程碑"
        description={
          pendingDelete === null
            ? ''
            : `确定删除里程碑「${pendingDelete.name}」吗？关联任务不会被删除。此操作不可撤销。`
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
