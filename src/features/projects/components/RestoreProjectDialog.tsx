import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Project } from '@/types';

interface RestoreProjectDialogProps {
  project: Project | null;
  /** Real count of tasks that were auto-archived by this project's archive. */
  loadAutoArchivedCount: (id: string) => Promise<number>;
  onCancel: () => void;
  /** `restoreTasks` distinguishes 仅恢复项目 from 恢复项目和任务. */
  onConfirm: (project: Project, restoreTasks: boolean) => void;
}

/**
 * Restoring a project asks whether the tasks auto-archived by that project's
 * archive should come back too. Manually archived tasks stay archived in both
 * choices; the dialog only governs archived_source = 'project' tasks.
 */
export function RestoreProjectDialog({
  project,
  loadAutoArchivedCount,
  onCancel,
  onConfirm,
}: RestoreProjectDialogProps) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    setCount(null);
    if (project === null) return;
    let active = true;
    void loadAutoArchivedCount(project.id)
      .then((value) => {
        if (active) setCount(value);
      })
      .catch(() => {
        if (active) setCount(null);
      });
    return () => {
      active = false;
    };
  }, [project, loadAutoArchivedCount]);

  return (
    <Dialog
      open={project !== null}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>恢复项目</DialogTitle>
          <DialogDescription asChild>
            <div>
              {project !== null && (
                <>
                  <p>是否同时恢复因该项目归档而自动归档的任务？</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {count === null
                      ? `恢复「${project.name}」。手动归档的任务在两种选择下都会继续保持归档。`
                      : `恢复「${project.name}」。该项目有 ${String(count)} 个任务因项目归档被自动归档；手动归档的任务在两种选择下都会继续保持归档。`}
                  </p>
                </>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (project !== null) onConfirm(project, false);
            }}
          >
            仅恢复项目
          </Button>
          <Button
            onClick={() => {
              if (project !== null) onConfirm(project, true);
            }}
          >
            恢复项目和任务
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
