import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
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
import { MILESTONE_STATUS_OPTIONS } from '@/lib/labels';
import { milestoneInputSchema, type MilestoneInput } from '@/services/schemas';
import type { Milestone, MilestoneStatus, Task } from '@/types';

interface MilestoneFormValues {
  project_id: string;
  linked_task_id: string;
  name: string;
  description: string;
  date: string;
  status: MilestoneStatus;
}

function toFormValues(milestone: Milestone | null, projectId: string): MilestoneFormValues {
  return {
    project_id: projectId,
    linked_task_id: milestone?.linked_task_id ?? '',
    name: milestone?.name ?? '',
    description: milestone?.description ?? '',
    date: milestone?.date ?? '',
    status: milestone?.status ?? 'upcoming',
  };
}

interface MilestoneFormProps {
  open: boolean;
  milestone: Milestone | null;
  projectId: string;
  /** Candidate links — a milestone may only point at a task in its own project. */
  tasks: readonly Pick<Task, 'id' | 'title'>[];
  onSubmit: (input: MilestoneInput) => Promise<void>;
  onClose: () => void;
}

export function MilestoneForm({
  open,
  milestone,
  projectId,
  tasks,
  onSubmit,
  onClose,
}: MilestoneFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<MilestoneFormValues>({
    resolver: zodResolver(milestoneInputSchema, undefined, { raw: true }),
    defaultValues: toFormValues(milestone, projectId),
  });

  useEffect(() => {
    if (open) {
      reset(toFormValues(milestone, projectId));
    }
  }, [open, milestone, projectId, reset]);

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(milestoneInputSchema.parse(values));
      onClose();
    } catch (caught) {
      setError('root', { message: toAppError(caught).message });
    }
  });

  const selectClass =
    'h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

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
          <DialogTitle>{milestone === null ? '新建里程碑' : '编辑里程碑'}</DialogTitle>
          <DialogDescription>
            里程碑状态始终由你决定：关联任务完成时只会询问，不会自动改状态。
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            void submit(event);
          }}
          noValidate
        >
          <input type="hidden" {...register('project_id')} />

          <div className="grid gap-1.5">
            <Label htmlFor="milestone-name">里程碑名称</Label>
            <Input id="milestone-name" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="milestone-date">目标日期</Label>
              <Input id="milestone-date" type="date" {...register('date')} />
              {errors.date && <p className="text-sm text-destructive">{errors.date.message}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="milestone-status">状态</Label>
              <select id="milestone-status" className={selectClass} {...register('status')}>
                {MILESTONE_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="milestone-linked-task">关联任务</Label>
            <select
              id="milestone-linked-task"
              className={selectClass}
              {...register('linked_task_id')}
            >
              <option value="">不关联任务</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
            {errors.linked_task_id && (
              <p className="text-sm text-destructive">{errors.linked_task_id.message}</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="milestone-description">说明</Label>
            <Textarea id="milestone-description" rows={3} {...register('description')} />
            {errors.description && (
              <p className="text-sm text-destructive">{errors.description.message}</p>
            )}
          </div>

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
