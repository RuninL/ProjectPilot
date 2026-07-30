import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDisplay } from '@/lib/date';
import { toAppError } from '@/lib/errors';
import {
  PROJECT_STATUS_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_VARIANTS,
  TASK_STATUS_LABELS,
  TASK_STATUS_VARIANTS,
} from '@/lib/labels';
import {
  getPeopleService,
  type ParticipationSource,
  type PersonProjectGroup,
} from '@/services/people.service';
import type { Person } from '@/types';

const SOURCE_LABELS: Record<ParticipationSource, string> = {
  project_only: '项目参与',
  task_only: '仅任务参与',
  both: '项目与任务参与',
};

export function PersonDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [person, setPerson] = useState<Person | null>(null);
  const [groups, setGroups] = useState<readonly PersonProjectGroup[] | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const service = await getPeopleService();
      const [profile, participation] = await Promise.all([
        service.getPerson(id),
        service.getPersonProjects(id),
      ]);
      setPerson(profile);
      setGroups(participation);
    } catch (caught) {
      setError(toAppError(caught).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error !== null) {
    return (
      <div className="p-6">
        <ErrorState title="无法打开人物" message={error} onRetry={() => void load()} />
      </div>
    );
  }
  if (person === null || groups === null) {
    return (
      <div className="p-6">
        <LoadingState label="正在加载人物详情…" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Link
        to="/people"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        返回人物列表
      </Link>
      <header>
        <h1 className="text-2xl font-semibold">{person.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {person.role ?? '未设置角色'} · {person.email ?? '未设置邮箱'}
        </p>
        {person.note !== null && <p className="mt-2 max-w-2xl text-sm">{person.note}</p>}
      </header>

      <section>
        <h2 className="mb-3 text-lg font-medium">参与项目与任务</h2>
        {groups.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            该人员尚未参与任何项目或任务。
          </p>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => {
              const key = group.projectId ?? 'unassigned';
              const open = expanded.has(key);
              return (
                <article key={key} className="overflow-hidden rounded-lg border bg-card">
                  <div className="flex items-center gap-3 p-4">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`${open ? '收起' : '展开'} ${group.projectName}`}
                      aria-expanded={open}
                      onClick={() => {
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        });
                      }}
                    >
                      {open ? (
                        <ChevronDown className="h-4 w-4" aria-hidden />
                      ) : (
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      )}
                    </Button>
                    <div className="min-w-0 flex-1">
                      {group.projectId === null ? (
                        <h3 className="font-medium">未归属项目</h3>
                      ) : (
                        <Link
                          className="font-medium text-primary hover:underline"
                          to={`/projects/${group.projectId}`}
                        >
                          {group.projectName}
                        </Link>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {String(group.tasks.length)} 个参与任务
                      </p>
                    </div>
                    {group.projectStatus !== null && (
                      <Badge variant="outline">{PROJECT_STATUS_LABELS[group.projectStatus]}</Badge>
                    )}
                    <Badge variant="secondary">{SOURCE_LABELS[group.source]}</Badge>
                  </div>
                  {open && (
                    <div className="border-t bg-muted/20 px-6 py-3">
                      {group.tasks.length === 0 ? (
                        <p className="py-3 text-sm text-muted-foreground">
                          已参与项目，但尚未分配该项目下的任务。
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {group.tasks.map((task) => (
                            <li
                              key={task.taskId}
                              className="ml-6 flex items-center gap-2 rounded-md border bg-background p-3"
                            >
                              <Link
                                className="min-w-0 flex-1 truncate font-medium hover:underline"
                                to={`/tasks/${task.taskId}`}
                              >
                                {task.taskTitle}
                              </Link>
                              <Badge variant={TASK_STATUS_VARIANTS[task.status]}>
                                {TASK_STATUS_LABELS[task.status]}
                              </Badge>
                              <Badge variant={TASK_PRIORITY_VARIANTS[task.priority]}>
                                {TASK_PRIORITY_LABELS[task.priority]}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                截止 {formatDisplay(task.dueDate)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
