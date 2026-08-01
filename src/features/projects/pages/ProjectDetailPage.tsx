import { Archive, ArchiveRestore, ArrowLeft, Pencil } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { SampleBadge } from '@/components/common/SampleBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DependencySection } from '@/features/dependencies/components/DependencySection';
import { GanttSection } from '@/features/gantt/components/GanttSection';
import { ProjectLinkSection } from '@/features/links/components/ProjectLinkSection';
import { MeetingSection } from '@/features/meetings/components/MeetingSection';
import { MilestoneSection } from '@/features/milestones/components/MilestoneSection';
import { RiskSection } from '@/features/risks/components/RiskSection';
import { ProjectParticipantsSection } from '@/features/people/components/ProjectParticipantsSection';
import { TaskWorkspace } from '@/features/tasks/components/TaskWorkspace';
import { formatDisplay, isOverdue } from '@/lib/date';
import { toAppError } from '@/lib/errors';
import { PROJECT_STATUS_LABELS } from '@/lib/labels';
import { computeProjectProgress, formatProgress } from '@/services/projectProgress';
import { useDependencyStore } from '@/stores/useDependencyStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTaskStore } from '@/stores/useTaskStore';
import type { Project, TaskWithProject } from '@/types';
import { ProjectForm } from '../components/ProjectForm';
import { RestoreProjectDialog } from '../components/RestoreProjectDialog';

/** Capabilities that arrive in a later phase — listed, never clickable, never faked. */
const LATER_PHASE_SECTIONS = [{ title: '关键路径与拖拽排期', description: '甘特图上的自动排程' }];

interface Overview {
  total: number;
  inProgress: number;
  blocked: number;
  done: number;
  overdue: number;
}

function summarize(tasks: readonly TaskWithProject[]): Overview {
  return {
    total: tasks.length,
    inProgress: tasks.filter((task) => task.status === 'in_progress').length,
    blocked: tasks.filter((task) => task.status === 'blocked').length,
    done: tasks.filter((task) => task.status === 'done').length,
    overdue: tasks.filter((task) => isOverdue(task.due_date, task.status)).length,
  };
}

export function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? '';

  const getProject = useProjectStore((state) => state.getProject);
  const updateProject = useProjectStore((state) => state.updateProject);
  const archiveProject = useProjectStore((state) => state.archiveProject);
  const restoreProject = useProjectStore((state) => state.restoreProject);
  const countProjectArchivedTasks = useProjectStore((state) => state.countProjectArchivedTasks);
  const listByProject = useTaskStore((state) => state.listByProject);
  const taskVersion = useTaskStore((state) => state.tasks);
  const analysis = useDependencyStore((state) => state.analysis);
  const dependencyLoading = useDependencyStore((state) => state.loading);
  const dependencyError = useDependencyStore((state) => state.error);
  const loadDependencies = useDependencyStore((state) => state.loadProject);
  const createDependency = useDependencyStore((state) => state.createDependency);
  const deleteDependency = useDependencyStore((state) => state.deleteDependency);

  const [project, setProject] = useState<Project | null>(null);
  const [projectTasks, setProjectTasks] = useState<TaskWithProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<Project | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProject(await getProject(projectId));
    } catch (caught) {
      setError(toAppError(caught).message);
    } finally {
      setLoading(false);
    }
  }, [getProject, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Overview counts are read unfiltered, and re-read whenever the task section
  // below reloads, so editing a task updates the summary too.
  useEffect(() => {
    let active = true;
    void listByProject(projectId).then((tasks) => {
      if (active) {
        setProjectTasks(tasks);
      }
    });
    return () => {
      active = false;
    };
  }, [listByProject, projectId, taskVersion]);

  // Re-analyzed whenever a task changes: blocked risk and schedule conflicts are
  // projections of the task rows, so a date edit must be reflected here too.
  useEffect(() => {
    void loadDependencies(projectId);
  }, [loadDependencies, projectId, taskVersion]);

  if (loading) {
    return (
      <div className="p-6">
        <LoadingState label="正在加载项目…" />
      </div>
    );
  }

  if (error !== null || project === null) {
    return (
      <div className="p-6">
        <ErrorState
          title="无法打开项目"
          message={error ?? '项目不存在或已被删除'}
          onRetry={() => {
            void load();
          }}
        />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" asChild>
            <Link to="/projects">返回项目列表</Link>
          </Button>
        </div>
      </div>
    );
  }

  const archived = project.archived_at !== null;
  const overview = summarize(projectTasks);
  const progress = computeProjectProgress(projectTasks);

  return (
    <div className="p-6">
      <Link
        to="/projects"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        返回项目列表
      </Link>

      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span
            className="mt-1 h-8 w-1.5 rounded-full"
            style={{ backgroundColor: project.color }}
            aria-hidden
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">{project.name}</h1>
              <Badge variant={archived ? 'outline' : 'default'}>
                {PROJECT_STATUS_LABELS[project.status]}
              </Badge>
              {project.is_sample === 1 && <SampleBadge />}
            </div>
            {project.description !== '' && (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{project.description}</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setFormOpen(true);
            }}
          >
            <Pencil className="h-4 w-4" aria-hidden />
            编辑
          </Button>
          {archived ? (
            <Button
              variant="outline"
              onClick={() => {
                setRestoreTarget(project);
              }}
            >
              <ArchiveRestore className="h-4 w-4" aria-hidden />
              恢复
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                setArchiveOpen(true);
              }}
            >
              <Archive className="h-4 w-4" aria-hidden />
              归档
            </Button>
          )}
        </div>
      </header>

      <dl className="mb-6 grid grid-cols-2 gap-4 rounded-lg border bg-card p-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">开始日期</dt>
          <dd className="text-sm font-medium">{formatDisplay(project.start_date)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">目标结束日期</dt>
          <dd className="text-sm font-medium">{formatDisplay(project.target_end_date)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">完成率</dt>
          <dd className="text-sm font-medium">{formatProgress(progress)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">归档时间</dt>
          <dd className="text-sm font-medium">{archived ? project.archived_at : '未归档'}</dd>
        </div>
      </dl>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-medium">任务概览</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: '任务总数', value: overview.total },
            { label: '进行中', value: overview.inProgress },
            { label: '受阻', value: overview.blocked },
            { label: '已完成', value: overview.done },
            { label: '已逾期', value: overview.overdue },
          ].map((card) => (
            <div key={card.label} className="rounded-lg border bg-card p-4">
              <dt className="text-xs text-muted-foreground">{card.label}</dt>
              <dd className="mt-1 text-2xl font-semibold">{String(card.value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-medium">项目参与人</h2>
        <ProjectParticipantsSection projectId={project.id} />
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-medium">任务</h2>
        <TaskWorkspace
          projectId={project.id}
          canCreate={!archived}
          createHint={archived ? '项目已归档，无法新建任务' : null}
        />
      </section>

      <section className="mb-6" id="project-milestones">
        <h2 className="mb-3 text-lg font-medium">里程碑</h2>
        <MilestoneSection
          projectId={project.id}
          canEdit={!archived}
          editHint={archived ? '项目已归档，无法新建或修改里程碑' : null}
        />
      </section>

      <section className="mb-6" id="project-meetings">
        <h2 className="mb-3 text-lg font-medium">会议与行动项</h2>
        <MeetingSection project={project} />
      </section>

      <section className="mb-6" id="project-risks">
        <h2 className="mb-3 text-lg font-medium">风险</h2>
        <RiskSection project={project} />
      </section>

      <section className="mb-6" id="project-gantt">
        <h2 className="mb-3 text-lg font-medium">甘特图</h2>
        <GanttSection
          analysis={analysis}
          loading={dependencyLoading}
          error={dependencyError}
          onRetry={() => {
            void loadDependencies(project.id);
          }}
          projectId={project.id}
          canEdit={!archived}
        />
      </section>

      <section className="mb-6" id="project-dependencies">
        <h2 className="mb-3 text-lg font-medium">任务依赖</h2>
        <DependencySection
          analysis={analysis}
          loading={dependencyLoading}
          error={dependencyError}
          canEdit={!archived}
          editHint={archived ? '项目已归档，无法新建任务依赖' : null}
          onCreate={(predecessorId, successorId) =>
            createDependency(
              { predecessor_id: predecessorId, successor_id: successorId },
              project.id,
            )
          }
          onDelete={(dependencyId) => deleteDependency(dependencyId, project.id)}
          onRetry={() => {
            void loadDependencies(project.id);
          }}
        />
      </section>

      <section className="mb-6" id="project-links">
        <h2 className="mb-3 text-lg font-medium">文件与链接</h2>
        <ProjectLinkSection project={project} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">后续阶段能力</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {LATER_PHASE_SECTIONS.map((section) => (
            <li
              key={section.title}
              aria-disabled="true"
              className="cursor-not-allowed rounded-lg border border-dashed bg-muted/30 p-4 opacity-70"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{section.title}</span>
                <Badge variant="outline">后续阶段</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
            </li>
          ))}
        </ul>
      </section>

      <ProjectForm
        open={formOpen}
        project={project}
        onSubmit={async (input) => {
          await updateProject(project.id, input);
          await load();
        }}
        onClose={() => {
          setFormOpen(false);
        }}
      />

      <ConfirmDialog
        open={archiveOpen}
        title="归档项目"
        description={`归档「${project.name}」后将无法在该项目下新建任务，该项目当前活动的任务将被自动归档；已有数据保留，可随时恢复。`}
        confirmLabel="归档"
        onCancel={() => {
          setArchiveOpen(false);
        }}
        onConfirm={() => {
          setArchiveOpen(false);
          void archiveProject(project.id).then(load);
        }}
      />

      <RestoreProjectDialog
        project={restoreTarget}
        loadAutoArchivedCount={countProjectArchivedTasks}
        onCancel={() => {
          setRestoreTarget(null);
        }}
        onConfirm={(target, restoreTasks) => {
          setRestoreTarget(null);
          void restoreProject(target.id, restoreTasks).then(load);
        }}
      />
    </div>
  );
}
