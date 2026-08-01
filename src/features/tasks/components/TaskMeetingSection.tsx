import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toAppError } from '@/lib/errors';
import { getMeetingService } from '@/services/meeting.service';
import { getTaskMeetingService } from '@/services/taskMeeting.service';
import type { Meeting } from '@/types';

interface Props {
  taskId: string;
}

function meetingLabel(meeting: Meeting): string {
  const time = meeting.start_time === null ? '' : ` ${meeting.start_time}`;
  return `${meeting.date}${time} · ${meeting.topic}`;
}

export function TaskMeetingSection({ taskId }: Props) {
  const [meetings, setMeetings] = useState<readonly Meeting[]>([]);
  const [linkedIds, setLinkedIds] = useState<readonly string[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [meetingService, taskMeetingService] = await Promise.all([
      getMeetingService(),
      getTaskMeetingService(),
    ]);
    const [allMeetings, links] = await Promise.all([
      meetingService.listMeetings(),
      taskMeetingService.listByTask(taskId),
    ]);
    setMeetings(allMeetings);
    setLinkedIds(links.map((link) => link.meeting_id));
  }, [taskId]);

  useEffect(() => {
    void load().catch((caught: unknown) => {
      setError(toAppError(caught).message);
    });
  }, [load]);

  const linked = linkedIds
    .map((id) => meetings.find((meeting) => meeting.id === id))
    .filter((meeting): meeting is Meeting => meeting !== undefined);
  const available = meetings.filter((meeting) => !linkedIds.includes(meeting.id));

  return (
    <section className="rounded-md border p-3">
      <h2 className="font-medium">关联会议</h2>
      <div className="mt-2 flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="task-meeting-select">选择会议</Label>
          <select
            id="task-meeting-select"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={selectedId}
            onChange={(event) => {
              setSelectedId(event.target.value);
            }}
          >
            <option value="">请选择要关联的会议</option>
            {available.map((meeting) => (
              <option key={meeting.id} value={meeting.id}>
                {meetingLabel(meeting)}
              </option>
            ))}
          </select>
        </div>
        <Button
          disabled={selectedId === ''}
          onClick={() => {
            setError(null);
            void getTaskMeetingService()
              .then((service) => service.link(taskId, selectedId))
              .then(async () => {
                setSelectedId('');
                await load();
              })
              .catch((caught: unknown) => {
                setError(toAppError(caught).message);
              });
          }}
        >
          <Plus className="h-4 w-4" aria-hidden />
          关联会议
        </Button>
      </div>
      {error !== null && <p className="mt-2 text-sm text-destructive">{error}</p>}
      {linked.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">无</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {linked.map((meeting) => (
            <li key={meeting.id} className="flex items-center justify-between gap-2">
              <Link to={`/meetings/${meeting.id}`} className="text-sm text-primary hover:underline">
                {meetingLabel(meeting)}
              </Link>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`移除关联会议 ${meeting.topic}`}
                onClick={() => {
                  setError(null);
                  void getTaskMeetingService()
                    .then((service) => service.unlink(taskId, meeting.id))
                    .then(load)
                    .catch((caught: unknown) => {
                      setError(toAppError(caught).message);
                    });
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
