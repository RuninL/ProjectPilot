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
import { getRecurrenceService } from '@/services/recurrence.service';
import { recurrenceRuleInputSchema, type RecurrenceRuleInput } from '@/services/schemas';
import type { Project, RecurrenceRule } from '@/types';
import { MeetingTaskSelector } from './MeetingTaskSelector';

const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;
const SELECT_CLASS =
  'h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

interface Values {
  kind: 'meeting';
  project_id: string;
  title: string;
  byweekday: string;
  interval: string;
  start_date: string;
  end_date: string;
  time_of_day: string;
  note: string;
  meeting_url: string;
}

function initial(rule: RecurrenceRule | null, defaultProjectId: string | null): Values {
  return {
    kind: 'meeting',
    project_id: rule?.project_id ?? defaultProjectId ?? '',
    title: rule?.title ?? '',
    byweekday: rule === null ? '' : String(rule.byweekday),
    interval: String(rule?.interval ?? 1),
    start_date: rule?.start_date ?? '',
    end_date: rule?.end_date ?? '',
    time_of_day: rule?.time_of_day ?? '',
    note: rule?.note ?? '',
    meeting_url: rule?.meeting_url ?? '',
  };
}

interface Props {
  open: boolean;
  rule: RecurrenceRule | null;
  projects: readonly Project[];
  defaultProjectId?: string | null;
  lockProject?: boolean;
  onSubmit: (input: RecurrenceRuleInput, taskIds: readonly string[]) => Promise<void>;
  onClose: () => void;
}

export function RecurrenceRuleForm({
  open,
  rule,
  projects,
  defaultProjectId = null,
  lockProject = false,
  onSubmit,
  onClose,
}: Props) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(recurrenceRuleInputSchema, undefined, { raw: true }),
    defaultValues: initial(rule, defaultProjectId),
  });
  const [selectedTaskIds, setSelectedTaskIds] = useState<readonly string[]>([]);
  const [seriesMeetingId, setSeriesMeetingId] = useState<string | null | undefined>(null);

  useEffect(() => {
    if (!open) return;
    reset(initial(rule, defaultProjectId));
    setSelectedTaskIds([]);
    if (rule === null) {
      setSeriesMeetingId(null);
      return;
    }
    let active = true;
    setSeriesMeetingId(undefined);
    void getRecurrenceService()
      .then((service) => service.getMeetingSeriesAnchor(rule.id))
      .then((meeting) => {
        if (active) setSeriesMeetingId(meeting.id);
      })
      .catch((caught: unknown) => {
        if (active) setError('root', { message: toAppError(caught).message });
      });
    return () => {
      active = false;
    };
  }, [defaultProjectId, open, reset, rule, setError]);

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(recurrenceRuleInputSchema.parse(values), selectedTaskIds);
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
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule === null ? '创建周期会议' : '编辑周期会议'}</DialogTitle>
          <DialogDescription>
            重复设置会保存会议主题、议程和时间，并直接显示在日历中。
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <input type="hidden" {...register('kind')} />
          <div className="grid gap-1.5">
            <Label htmlFor="recurrence-topic">会议主题</Label>
            <Input id="recurrence-topic" {...register('title')} />
            {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
          </div>
          {seriesMeetingId !== undefined && (
            <MeetingTaskSelector
              meetingId={seriesMeetingId}
              selectedTaskIds={selectedTaskIds}
              onSelectedTaskIdsChange={setSelectedTaskIds}
              context="series"
            />
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="recurrence-project">所属项目</Label>
            <select
              id="recurrence-project"
              className={SELECT_CLASS}
              disabled={lockProject}
              {...register('project_id')}
            >
              <option value="">独立会议（不关联项目）</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="recurrence-weekday">每周星期</Label>
              <select id="recurrence-weekday" className={SELECT_CLASS} {...register('byweekday')}>
                <option value="">请选择星期</option>
                {weekdays.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </select>
              {errors.byweekday && (
                <p className="text-sm text-destructive">{errors.byweekday.message}</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="recurrence-interval">间隔周数</Label>
              <Input id="recurrence-interval" type="number" min="1" {...register('interval')} />
              {errors.interval && (
                <p className="text-sm text-destructive">{errors.interval.message}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="recurrence-start">开始日期</Label>
              <Input id="recurrence-start" type="date" {...register('start_date')} />
              {errors.start_date && (
                <p className="text-sm text-destructive">{errors.start_date.message}</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="recurrence-end">结束日期</Label>
              <Input id="recurrence-end" type="date" {...register('end_date')} />
              {errors.end_date && (
                <p className="text-sm text-destructive">{errors.end_date.message}</p>
              )}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="recurrence-time">开始时间（可选）</Label>
            <Input id="recurrence-time" type="time" {...register('time_of_day')} />
            {errors.time_of_day && (
              <p className="text-sm text-destructive">{errors.time_of_day.message}</p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="recurrence-url">在线会议链接（可选）</Label>
            <Input
              id="recurrence-url"
              type="text"
              placeholder="例如：www.example.com 或 https://example.com"
              {...register('meeting_url')}
            />
            {errors.meeting_url && (
              <p className="text-sm text-destructive">{errors.meeting_url.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              可直接输入网址，无需填写 http:// 或 https://
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="recurrence-agenda">议程模板</Label>
            <Textarea id="recurrence-agenda" rows={3} {...register('note')} />
            {errors.note && <p className="text-sm text-destructive">{errors.note.message}</p>}
          </div>
          {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              保存规则
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
