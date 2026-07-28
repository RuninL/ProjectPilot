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
import { Label } from '@/components/ui/label';
import type { ActionItem, Project } from '@/types';

interface ConvertToTaskDialogProps {
  /** Non-null only while a standalone meeting's item is waiting for a project. */
  item: ActionItem | null;
  projects: readonly Project[];
  busy: boolean;
  onConfirm: (projectId: string) => void;
  onCancel: () => void;
}

/**
 * Target-project picker, shown only when the meeting itself has no project. A
 * conversion cannot invent an owner for the new task, so the user is asked rather
 * than silently defaulted; cancelling here converts nothing at all.
 */
export function ConvertToTaskDialog({
  item,
  projects,
  busy,
  onConfirm,
  onCancel,
}: ConvertToTaskDialogProps) {
  const [projectId, setProjectId] = useState('');

  // A fresh prompt must never inherit the previous item's choice.
  useEffect(() => {
    if (item !== null) {
      setProjectId('');
    }
  }, [item]);

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(next) => {
        if (!next) {
          onCancel();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>选择任务所属项目</DialogTitle>
          <DialogDescription>
            该会议未关联项目，请选择新任务要归属的项目。已归档的项目无法新建任务。
          </DialogDescription>
        </DialogHeader>

        {item !== null && (
          <p className="rounded-md border bg-muted/30 p-3 text-sm">{item.content}</p>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="convert-project">所属项目</Label>
          <select
            id="convert-project"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            value={projectId}
            disabled={busy}
            onChange={(event) => {
              setProjectId(event.target.value);
            }}
          >
            <option value="">请选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button
            disabled={busy || projectId === ''}
            onClick={() => {
              onConfirm(projectId);
            }}
          >
            转为任务
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
