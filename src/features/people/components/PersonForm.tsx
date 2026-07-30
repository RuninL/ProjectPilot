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
import { personInputSchema, type PersonInput } from '@/services/schemas';
import type { Person } from '@/types';

interface PersonFormValues {
  name: string;
  email: string;
  role: string;
  note: string;
}

interface PersonFormProps {
  open: boolean;
  person: Person | null;
  onSubmit: (input: PersonInput) => Promise<void>;
  onClose: () => void;
}

function valuesFor(person: Person | null): PersonFormValues {
  return {
    name: person?.name ?? '',
    email: person?.email ?? '',
    role: person?.role ?? '',
    note: person?.note ?? '',
  };
}

export function PersonForm({ open, person, onSubmit, onClose }: PersonFormProps) {
  const {
    register,
    reset,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PersonFormValues>({
    resolver: zodResolver(personInputSchema, undefined, { raw: true }),
    defaultValues: valuesFor(person),
  });

  useEffect(() => {
    if (open) {
      reset(valuesFor(person));
    }
  }, [open, person, reset]);

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(personInputSchema.parse(values));
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
          <DialogTitle>{person === null ? '新建人员' : '编辑人员'}</DialogTitle>
          <DialogDescription>姓名必填；邮箱、角色和备注仅保存在本机。</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            void submit(event);
          }}
          noValidate
        >
          <div className="grid gap-1.5">
            <Label htmlFor="person-name">姓名</Label>
            <Input id="person-name" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="person-role">角色</Label>
              <Input id="person-role" {...register('role')} />
              {errors.role && <p className="text-sm text-destructive">{errors.role.message}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="person-email">邮箱</Label>
              <Input id="person-email" type="email" {...register('email')} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="person-note">备注</Label>
            <Textarea id="person-note" rows={3} {...register('note')} />
            {errors.note && <p className="text-sm text-destructive">{errors.note.message}</p>}
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
