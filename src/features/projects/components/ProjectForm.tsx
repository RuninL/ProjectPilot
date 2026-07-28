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
import { PROJECT_STATUS_OPTIONS } from '@/lib/labels';
import { projectInputSchema, type ProjectInput } from '@/services/schemas';
import type { Project, ProjectStatus } from '@/types';

/** Raw form state: every control is a string, exactly as the DOM produces it. */
interface ProjectFormValues {
  name: string;
  description: string;
  status: ProjectStatus;
  color: string;
  start_date: string;
  target_end_date: string;
}

const DEFAULT_COLOR = '#6366f1';

function toFormValues(project: Project | null): ProjectFormValues {
  return {
    name: project?.name ?? '',
    description: project?.description ?? '',
    status: project?.status ?? 'active',
    color: project?.color ?? DEFAULT_COLOR,
    start_date: project?.start_date ?? '',
    target_end_date: project?.target_end_date ?? '',
  };
}

interface ProjectFormProps {
  open: boolean;
  project: Project | null;
  onSubmit: (input: ProjectInput) => Promise<void>;
  onClose: () => void;
}

/**
 * Create/edit dialog. The same Zod schema validates here and again inside the
 * service, so the inline messages always match what the write layer accepts.
 */
export function ProjectForm({ open, project, onSubmit, onClose }: ProjectFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProjectFormValues>({
    // `raw` keeps the untransformed string values in the submit handler, so the
    // schema's coercions run exactly once — on the raw input — below.
    resolver: zodResolver(projectInputSchema, undefined, { raw: true }),
    defaultValues: toFormValues(project),
  });

  // Reopening for a different project must not show the previous one's values.
  useEffect(() => {
    if (open) {
      reset(toFormValues(project));
    }
  }, [open, project, reset]);

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(projectInputSchema.parse(values));
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
          <DialogTitle>{project === null ? '新建项目' : '编辑项目'}</DialogTitle>
          <DialogDescription>项目信息保存在本机数据库，不会上传到任何服务器。</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            void submit(event);
          }}
          noValidate
        >
          <div className="grid gap-1.5">
            <Label htmlFor="project-name">项目名称</Label>
            <Input id="project-name" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="project-description">项目描述</Label>
            <Textarea id="project-description" rows={3} {...register('description')} />
            {errors.description && (
              <p className="text-sm text-destructive">{errors.description.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="project-status">状态</Label>
              <select
                id="project-status"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                {...register('status')}
              >
                {PROJECT_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="project-color">颜色</Label>
              <Input id="project-color" type="color" className="h-10 p-1" {...register('color')} />
              {errors.color && <p className="text-sm text-destructive">{errors.color.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="project-start-date">开始日期</Label>
              <Input id="project-start-date" type="date" {...register('start_date')} />
              {errors.start_date && (
                <p className="text-sm text-destructive">{errors.start_date.message}</p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="project-target-end-date">目标结束日期</Label>
              <Input id="project-target-end-date" type="date" {...register('target_end_date')} />
              {errors.target_end_date && (
                <p className="text-sm text-destructive">{errors.target_end_date.message}</p>
              )}
            </div>
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
