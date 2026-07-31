import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toAppError } from '@/lib/errors';
import { PROJECT_STATUS_OPTIONS } from '@/lib/labels';
import { todayHK } from '@/lib/date';
import {
  getDependencyService,
  type ProjectDependencyAnalysis,
} from '@/services/dependency.service';
import { getTaskService } from '@/services/task.service';
import { useGanttStore, type GanttScale } from '@/stores/useGanttStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { Project, ProjectStatus, TaskWithProject } from '@/types';
import { ParallelGanttChart } from '../components/ParallelGanttChart';
import { GanttSection } from '../components/GanttSection';
import { GANTT_SCALE_LABELS } from '../ganttViewModel';
import { buildParallelGanttViewModel } from '../parallelGanttViewModel';

interface ProjectGantt {
  readonly project: Project;
  readonly analysis: ProjectDependencyAnalysis;
}

const GANTT_SCALES: GanttScale[] = ['week', 'month', 'quarter'];

/**
 * Global read-only Gantt overview: every active project's chart on one page,
 * so nobody has to open each project just to see its schedule. Reuses the
 * per-project GanttSection; the time-scale switch inside each section is
 * shared app-wide via useGanttStore.
 */
export function GanttPage() {
  const loadOptions = useProjectStore((state) => state.loadOptions);
  const projects = useProjectStore((state) => state.options);
  const scale = useGanttStore((state) => state.scale);
  const setScale = useGanttStore((state) => state.setScale);
  const [charts, setCharts] = useState<readonly ProjectGantt[] | null>(null);
  const [tasks, setTasks] = useState<readonly TaskWithProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ProjectStatus | ''>('');
  const [hideCompleted, setHideCompleted] = useState(false);
  const [hidePostponed, setHidePostponed] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      await loadOptions();
      const active = useProjectStore.getState().options;
      const [service, taskService] = await Promise.all([getDependencyService(), getTaskService()]);
      const [analyses, allTasks] = await Promise.all([
        Promise.all(
          active.map(async (project) => ({
            project,
            analysis: await service.analyzeProject(project.id),
          })),
        ),
        taskService.listTasks(),
      ]);
      setCharts(analyses);
      setTasks(allTasks);
    } catch (caught) {
      setError(toAppError(caught).message);
    }
  }, [loadOptions]);

  useEffect(() => {
    void load();
  }, [load]);

  const parallelModel = useMemo(
    () =>
      buildParallelGanttViewModel({
        projects,
        tasks,
        today: todayHK(),
        scale,
        filters: {
          statuses: status === '' ? [] : [status],
          hideCompleted,
          hidePostponed,
        },
      }),
    [hideCompleted, hidePostponed, projects, scale, status, tasks],
  );

  if (error !== null) {
    return (
      <div className="p-6">
        <ErrorState
          title="无法加载甘特图"
          message={error}
          onRetry={() => {
            void load();
          }}
        />
      </div>
    );
  }

  if (charts === null) {
    return (
      <div className="p-6">
        <LoadingState label="正在加载全局甘特图…" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-heading">甘特图</h1>
        <p className="text-sm text-muted-foreground">
          所有进行中项目的排期总览，只读展示，共 {projects.length} 个项目。
        </p>
      </header>

      <section className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">并行甘特图</h2>
          <p className="text-sm text-muted-foreground">
            所有项目共享同一时间轴；点击项目名称进入该项目甘特图。缺失日期会按任务日期推算，
            仍无可用日期时按今天单日显示。时间轴两端保留完整刻度，避免边界日期被截断。
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-1.5">
            <Label>时间刻度</Label>
            <div className="flex items-center gap-1" role="group" aria-label="并行甘特图时间刻度">
              {GANTT_SCALES.map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={option === scale ? 'default' : 'outline'}
                  aria-pressed={option === scale}
                  onClick={() => {
                    setScale(option);
                  }}
                >
                  {GANTT_SCALE_LABELS[option]}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="parallel-gantt-status">项目状态</Label>
            <select
              id="parallel-gantt-status"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as ProjectStatus | '');
              }}
            >
              <option value="">全部状态</option>
              {PROJECT_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <label className="flex h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hideCompleted}
              onChange={(event) => {
                setHideCompleted(event.target.checked);
              }}
            />
            隐藏已完成
          </label>
          <label className="flex h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hidePostponed}
              onChange={(event) => {
                setHidePostponed(event.target.checked);
              }}
            />
            隐藏已推迟
          </label>
        </div>
        <ParallelGanttChart model={parallelModel} />
      </section>

      <h2 className="text-lg font-semibold">逐项目甘特图</h2>
      {charts.length === 0 ? (
        <EmptyState
          title="暂无进行中项目"
          description="创建项目并为任务填写开始日期后，甘特图会出现在这里。"
          action={
            <Button size="sm" asChild>
              <Link to="/projects">前往项目</Link>
            </Button>
          }
        />
      ) : (
        charts.map(({ project, analysis }) => (
          <section key={project.id} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <Link
                to={`/projects/${encodeURIComponent(project.id)}`}
                className="inline-flex items-center gap-2 hover:underline"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: project.color }}
                  aria-hidden
                />
                <h2 className="text-lg font-semibold" style={{ color: project.color }}>
                  {project.name}
                </h2>
              </Link>
              <Link
                to={`/projects/${encodeURIComponent(project.id)}`}
                className="text-sm text-primary hover:underline"
              >
                打开项目详情
              </Link>
            </div>
            <GanttSection
              analysis={analysis}
              loading={false}
              error={null}
              onRetry={() => {
                void load();
              }}
              projectId={project.id}
            />
          </section>
        ))
      )}
    </div>
  );
}
