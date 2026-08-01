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
import { parseAttendees } from '@/services/meeting.service';
import { meetingInputSchema, type MeetingInput } from '@/services/schemas';
import type { Meeting, Project } from '@/types';
import { MeetingParticipantSelector } from './MeetingParticipantSelector';
import { MeetingTaskSelector } from './MeetingTaskSelector';

/** Raw form state: every control is a string, exactly as the DOM produces it. */
interface MeetingFormValues {
  project_id: string;
  topic: string;
  date: string;
  start_time: string;
  attendees: string;
  agenda: string;
  notes: string;
  decisions: string;
  risks: string;
  meeting_url: string;
}

const SELECT_CLASS =
  'h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

function toFormValues(meeting: Meeting | null, defaultProjectId: string | null): MeetingFormValues {
  if (meeting === null) {
    return {
      project_id: defaultProjectId ?? '',
      topic: '',
      date: '',
      start_time: '',
      attendees: '',
      agenda: '',
      notes: '',
      decisions: '',
      risks: '',
      meeting_url: '',
    };
  }
  return {
    project_id: meeting.project_id ?? '',
    topic: meeting.topic,
    date: meeting.date,
    start_time: meeting.start_time ?? '',
    // One name per line is the friendliest round-trip of the stored JSON array.
    attendees: parseAttendees(meeting.attendees).join('\n'),
    agenda: meeting.agenda,
    notes: meeting.notes,
    decisions: meeting.decisions,
    risks: meeting.risks,
    meeting_url: meeting.meeting_url ?? '',
  };
}

interface MeetingFormProps {
  open: boolean;
  meeting: Meeting | null;
  projects: readonly Project[];
  /** Preselected project when creating from inside a project. */
  defaultProjectId: string | null;
  /** True when the meeting belongs to a project that must not be changed here. */
  lockProject: boolean;
  onSubmit: (input: MeetingInput, taskIds: readonly string[]) => Promise<void>;
  onClose: () => void;
}

/**
 * Create/edit dialog for a meeting. The project is optional on purpose — a 1:1 or
 * a cross-project review is a legitimate standalone meeting, and the conversion
 * flow asks for a target project later rather than forcing one now.
 */
export function MeetingForm({
  open,
  meeting,
  projects,
  defaultProjectId,
  lockProject,
  onSubmit,
  onClose,
}: MeetingFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<MeetingFormValues>({
    resolver: zodResolver(meetingInputSchema, undefined, { raw: true }),
    defaultValues: toFormValues(meeting, defaultProjectId),
  });
  const [selectedTaskIds, setSelectedTaskIds] = useState<readonly string[]>([]);

  useEffect(() => {
    if (open) {
      reset(toFormValues(meeting, defaultProjectId));
      setSelectedTaskIds([]);
    }
  }, [open, meeting, defaultProjectId, reset]);

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(meetingInputSchema.parse(values), selectedTaskIds);
      onClose();
    } catch (caught) {
      setError('root', { message: toAppError(caught).message });
    }
  });
  const attendeeNames = watch('attendees')
    .split(/[\n,，]/)
    .map((name) => name.trim())
    .filter((name, index, names) => name !== '' && names.indexOf(name) === index);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{meeting === null ? '新建会议' : '编辑会议'}</DialogTitle>
          <DialogDescription>
            会议记录保存在本机数据库。未选择项目时视为独立会议，行动项转任务时再指定项目。
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
            <Label htmlFor="meeting-topic">会议主题</Label>
            <Input id="meeting-topic" {...register('topic')} />
            {errors.topic && <p className="text-sm text-destructive">{errors.topic.message}</p>}
          </div>

          <MeetingTaskSelector
            meetingId={meeting?.id ?? null}
            selectedTaskIds={selectedTaskIds}
            onSelectedTaskIdsChange={setSelectedTaskIds}
          />

          <div className="grid gap-1.5">
            <Label htmlFor="meeting-project">所属项目</Label>
            <select
              id="meeting-project"
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
            {errors.project_id && (
              <p className="text-sm text-destructive">{errors.project_id.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="meeting-date">会议日期</Label>
              <Input id="meeting-date" type="date" {...register('date')} />
              {errors.date && <p className="text-sm text-destructive">{errors.date.message}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="meeting-start-time">开始时间</Label>
              <Input id="meeting-start-time" type="time" {...register('start_time')} />
              {errors.start_time && (
                <p className="text-sm text-destructive">{errors.start_time.message}</p>
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="meeting-url">在线会议链接（可选）</Label>
            <Input
              id="meeting-url"
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
            <Label htmlFor="meeting-attendees">参与者</Label>
            <Textarea
              id="meeting-attendees"
              className="sr-only"
              rows={1}
              {...register('attendees')}
            />
            <MeetingParticipantSelector
              selectedNames={attendeeNames}
              onChange={(names) => {
                setValue('attendees', names.join('\n'), {
                  shouldDirty: true,
                  shouldValidate: true,
                });
              }}
            />
            {errors.attendees && (
              <p className="text-sm text-destructive">{errors.attendees.message}</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="meeting-agenda">议程</Label>
            <Textarea id="meeting-agenda" rows={2} {...register('agenda')} />
            {errors.agenda && <p className="text-sm text-destructive">{errors.agenda.message}</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="meeting-notes">会议纪要</Label>
            <Textarea id="meeting-notes" rows={4} {...register('notes')} />
            {errors.notes && <p className="text-sm text-destructive">{errors.notes.message}</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="meeting-decisions">决议</Label>
            <Textarea id="meeting-decisions" rows={2} {...register('decisions')} />
            {errors.decisions && (
              <p className="text-sm text-destructive">{errors.decisions.message}</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="meeting-risks">风险</Label>
            <Textarea id="meeting-risks" rows={2} {...register('risks')} />
            {errors.risks && <p className="text-sm text-destructive">{errors.risks.message}</p>}
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
