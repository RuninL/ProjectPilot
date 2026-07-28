import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toAppError } from '@/lib/errors';
import { TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS } from '@/lib/labels';
import { taskInputSchema, type TaskInput } from '@/services/schemas';
import type { Project, Task, TaskPriority, TaskStatus } from '@/types';

/** Raw form state: every control is a string, exactly as the DOM produces it. */
interface TaskFormValues {
  project_id: string;
  parent_task_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  start_date: string;
  due_date: string;
  progress: string;
  estimated_hours: string;
  actual_hours: string;
}

function numberToField(value: number | null): string {
  return value === null ? '' : String(value);
}

function toFormValues(task: Task | null, projectId: string): TaskFormValues {
  return {
    project_id: task?.project_id ?? projectId,
    parent_task_id: task?.parent_task_id ?? '',
    title: task?.title ?? '',
    description: task?.description ?? '',
    status: task?.status ?? 'todo',
    priority: task?.priority ?? 'medium',
    start_date: task?.start_date ?? '',
    due_date: task?.due_date ?? '',
    progress: String(task?.progress ?? 0),
    estimated_hours: numberToField(task?.estimated_hours ?? null),
    actual_hours: numberToField(task?.actual_hours ?? null),
  };
}

interface TaskFormProps {
  open: boolean;
  task: Task | null;
  /** Preselected project for a new task; ignored when editing. */
  projectId: string;
  /** Selectable projects — archived ones are excluded by the caller. */
  projects: readonly Project[];
  /** All tasks of a project, used to derive the legal parent candidates. */
  loadProjectTasks: (projectId: string) => Promise<Task[]>;
  onSubmit: (input: TaskInput) => Promise<void>;
  onClose: () => void;
}

/**
 * Create/edit dialog. Parent candidates are restricted to top-level tasks of the
 * same project, excluding the task itself; a task that already has children
 * cannot become a child, so the control is disabled in that case. The service
 * re-checks all of this — this layer only keeps illegal choices off the screen.
 */
export function TaskForm({
  open,
  task,
  projectId,
  projects,
  loadProjectTasks,
  onSubmit,
  onClose,
}: TaskFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TaskFormValues>({
    // `raw` keeps the untransformed string values in the submit handler, so the
    // schema's coercions run exactly once — on the raw input — below.
    resolver: zodResolver(taskInputSchema, undefined, { raw: true }),
    defaultValues: toFormValues(task, projectId),
  });

  const [projectTasks, setProjectTasks] = useState<Task[]>([]);
  const selectedProjectId = watch('project_id');

  useEffect(() => {
    if (open) {
      reset(toFormValues(task, projectId));
    }
  }, [open, task, projectId, reset]);

  useEffect(() => {
    if (!open || selectedProjectId === '') {
      setProjectTasks([]);
      return;
    }
    let active = true;
    void loadProjectTasks(selectedProjectId).then((loaded) => {
      if (active) {
        setProjectTasks(loaded);
      }
    });
    return () => {
      active = false;
    };
  }, [open, selectedProjectId, loadProjectTasks]);

  const hasChildren = task !== null && projectTasks.some((row) => row.parent_task_id === task.id);
  const parentCandidates = projectTasks.filter(
    (row) => row.parent_task_id === null && row.id !== task?.id,
  );

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(taskInputSchema.parse(values));
      onClose();
    } catch (caught) {
      setError('root', { message: toAppError(caught).message });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{task === null ? '新建任务' : '编辑任务'}</DialogTitle>
          <DialogDescription>任务层级最多两层，且不能跨项目设置父任务。</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            void submit(event);
          }}
          noValidate
        >
          <div className="grid gap-1.5">
            <Label htmlFor="task-project">所属项目</Label>
            <select
              id="task-project"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              disabled={task !== null}
              {...register('project_id')}
            >
              <option value="">请选择项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            {task !== null && (
              <p className="text-xs text-muted-foreground">任务不能移动到其他项目。</p>
            )}
            {errors.project_id && (
              <p className="text-sm text-destructive">{errors.project_id.message}</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="task-parent">父任务</Label>
            <select
              id="task-parent"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              disabled={hasChildren}
              {...register('parent_task_id')}
            >
              <option value="">无（作为顶层任务）</option>
              {parentCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </option>
              ))}
            </select>
            {hasChildren && (
              <p className="text-xs text-muted-foreground">
                该任务已有子任务，不能再成为其他任务的子任务。
              </p>
            )}
            {errors.parent_task_id && (
              <p className="text-sm text-destructive">{errors.parent_task_id.message}</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="task-title">任务标题</Label>
            <Input id="task-title" {...register('title')} />
            {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="task-description">任务描述</Label>
            <Textarea id="task-description" rows={3} {...register('description')} />
            {errors.description && (
              <p className="text-sm text-destructive">{errors.description.message}</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="task-status">状态</Label>
              <select
                id="task-status"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                {...register('status')}
              >
                {TASK_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="task-priority">优先级</Label>
              <select
                id="task-priority"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                {...register('priority')}
              >
                {TASK_PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="task-progress">进度（%）</Label>
              <Input id="task-progress" type="number" min={0} max={100} {...register('progress')} />
              {errors.progress && (
                <p className="text-sm text-destructive">{errors.progress.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="task-start-date">开始日期</Label>
              <Input id="task-start-date" type="date" {...register('start_date')} />
              {errors.start_date && (
                <p className="text-sm text-destructive">{errors.start_date.message}</p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="task-due-date">截止日期</Label>
              <Input id="task-due-date" type="date" {...register('due_date')} />
              {errors.due_date && (
                <p className="text-sm text-destructive">{errors.due_date.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="task-estimated-hours">预估工时</Label>
              <Input
                id="task-estimated-hours"
                type="number"
                min={0}
                step="0.5"
                {...register('estimated_hours')}
              />
              {errors.estimated_hours && (
                <p className="text-sm text-destructive">{errors.estimated_hours.message}</p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="task-actual-hours">实际工时</Label>
              <Input
                id="task-actual-hours"
                type="number"
                min={0}
                step="0.5"
                {...register('actual_hours')}
              />
              {errors.actual_hours && (
                <p className="text-sm text-destructive">{errors.actual_hours.message}</p>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            状态设为「已完成」时进度会自动记为
            100%；从「已完成」改回其他状态会清除完成时间并保留进度。
          </p>

          {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
