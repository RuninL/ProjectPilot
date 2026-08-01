import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDisplay } from '@/lib/date';
import { toAppError } from '@/lib/errors';
import {
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_VARIANTS,
  TASK_STATUS_LABELS,
  TASK_STATUS_VARIANTS,
} from '@/lib/labels';
import { getPeopleService } from '@/services/people.service';
import { getProjectService } from '@/services/project.service';
import { getTaskService } from '@/services/task.service';
import { getDependencyService } from '@/services/dependency.service';
import { getTaskProgressService } from '@/services/taskProgress.service';
import type { Person, Project, Task, TaskDependency } from '@/types';
import { TaskChecklistSection } from '../components/TaskChecklistSection';
import { TaskProgressSection } from '../components/TaskProgressSection';
import { TaskResourcesSection } from '../components/TaskResourcesSection';

export function TaskDetailPage() {
  const { taskId = '' } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [participants, setParticipants] = useState<readonly Person[]>([]);
  const [projectParticipantIds, setProjectParticipantIds] = useState<readonly string[]>([]);
  const [projectTasks, setProjectTasks] = useState<readonly Task[]>([]);
  const [dependencies, setDependencies] = useState<readonly TaskDependency[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const taskService = await getTaskService();
      const loadedTask = await taskService.getTask(taskId);
      const [loadedProject, peopleService] = await Promise.all([
        getProjectService().then((service) => service.getProject(loadedTask.project_id)),
        getPeopleService(),
      ]);
      const [allPeople, taskParticipants, projectParticipants, analysis] = await Promise.all([
        peopleService.listPeople(),
        peopleService.listTaskParticipants([taskId]),
        peopleService.listProjectParticipants([loadedTask.project_id]),
        getDependencyService().then((service) => service.analyzeProject(loadedTask.project_id)),
      ]);
      const ids = new Set(taskParticipants.map((participant) => participant.person_id));
      setTask(loadedTask);
      setProject(loadedProject);
      setParticipants(allPeople.filter((person) => ids.has(person.id)));
      setProjectParticipantIds(projectParticipants.map((participant) => participant.person_id));
      setProjectTasks(analysis.tasks);
      setDependencies(analysis.dependencies);
    } catch (caught) {
      setError(toAppError(caught).message);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error !== null) {
    return (
      <div className="p-6">
        <ErrorState title="无法打开任务" message={error} onRetry={() => void load()} />
      </div>
    );
  }
  if (task === null || project === null) {
    return (
      <div className="p-6">
        <LoadingState label="正在加载任务详情…" />
      </div>
    );
  }
  const parent = projectTasks.find((candidate) => candidate.id === task.parent_task_id);
  const children = projectTasks.filter((candidate) => candidate.parent_task_id === task.id);
  const predecessors = dependencies
    .filter((dependency) => dependency.successor_id === task.id)
    .map((dependency) =>
      projectTasks.find((candidate) => candidate.id === dependency.predecessor_id),
    )
    .filter((candidate): candidate is Task => candidate !== undefined);
  const successors = dependencies
    .filter((dependency) => dependency.predecessor_id === task.id)
    .map((dependency) => projectTasks.find((candidate) => candidate.id === dependency.successor_id))
    .filter((candidate): candidate is Task => candidate !== undefined);

  return (
    <div className="space-y-6 p-6">
      <Link
        to="/tasks"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        返回任务
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{task.title}</h1>
            <Badge variant={TASK_STATUS_VARIANTS[task.status]}>
              {TASK_STATUS_LABELS[task.status]}
            </Badge>
            <Badge variant={TASK_PRIORITY_VARIANTS[task.priority]}>
              {TASK_PRIORITY_LABELS[task.priority]}
            </Badge>
          </div>
          <Link className="text-sm text-primary hover:underline" to={`/projects/${project.id}`}>
            {project.name}
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">
            <Link to={`/projects/${project.id}`} className="hover:underline">
              {project.name}
            </Link>
            {parent !== undefined && (
              <>
                {' > '}
                <Link to={`/tasks/${parent.id}`} className="hover:underline">
                  {parent.title}
                </Link>
              </>
            )}
            {' > '}
            {task.title}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            const markDone = task.status !== 'done';
            if (
              markDone &&
              !window.confirm(
                task.progress < 100
                  ? `当前进度为 ${String(task.progress)}%。是否创建一条补足剩余进度的“任务完成”记录并完成任务？`
                  : '当前进度已达到 100%。是否将任务标记为完成？',
              )
            ) {
              return;
            }
            setError(null);
            void (async () => {
              if (markDone) {
                await (await getTaskProgressService()).completeTask(task.id, task.progress < 100);
              } else {
                await (
                  await getTaskService()
                ).updateTask(task.id, {
                  project_id: task.project_id,
                  parent_task_id: task.parent_task_id,
                  title: task.title,
                  description: task.description,
                  status: 'todo',
                  priority: task.priority,
                  start_date: task.start_date,
                  due_date: task.due_date,
                  progress: task.progress,
                  estimated_hours: task.estimated_hours,
                  actual_hours: task.actual_hours,
                });
              }
              await load();
            })().catch((caught: unknown) => {
              setError(toAppError(caught).message);
            });
          }}
        >
          {task.status === 'done' ? '重新打开' : '完成任务'}
        </Button>
      </header>
      <dl className="grid grid-cols-2 gap-4 rounded-lg border bg-card p-4">
        <div>
          <dt className="text-xs text-muted-foreground">开始日期</dt>
          <dd>{formatDisplay(task.start_date)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">截止日期</dt>
          <dd>{formatDisplay(task.due_date)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">当前进度</dt>
          <dd>{String(task.progress)}%</dd>
        </div>
      </dl>
      <Tabs defaultValue="overview">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="progress">进展</TabsTrigger>
          <TabsTrigger value="checklist">待办</TabsTrigger>
          <TabsTrigger value="resources">文件与链接</TabsTrigger>
          <TabsTrigger value="relations">关联</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-4">
          <section className="space-y-3">
            <h2 className="text-lg font-medium">任务参与人</h2>
            {participants.length === 0 ? (
              <p className="text-sm text-muted-foreground">未分配参与人。</p>
            ) : (
              <ul className="space-y-2">
                {participants.map((person) => {
                  const outsideProject = !projectParticipantIds.includes(person.id);
                  return (
                    <li
                      key={person.id}
                      className="flex items-center justify-between rounded-md border p-3"
                    >
                      <Link to={`/people/${person.id}`} className="font-medium hover:underline">
                        {person.name}
                      </Link>
                      {outsideProject && (
                        <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                          <span>该成员不是本项目参与人</span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              void getPeopleService()
                                .then((service) =>
                                  service.addProjectParticipant(person.id, {
                                    project_id: project.id,
                                    role: '',
                                  }),
                                )
                                .then(load);
                            }}
                          >
                            加入项目参与人
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section>
            <h2 className="text-lg font-medium">描述</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm">
              {task.description || '未填写任务描述。'}
            </p>
          </section>
        </TabsContent>
        <TabsContent value="progress">
          <TaskProgressSection taskId={task.id} onChanged={load} />
        </TabsContent>
        <TabsContent value="checklist">
          <TaskChecklistSection taskId={task.id} />
        </TabsContent>
        <TabsContent value="resources">
          <TaskResourcesSection task={task} projectTasks={projectTasks} />
        </TabsContent>
        <TabsContent value="relations" className="grid gap-4 md:grid-cols-2">
          <RelationList title="父任务" tasks={parent === undefined ? [] : [parent]} />
          <RelationList title="子任务" tasks={children} />
          <RelationList title="依赖任务" tasks={predecessors} />
          <RelationList title="被依赖任务" tasks={successors} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RelationList({ title, tasks }: { title: string; tasks: readonly Task[] }) {
  return (
    <section className="rounded-md border p-3">
      <h2 className="font-medium">{title}</h2>
      {tasks.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">无</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {tasks.map((task) => (
            <li key={task.id}>
              <Link to={`/tasks/${task.id}`} className="text-sm text-primary hover:underline">
                {task.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
