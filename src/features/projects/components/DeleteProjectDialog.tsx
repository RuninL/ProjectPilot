import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { toAppError } from '@/lib/errors';
import type { DeleteImpact } from '@/services/project.service';
import type { Project } from '@/types';

interface DeleteProjectDialogProps {
  project: Project | null;
  loadImpact: (id: string) => Promise<DeleteImpact>;
  onConfirm: (project: Project) => Promise<void>;
  onCancel: () => void;
}

/**
 * Permanent-delete confirmation. The task count is read from the database when
 * the dialog opens — never estimated — so the user sees the real blast radius.
 */
export function DeleteProjectDialog({
  project,
  loadImpact,
  onConfirm,
  onCancel,
}: DeleteProjectDialogProps) {
  const [impact, setImpact] = useState<DeleteImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (project === null) {
      setImpact(null);
      setError(null);
      return;
    }
    let active = true;
    setImpact(null);
    setError(null);
    loadImpact(project.id)
      .then((next) => {
        if (active) {
          setImpact(next);
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
  }, [project, loadImpact]);

  if (project === null) {
    return null;
  }

  return (
    <ConfirmDialog
      open
      destructive
      busy={busy}
      title="永久删除项目"
      confirmLabel="永久删除"
      description={
        <span className="block space-y-2">
          <span className="block">
            将永久删除项目「{project.name}」及其全部关联数据，此操作无法撤销。
          </span>
          <span className="block">
            {error !== null
              ? `无法读取影响范围：${error}`
              : impact === null
                ? '正在统计受影响的数据…'
                : `将同时删除 ${String(impact.taskCount)} 个任务。`}
          </span>
        </span>
      }
      onCancel={onCancel}
      onConfirm={() => {
        setBusy(true);
        onConfirm(project)
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
