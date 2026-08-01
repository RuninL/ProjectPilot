import { Plus, X } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toAppError } from '@/lib/errors';
import { getTaskMeetingService } from '@/services/taskMeeting.service';
import { getTaskService } from '@/services/task.service';
import type { TaskStatus, TaskWithProject } from '@/types';

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '待办',
  in_progress: '进行中',
  blocked: '已阻塞',
  postponed: '已推迟',
  done: '已完成',
  cancelled: '已取消',
};

type TaskScope = 'active' | 'archived' | 'all';

interface Props {
  meetingId: string | null;
  selectedTaskIds: readonly string[];
  onSelectedTaskIdsChange: (ids: readonly string[]) => void;
}

function isActive(task: TaskWithProject): boolean {
  return task.archived_at === null && task.project_status !== 'archived';
}

function taskLabel(task: TaskWithProject): string {
  const due = task.due_date === null ? '' : ` · 截止 ${task.due_date}`;
  return `${task.title} · ${task.project_name} · ${STATUS_LABELS[task.status]}${due}`;
}

export function MeetingTaskSelector({
  meetingId,
  selectedTaskIds,
  onSelectedTaskIdsChange,
}: Props) {
  const [tasks, setTasks] = useState<readonly TaskWithProject[]>([]);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [scope, setScope] = useState<TaskScope>('active');
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getTaskService().then((service) => service.listTasks({ scope: 'all', sort: 'created_at' })),
      meetingId === null
        ? Promise.resolve([])
        : getTaskMeetingService().then((service) => service.listTasksByMeeting(meetingId)),
    ])
      .then(([allTasks, linkedTasks]) => {
        if (!active) return;
        setTasks(allTasks);
        if (meetingId !== null) {
          onSelectedTaskIdsChange(linkedTasks.map((task) => task.id));
        }
      })
      .catch((caught: unknown) => {
        if (active) setError(toAppError(caught).message);
      });
    return () => {
      active = false;
    };
  }, [meetingId, onSelectedTaskIdsChange]);

  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const selectedTasks = useMemo(
    () =>
      selectedTaskIds
        .map((id) => tasksById.get(id))
        .filter((task): task is TaskWithProject => task !== undefined),
    [selectedTaskIds, tasksById],
  );
  const candidates = useMemo(() => {
    const selected = new Set(selectedTaskIds);
    const query = deferredSearch.trim().toLocaleLowerCase('zh-CN');
    return tasks
      .filter((task) => {
        if (selected.has(task.id)) return false;
        if (scope === 'active' && !isActive(task)) return false;
        if (scope === 'archived' && isActive(task)) return false;
        return (
          query === '' ||
          task.title.toLocaleLowerCase('zh-CN').includes(query) ||
          task.project_name.toLocaleLowerCase('zh-CN').includes(query)
        );
      })
      .slice(0, 100);
  }, [deferredSearch, scope, selectedTaskIds, tasks]);

  const changeLink = (taskId: string, add: boolean): void => {
    const previous = selectedTaskIds;
    const next = add ? [...previous, taskId] : previous.filter((id) => id !== taskId);
    onSelectedTaskIdsChange(next);
    if (meetingId === null) return;
    setBusyTaskId(taskId);
    setError(null);
    void getTaskMeetingService()
      .then(async (service) => {
        if (add) {
          await service.link(taskId, meetingId);
        } else {
          await service.unlink(taskId, meetingId);
        }
      })
      .catch((caught: unknown) => {
        onSelectedTaskIdsChange(previous);
        setError(toAppError(caught).message);
      })
      .finally(() => {
        setBusyTaskId(null);
      });
  };

  return (
    <section className="grid gap-2 rounded-md border p-3">
      <div>
        <h3 className="text-sm font-medium">关联任务</h3>
        <p className="text-xs text-muted-foreground">
          {meetingId === null
            ? '将在会议创建成功时一并保存关联。'
            : '关联变更会立即保存，不需要再次保存会议。'}
        </p>
      </div>
      {selectedTasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">尚未关联任务</p>
      ) : (
        <ul className="grid gap-1">
          {selectedTasks.map((task) => (
            <li key={task.id} className="flex items-center justify-between gap-2 text-sm">
              {meetingId === null ? (
                <span>{taskLabel(task)}</span>
              ) : (
                <Link className="text-primary hover:underline" to={`/tasks/${task.id}`}>
                  {taskLabel(task)}
                </Link>
              )}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={busyTaskId !== null}
                aria-label={`移除关联任务 ${task.title}`}
                onClick={() => {
                  changeLink(task.id, false);
                }}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="meeting-task-search">搜索任务</Label>
        <Input
          id="meeting-task-search"
          value={search}
          placeholder="按任务或项目名称搜索"
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </div>
      <div className="flex flex-wrap gap-1" aria-label="任务范围">
        {(['active', 'archived', 'all'] as const).map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={scope === value ? 'secondary' : 'ghost'}
            onClick={() => {
              setScope(value);
            }}
          >
            {value === 'active' ? '活动' : value === 'archived' ? '已归档' : '全部'}
          </Button>
        ))}
      </div>
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">没有匹配的候选任务</p>
      ) : (
        <ul className="max-h-48 divide-y overflow-y-auto">
          {candidates.map((task) => (
            <li key={task.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0 text-sm">
                <p className="truncate">{task.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {task.project_name} · {STATUS_LABELS[task.status]}
                  {task.due_date === null ? '' : ` · 截止 ${task.due_date}`}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busyTaskId !== null}
                onClick={() => {
                  changeLink(task.id, true);
                }}
              >
                <Plus className="h-4 w-4" aria-hidden />
                关联
              </Button>
            </li>
          ))}
        </ul>
      )}
      {tasks.length > 100 && candidates.length === 100 && (
        <Badge variant="outline" className="w-fit">
          仅显示前 100 项，请继续输入以缩小范围
        </Badge>
      )}
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
