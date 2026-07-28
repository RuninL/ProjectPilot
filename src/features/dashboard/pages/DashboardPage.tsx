import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/common/EmptyState';
import { SampleBadge } from '@/components/common/SampleBadge';
import { todayHK } from '@/lib/date';
import { toAppError } from '@/lib/errors';
import { getSampleDataService } from '@/services/sampleData.service';
import { useAppStore } from '@/stores/useAppStore';
import type { Project } from '@/types';

/** Phase 1.5 Dashboard: DB readiness + the seeded sample project. Metrics arrive in Phase 5. */
export function DashboardPage() {
  const dbReady = useAppStore((state) => state.dbReady);
  const globalError = useAppStore((state) => state.globalError);
  const [sampleProject, setSampleProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const service = await getSampleDataService();
        const project = await service.findSampleProject();
        if (!controller.signal.aborted) {
          setSampleProject(project);
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setLoadError(toAppError(caught).message);
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, []);

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">仪表盘</h1>
        <p className="text-sm text-muted-foreground">今天是 {todayHK()}（香港时区）</p>
      </header>

      <section className="mb-6 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-medium text-muted-foreground">数据库状态</h2>
        <p className="mt-1 text-base font-medium">{dbReady ? '数据库已就绪' : '数据库未就绪'}</p>
        {globalError !== null && (
          <p className="mt-2 text-sm text-destructive">示例数据创建失败：{globalError.message}</p>
        )}
        {loadError !== null && (
          <p className="mt-2 text-sm text-destructive">读取示例数据失败：{loadError}</p>
        )}
      </section>

      {sampleProject === null ? (
        <EmptyState
          title="暂无项目"
          description="项目、任务与风险追踪将在后续阶段接入。当前为工程骨架与持久层地基。"
        />
      ) : (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">项目</h2>
          <div className="flex items-center gap-2">
            <span className="text-base font-medium">{sampleProject.name}</span>
            <SampleBadge />
          </div>
        </section>
      )}
    </div>
  );
}
