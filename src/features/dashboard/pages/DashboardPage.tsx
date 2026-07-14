import { EmptyState } from '@/components/common/EmptyState';
import { todayHK } from '@/lib/date';

/** Phase 1 Dashboard placeholder. Risk cards and metrics arrive in Phase 5. */
export function DashboardPage() {
  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">仪表盘</h1>
        <p className="text-sm text-muted-foreground">今天是 {todayHK()}（香港时区）</p>
      </header>
      <EmptyState
        title="暂无数据"
        description="项目、任务与风险追踪将在后续阶段接入。当前为工程骨架与持久层地基。"
      />
    </div>
  );
}
