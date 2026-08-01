import { ArrowLeft, CalendarDays, Clock, Copy, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { SampleBadge } from '@/components/common/SampleBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toAppError } from '@/lib/errors';
import { getMeetingService, parseAttendees } from '@/services/meeting.service';
import { useMeetingStore } from '@/stores/useMeetingStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { Project } from '@/types';
import { ActionItemSection } from '../components/ActionItemSection';
import { MeetingForm } from '../components/MeetingForm';

interface NoteBlock {
  title: string;
  body: string;
}

export function MeetingDetailPage() {
  const params = useParams<{ meetingId: string }>();
  const meetingId = params.meetingId ?? '';
  const navigate = useNavigate();

  const meeting = useMeetingStore((state) => state.current);
  const actionItems = useMeetingStore((state) => state.actionItems);
  const actionItemCount = useMeetingStore((state) => state.actionItemCount);
  const loading = useMeetingStore((state) => state.loading);
  const error = useMeetingStore((state) => state.error);
  const loadMeeting = useMeetingStore((state) => state.loadMeeting);
  const updateMeeting = useMeetingStore((state) => state.updateMeeting);
  const deleteMeeting = useMeetingStore((state) => state.deleteMeeting);
  const createActionItem = useMeetingStore((state) => state.createActionItem);
  const updateActionItem = useMeetingStore((state) => state.updateActionItem);
  const deleteActionItem = useMeetingStore((state) => state.deleteActionItem);
  const convertActionItem = useMeetingStore((state) => state.convertActionItem);

  const projectOptions = useProjectStore((state) => state.options);
  const loadOptions = useProjectStore((state) => state.loadOptions);
  const getProject = useProjectStore((state) => state.getProject);

  const [project, setProject] = useState<Project | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    void loadMeeting(meetingId);
    void loadOptions();
  }, [loadMeeting, loadOptions, meetingId]);

  // The meeting's project may be archived and therefore absent from the select
  // options, so its name is read directly rather than looked up in that list.
  useEffect(() => {
    const projectId = meeting?.project_id ?? null;
    if (projectId === null) {
      setProject(null);
      return;
    }
    let active = true;
    void getProject(projectId)
      .then((loaded) => {
        if (active) {
          setProject(loaded);
        }
      })
      .catch(() => {
        if (active) {
          setProject(null);
        }
      });
    return () => {
      active = false;
    };
  }, [getProject, meeting?.project_id]);

  if (loading && meeting === null) {
    return (
      <div className="p-6">
        <LoadingState label="正在加载会议…" />
      </div>
    );
  }

  if (meeting === null) {
    return (
      <div className="p-6">
        <ErrorState
          title="无法打开会议"
          message={error ?? '会议不存在或已被删除'}
          onRetry={() => {
            void loadMeeting(meetingId);
          }}
        />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" asChild>
            <Link to="/meetings">返回会议列表</Link>
          </Button>
        </div>
      </div>
    );
  }

  const attendees = parseAttendees(meeting.attendees);
  const notes: NoteBlock[] = [
    { title: '议程', body: meeting.agenda },
    { title: '会议纪要', body: meeting.notes },
    { title: '决议', body: meeting.decisions },
    { title: '风险', body: meeting.risks },
  ];

  return (
    <div className="p-6">
      <Link
        to="/meetings"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        返回会议列表
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{meeting.topic}</h1>
            {meeting.is_sample === 1 && <SampleBadge />}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-4 w-4" aria-hidden />
              {meeting.date}
            </span>
            {meeting.start_time !== null && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-4 w-4" aria-hidden />
                {meeting.start_time}
              </span>
            )}
            {meeting.project_id === null ? (
              <Badge variant="outline">独立会议</Badge>
            ) : (
              <Link to={`/projects/${meeting.project_id}`} className="hover:underline">
                <Badge variant="outline">{project?.name ?? '所属项目'}</Badge>
              </Link>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {meeting.meeting_url !== null && (
            <>
              <Button
                onClick={() => {
                  setActionError(null);
                  void getMeetingService()
                    .then((service) => service.openMeetingUrl(meeting.id))
                    .catch((caught: unknown) => { setActionError(toAppError(caught).message); });
                }}
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                加入会议
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(meeting.meeting_url ?? '')
                    .catch(() => { setActionError('无法复制会议链接'); });
                }}
              >
                <Copy className="h-4 w-4" aria-hidden />
                复制链接
              </Button>
            </>
          )}
          <Button
            variant="outline"
            onClick={() => {
              setFormOpen(true);
            }}
          >
            <Pencil className="h-4 w-4" aria-hidden />
            编辑
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setDeleteOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            删除
          </Button>
        </div>
      </header>

      {actionError !== null && <p className="mb-4 text-sm text-destructive">{actionError}</p>}

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-medium">参与者</h2>
        {attendees.length === 0 ? (
          <p className="text-sm text-muted-foreground">未记录参与者</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {attendees.map((name) => (
              <li key={name}>
                <Badge variant="secondary">{name}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        {notes.map((block) => (
          <section key={block.title} className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium">{block.title}</h2>
            {block.body === '' ? (
              <p className="mt-1 text-sm text-muted-foreground">未填写</p>
            ) : (
              <p className="mt-1 whitespace-pre-wrap text-sm">{block.body}</p>
            )}
          </section>
        ))}
      </div>

      <section id="meeting-action-items">
        <h2 className="mb-3 text-lg font-medium">{`行动项（${String(actionItems.length)}）`}</h2>
        <ActionItemSection
          items={actionItems}
          meetingProjectId={meeting.project_id}
          projects={projectOptions}
          onCreate={(input) => createActionItem(meeting.id, input)}
          onUpdate={(id, input) => updateActionItem(id, input, meeting.id)}
          onDelete={(id) => deleteActionItem(id, meeting.id)}
          onConvert={(id, projectId) =>
            convertActionItem(id, meeting.id, { project_id: projectId })
          }
        />
      </section>

      <MeetingForm
        open={formOpen}
        meeting={meeting}
        projects={projectOptions}
        defaultProjectId={meeting.project_id}
        lockProject={false}
        onSubmit={async (input) => {
          await updateMeeting(meeting.id, input);
        }}
        onClose={() => {
          setFormOpen(false);
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="删除会议"
        description={`确定删除会议「${meeting.topic}」吗？该会议的 ${String(actionItemCount)} 个行动项会一并删除，已转换出的任务会保留。此操作不可撤销。`}
        confirmLabel="删除"
        destructive
        busy={busy}
        onCancel={() => {
          setDeleteOpen(false);
        }}
        onConfirm={() => {
          setDeleteOpen(false);
          setBusy(true);
          void deleteMeeting(meeting.id)
            .then(() => {
              navigate('/meetings');
            })
            .catch((caught: unknown) => {
              setActionError(toAppError(caught).message);
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      />
    </div>
  );
}
