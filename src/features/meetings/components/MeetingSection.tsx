import { CalendarDays, Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toAppError } from '@/lib/errors';
import { useMeetingStore } from '@/stores/useMeetingStore';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { useRecurrenceStore } from '@/stores/useRecurrenceStore';
import type { Meeting, Project, RecurrenceRule } from '@/types';
import { MeetingForm } from './MeetingForm';
import { RecurrenceRuleForm } from './RecurrenceRuleForm';

interface PendingDelete {
  meeting: Meeting;
  actionItemCount: number;
}

interface MeetingSectionProps {
  project: Project;
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

function recurrenceSummary(rule: RecurrenceRule): string {
  const weekday = WEEKDAY_LABELS[rule.byweekday] ?? '未知星期';
  const frequency = rule.interval === 1 ? `每${weekday}` : `每${String(rule.interval)}周${weekday}`;
  return `${frequency}${rule.time_of_day === null ? '' : ` ${rule.time_of_day}`}，至 ${rule.end_date ?? '未设置'}`;
}

/**
 * One project's meetings. Archiving a project does not close its meetings — a
 * retrospective about finished work is still worth recording — so this section
 * stays editable; what the archive blocks is creating tasks from an action item.
 */
export function MeetingSection({ project }: MeetingSectionProps) {
  const meetings = useMeetingStore((state) => state.meetings);
  const loading = useMeetingStore((state) => state.loading);
  const error = useMeetingStore((state) => state.error);
  const loadMeetings = useMeetingStore((state) => state.loadMeetings);
  const createMeeting = useMeetingStore((state) => state.createMeeting);
  const updateMeeting = useMeetingStore((state) => state.updateMeeting);
  const deleteMeeting = useMeetingStore((state) => state.deleteMeeting);
  const countActionItems = useMeetingStore((state) => state.countActionItems);
  const createRule = useRecurrenceStore((state) => state.createRule);
  const rules = useRecurrenceStore((state) => state.rules);
  const loadRules = useRecurrenceStore((state) => state.loadRules);
  const refreshCalendar = useCalendarStore((state) => state.load);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [busy, setBusy] = useState(false);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [createChoiceOpen, setCreateChoiceOpen] = useState(false);
  const [ruleFormOpen, setRuleFormOpen] = useState(false);

  useEffect(() => {
    void loadMeetings();
    void loadRules();
  }, [loadMeetings, loadRules]);

  const projectMeetings = useMemo(
    () =>
      meetings
        .filter(
          (meeting) =>
            meeting.project_id === project.id &&
            !(meeting.source_rule_id !== null && meeting.source_occurrence_date === null),
        )
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            (a.start_time === null
              ? 1
              : b.start_time === null
                ? -1
                : a.start_time.localeCompare(b.start_time)) ||
            a.topic.localeCompare(b.topic, 'zh-CN', { sensitivity: 'base' }),
        ),
    [meetings, project.id],
  );
  const projectRules = useMemo(
    () =>
      rules
        .filter((rule) => rule.project_id === project.id && rule.kind === 'meeting')
        .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN', { sensitivity: 'base' })),
    [project.id, rules],
  );

  const askDelete = useCallback(
    (meeting: Meeting): void => {
      setSectionError(null);
      void countActionItems(meeting.id)
        .then((actionItemCount) => {
          setPendingDelete({ meeting, actionItemCount });
        })
        .catch((caught: unknown) => {
          setSectionError(toAppError(caught).message);
        });
    },
    [countActionItems],
  );

  const confirmDelete = (): void => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (target === null) {
      return;
    }
    setBusy(true);
    void deleteMeeting(target.meeting.id)
      .catch((caught: unknown) => {
        setSectionError(toAppError(caught).message);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  if (loading && meetings.length === 0) {
    return <LoadingState label="正在加载会议…" />;
  }

  if (error !== null && meetings.length === 0) {
    return (
      <ErrorState
        title="无法加载会议"
        message={error}
        onRetry={() => {
          void loadMeetings();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          会议纪要与行动项归属本项目；行动项可转为本项目的任务。
        </p>
        <Button
          size="sm"
          onClick={() => {
            setCreateChoiceOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden />
          新建会议
        </Button>
      </div>

      {sectionError !== null && <p className="text-sm text-destructive">{sectionError}</p>}

      {projectRules.length === 0 && projectMeetings.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          该项目暂无会议记录。新建会议后可以记录纪要、决议与行动项。
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          {projectRules.length > 0 && (
            <ul className="divide-y">
              {projectRules.map((rule) => (
                <li key={rule.id} className="bg-recurrence-background p-3">
                  <Link
                    to={`/meetings?series=${encodeURIComponent(rule.id)}`}
                    className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <p className="text-sm font-medium text-recurrence">
                      {`${rule.title} [周期会议]`}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{recurrenceSummary(rule)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {projectMeetings.length > 0 && (
            <ul className="divide-y">
              {projectMeetings.map((meeting) => (
                <li
                  key={meeting.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0">
                    <Link
                      to={`/meetings/${meeting.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {meeting.topic}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                        {meeting.date}
                      </span>
                      {meeting.start_time !== null && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" aria-hidden />
                          {meeting.start_time}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/meetings/${meeting.id}`}>打开</Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`编辑会议：${meeting.topic}`}
                      disabled={busy}
                      onClick={() => {
                        setEditing(meeting);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`删除会议：${meeting.topic}`}
                      disabled={busy}
                      onClick={() => {
                        askDelete(meeting);
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <MeetingForm
        open={formOpen}
        meeting={editing}
        projects={[project]}
        defaultProjectId={project.id}
        lockProject
        onSubmit={async (input, taskIds) => {
          if (editing === null) {
            await createMeeting(input, taskIds);
          } else {
            await updateMeeting(editing.id, input);
          }
          await refreshCalendar();
        }}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />
      <Dialog open={createChoiceOpen} onOpenChange={setCreateChoiceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建会议</DialogTitle>
            <DialogDescription>请选择普通会议或周期会议。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateChoiceOpen(false);
                setRuleFormOpen(true);
              }}
            >
              周期会议
            </Button>
            <Button
              onClick={() => {
                setCreateChoiceOpen(false);
                setEditing(null);
                setFormOpen(true);
              }}
            >
              普通会议
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RecurrenceRuleForm
        open={ruleFormOpen}
        rule={null}
        projects={[project]}
        defaultProjectId={project.id}
        lockProject
        onSubmit={async (input, taskIds) => {
          await createRule(input, taskIds);
          await loadMeetings();
          await loadRules();
          await refreshCalendar();
        }}
        onClose={() => {
          setRuleFormOpen(false);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除会议"
        description={
          pendingDelete === null
            ? ''
            : `确定删除会议「${pendingDelete.meeting.topic}」吗？该会议的 ${String(pendingDelete.actionItemCount)} 个行动项会一并删除，已转换出的任务会保留。此操作不可撤销。`
        }
        confirmLabel="删除"
        destructive
        busy={busy}
        onCancel={() => {
          setPendingDelete(null);
        }}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
