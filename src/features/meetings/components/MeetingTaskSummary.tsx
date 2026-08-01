import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toAppError } from '@/lib/errors';
import { getTaskMeetingService } from '@/services/taskMeeting.service';
import type { TaskWithProject } from '@/types';

interface Props {
  meetingId: string;
  refreshKey: unknown;
}

export function MeetingTaskSummary({ meetingId, refreshKey }: Props) {
  const [tasks, setTasks] = useState<readonly TaskWithProject[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getTaskMeetingService()
      .then((service) => service.listTasksByMeeting(meetingId))
      .then((linkedTasks) => {
        if (active) {
          setTasks(linkedTasks);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (active) setError(toAppError(caught).message);
      });
    return () => {
      active = false;
    };
  }, [meetingId, refreshKey]);

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-lg font-medium">{`关联任务（${String(tasks.length)}）`}</h2>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">尚未关联任务，可通过“编辑”添加。</p>
      ) : (
        <ul className="grid gap-1">
          {tasks.map((task) => (
            <li key={task.id}>
              <Link to={`/tasks/${task.id}`} className="text-sm text-primary hover:underline">
                {task.title} · {task.project_name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {error !== null && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  );
}
