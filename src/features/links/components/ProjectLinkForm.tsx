import { zodResolver } from '@hookform/resolvers/zod';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
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
import { projectLinkInputSchema, type ProjectLinkInput } from '@/services/schemas';
import type { LinkType, ProjectLink } from '@/types';

interface ProjectLinkFormValues {
  label: string;
  link_type: LinkType;
  target: string;
  description: string;
}

function toFormValues(link: ProjectLink | null): ProjectLinkFormValues {
  return {
    label: link?.label ?? '',
    link_type: link?.link_type ?? 'url',
    target: link?.target ?? '',
    description: link?.description ?? '',
  };
}

interface ProjectLinkFormProps {
  open: boolean;
  link: ProjectLink | null;
  onSubmit: (input: ProjectLinkInput) => Promise<void>;
  onClose: () => void;
}

export function ProjectLinkForm({ open, link, onSubmit, onClose }: ProjectLinkFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProjectLinkFormValues>({
    resolver: zodResolver(projectLinkInputSchema, undefined, { raw: true }),
    defaultValues: toFormValues(link),
  });
  const linkType = watch('link_type');
  const targetLabel = linkType === 'url' ? 'URL 地址' : '本地文件或目录路径';
  const targetPlaceholder =
    linkType === 'url' ? 'https://example.com/document' : 'C:\\项目资料\\方案.pdf';

  const browseLocalPath = async (directory: boolean) => {
    try {
      const selected = await openFileDialog({
        title: directory ? '选择目录' : '选择文件',
        multiple: false,
        directory,
      });
      if (typeof selected === 'string') {
        setValue('target', selected, { shouldValidate: true, shouldDirty: true });
      }
    } catch (caught) {
      setError('root', { message: toAppError(caught).message });
    }
  };

  useEffect(() => {
    if (open) {
      reset(toFormValues(link));
    }
  }, [link, open, reset]);

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(projectLinkInputSchema.parse(values));
      onClose();
    } catch (caught) {
      setError('root', { message: toAppError(caught).message });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{link === null ? '新增链接' : '编辑文件与链接'}</DialogTitle>
          <DialogDescription>
            这里只保存 URL 或本机路径，不会上传、复制或读取文件内容。
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            void submit(event);
          }}
          noValidate
        >
          <div className="grid gap-1.5">
            <Label htmlFor="project-link-label">资料名称</Label>
            <Input id="project-link-label" placeholder="例如：需求文档" {...register('label')} />
            {errors.label && <p className="text-sm text-destructive">{errors.label.message}</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="project-link-type">类型</Label>
            <select
              id="project-link-type"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              {...register('link_type')}
            >
              <option value="url">网页链接</option>
              <option value="file_path">本地文件或目录</option>
            </select>
            {errors.link_type && (
              <p className="text-sm text-destructive">{errors.link_type.message}</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="project-link-target">{targetLabel}</Label>
            <Input
              id="project-link-target"
              placeholder={targetPlaceholder}
              {...register('target')}
            />
            {linkType === 'file_path' && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => void browseLocalPath(false)}
                >
                  浏览文件…
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => void browseLocalPath(true)}
                >
                  浏览目录…
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {linkType === 'url'
                ? '只有 http/https 链接可直接打开，其他协议仅可复制。'
                : '可点击「浏览」直接选择本机文件或目录，也可手动输入绝对路径；打开前会先检查文件或目录是否存在。'}
            </p>
            {errors.target && <p className="text-sm text-destructive">{errors.target.message}</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="project-link-description">备注（可选）</Label>
            <Textarea
              id="project-link-description"
              rows={3}
              placeholder="补充资料用途或使用说明"
              {...register('description')}
            />
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
              {isSubmitting ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
