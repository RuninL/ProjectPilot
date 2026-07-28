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
import { ACTION_ITEM_STATUS_OPTIONS } from '@/lib/labels';
import { actionItemInputSchema, type ActionItemInput } from '@/services/schemas';
import type { ActionItem, ActionItemStatus } from '@/types';

interface ActionItemFormValues {
  content: string;
  owner: string;
  due_date: string;
  status: ActionItemStatus;
}

function toFormValues(item: ActionItem | null): ActionItemFormValues {
  return {
    content: item?.content ?? '',
    owner: item?.owner ?? '',
    due_date: item?.due_date ?? '',
    status: item?.status ?? 'open',
  };
}

interface ActionItemFormProps {
  open: boolean;
  item: ActionItem | null;
  onSubmit: (input: ActionItemInput) => Promise<void>;
  onClose: () => void;
}

export function ActionItemForm({ open, item, onSubmit, onClose }: ActionItemFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ActionItemFormValues>({
    resolver: zodResolver(actionItemInputSchema, undefined, { raw: true }),
    defaultValues: toFormValues(item),
  });

  useEffect(() => {
    if (open) {
      reset(toFormValues(item));
    }
  }, [open, item, reset]);

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(actionItemInputSchema.parse(values));
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
          <DialogTitle>{item === null ? '新建行动项' : '编辑行动项'}</DialogTitle>
          <DialogDescription>
            行动项属于本次会议。转为任务后，内容会作为任务标题，负责人写入任务描述。
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
            <Label htmlFor="action-item-content">行动项内容</Label>
            <Textarea id="action-item-content" rows={3} {...register('content')} />
            {errors.content && <p className="text-sm text-destructive">{errors.content.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="action-item-owner">负责人</Label>
              <Input id="action-item-owner" {...register('owner')} />
              {errors.owner && <p className="text-sm text-destructive">{errors.owner.message}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="action-item-due-date">截止日期</Label>
              <Input id="action-item-due-date" type="date" {...register('due_date')} />
              {errors.due_date && (
                <p className="text-sm text-destructive">{errors.due_date.message}</p>
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="action-item-status">状态</Label>
            <select
              id="action-item-status"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              {...register('status')}
            >
              {ACTION_ITEM_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
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
