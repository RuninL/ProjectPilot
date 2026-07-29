import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Button } from '@/components/ui/button';
import { toAppError } from '@/lib/errors';
import {
  getDependencyService,
  type ProjectDependencyAnalysis,
} from '@/services/dependency.service';
import { useProjectStore } from '@/stores/useProjectStore';
import type { Project } from '@/types';
import { GanttSection } from '../components/GanttSection';

interface ProjectGantt {
  readonly project: Project;
  readonly analysis: ProjectDependencyAnalysis;
}

/**
 * Global read-only Gantt overview: every active project's chart on one page,
 * so nobody has to open each project just to see its schedule. Reuses the
 * per-project GanttSection; the time-scale switch inside each section is
 * shared app-wide via useGanttStore.
 */
export function GanttPage() {
  const loadOptions = useProjectStore((state) => state.loadOptions);
  const projects = useProjectStore((state) => state.options);
  const [charts, setCharts] = useState<readonly ProjectGantt[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      await loadOptions();
      const active = useProjectStore.getState().options;
      const service = await getDependencyService();
      const analyses = await Promise.all(
        active.map(async (project) => ({
          project,
          analysis: await service.analyzeProject(project.id),
        })),
      );
      setCharts(analyses);
    } catch (caught) {
      setError(toAppError(caught).message);
    }
  }, [loadOptions]);

  useEffect(() => {
    void load();
  }, [load]);

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
            />
          </section>
        ))
      )}
    </div>
  );
}
