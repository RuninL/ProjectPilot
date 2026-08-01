import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SavedOrderControls } from '@/features/sorting/SavedOrderControls';
import { ReorderHandle } from '@/features/sorting/ReorderHandle';
import { useSavedListOrder } from '@/features/sorting/useSavedListOrder';
import { ProjectLinkForm } from '@/features/links/components/ProjectLinkForm';
import { toAppError } from '@/lib/errors';
import { getProjectLinkService } from '@/services/projectLink.service';
import type { ProjectLink, Task } from '@/types';

interface Props {
  task: Task;
  projectTasks: readonly Task[];
}

export function TaskResourcesSection({ task, projectTasks }: Props) {
  const [links, setLinks] = useState<ProjectLink[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedOrder = useSavedListOrder('task_resources', task.id, links);
  const load = useCallback(async () => {
    const service = await getProjectLinkService();
    setLinks(
      (await service.listProjectLinks(task.project_id)).filter((link) => link.task_id === task.id),
    );
  }, [task.id, task.project_id]);

  useEffect(() => {
    void load().catch((caught: unknown) => {
      setError(toAppError(caught).message);
    });
  }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">文件与链接</h2>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden />
          添加
        </Button>
      </div>
      <SavedOrderControls controller={savedOrder} disabledReason={null} />
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有关联文件或链接。</p>
      ) : (
        <ul className="space-y-2">
          {savedOrder.displayedItems.map((link) => (
            <li key={link.id} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="font-medium">{link.label}</p>
                <p className="text-xs text-muted-foreground">{link.target}</p>
              </div>
              <div className="flex gap-1">
                {savedOrder.mode !== 'dynamic' && (
                  <ReorderHandle
                    label={link.label}
                    disabled={false}
                    onMoveUp={() => {
                      savedOrder.move(link.id, -1);
                    }}
                    onMoveDown={() => {
                      savedOrder.move(link.id, 1);
                    }}
                  />
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    void getProjectLinkService()
                      .then((service) => service.openProjectLink(task.project_id, link.id))
                      .catch((caught: unknown) => {
                        setError(toAppError(caught).message);
                      });
                  }}
                >
                  <ExternalLink className="h-4 w-4" aria-hidden />
                  打开
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`编辑 ${link.label}`}
                  onClick={() => {
                    setEditing(link);
                    setFormOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`删除 ${link.label}`}
                  onClick={() => {
                    void getProjectLinkService()
                      .then((service) => service.deleteProjectLink(task.project_id, link.id))
                      .then(load)
                      .catch((caught: unknown) => {
                        setError(toAppError(caught).message);
                      });
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ProjectLinkForm
        open={formOpen}
        link={editing}
        tasks={projectTasks}
        taskId={task.id}
        lockTask
        onSubmit={async (input) => {
          const service = await getProjectLinkService();
          if (editing === null) {
            await service.createProjectLink(task.project_id, input);
          } else {
            await service.updateProjectLink(task.project_id, editing.id, input);
          }
          await load();
        }}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />
    </section>
  );
}
