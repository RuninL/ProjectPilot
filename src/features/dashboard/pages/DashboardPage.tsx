import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RISK_LEVEL_LABELS, RISK_STATUS_LABELS } from '@/lib/labels';
import {
  getDashboardService,
  type DashboardData,
  type DashboardMilestone,
} from '@/services/dashboard.service';
import type { TaskWithProject } from '@/types';

function taskList(title: string, tasks: readonly TaskWithProject[], empty: string) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-lg font-medium text-primary">{title}</h2>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li key={task.id}>
              <Link
                className="flex justify-between gap-2 text-sm hover:underline"
                to={`/tasks?taskId=${encodeURIComponent(task.id)}`}
              >
                <span className="min-w-0">
                  <span className="font-medium text-sky-700 dark:text-sky-300">{task.title}</span>
                  <span className="text-muted-foreground"> · {task.project_name}</span>
                </span>
                <span>{task.due_date}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function milestoneList(title: string, milestones: readonly DashboardMilestone[], empty: string) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 font-medium">{title}</h3>
      {milestones.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {milestones.map(({ milestone, project }) => (
            <li key={milestone.id}>
              <Link
                className="flex justify-between gap-2 text-sm hover:underline"
                to={`/projects/${encodeURIComponent(milestone.project_id)}#project-milestones`}
              >
                <span>
                  {milestone.name} · {project?.name ?? '项目已删除'}
                </span>
                <span>{milestone.date}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Read-only overview of persisted work plus the four documented derived risk signals. */
export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const service = await getDashboardService();
      setData(await service.load());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法加载仪表盘');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (data === null && error === null) {
    return (
      <div className="p-6">
        <LoadingState label="正在加载仪表盘…" />
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="p-6">
        <ErrorState
          title="无法加载仪表盘"
          message={error ?? ''}
          onRetry={() => {
            void load();
          }}
        />
      </div>
    );
  }

  const highRisks = data.openRisks.filter(
    (risk) => risk.level === 'critical' || risk.level === 'high',
  );
  const cards = [
    ['进行中项目', data.projects.length, '/projects'],
    ['今日到期任务', data.todayTasks.length, '/tasks'],
    ['已逾期任务', data.overdueTasks.length, '/tasks'],
    ['高风险 / 严重风险', highRisks.length, '/risks'],
  ] as const;

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-primary">仪表盘</h1>
        <p className="text-sm text-muted-foreground">今天是 {data.today}（香港时区）</p>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map(([label, value, to]) => (
          <Link key={label} to={to} className="rounded-lg border bg-card p-4 hover:bg-accent">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold">{value}</dd>
          </Link>
        ))}
      </dl>

      <div className="grid gap-4 lg:grid-cols-3">
        {taskList('今日到期', data.todayTasks, '今天没有到期的未完成任务。')}
        {taskList('即将到期（7 天内）', data.upcomingTasks, '未来 7 天没有到期的未完成任务。')}
        {taskList('已逾期', data.overdueTasks, '没有已逾期的未完成任务。')}
      </div>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-medium">派生风险</h2>
            <p className="text-xs text-muted-foreground">只读计算，不会改写任务或里程碑状态。</p>
          </div>
          <Link to="/risks" className="text-sm hover:underline">
            查看登记风险
          </Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-md border p-3">
            <h3 className="font-medium">逾期未完成（{data.overdueRisks.length}）</h3>
            {data.overdueRisks.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">没有逾期的未完成任务。</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {data.overdueRisks.map((task) => (
                  <li key={task.id}>
                    <Link className="text-sm hover:underline" to={`/tasks?taskId=${task.id}`}>
                      {task.title} · {task.due_date}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-md border p-3">
            <h3 className="font-medium">临期低进度（{data.lowProgressRisks.length}）</h3>
            {data.lowProgressRisks.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                未来 7 天没有低于 50% 的未完成任务。
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {data.lowProgressRisks.map((task) => (
                  <li key={task.id}>
                    <Link className="text-sm hover:underline" to={`/tasks?taskId=${task.id}`}>
                      {task.title} · {task.progress}% · {task.due_date}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-md border p-3">
            <h3 className="font-medium">受阻传导（{data.blockedPropagationRisks.length}）</h3>
            {data.blockedPropagationRisks.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                没有受阻前驱影响的未完成后续任务。
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {data.blockedPropagationRisks.map(({ task, blockedBy }) => (
                  <li key={task.id}>
                    <Link className="text-sm hover:underline" to={`/tasks?taskId=${task.id}`}>
                      {task.title} · 受 {blockedBy.map((blocker) => blocker.title).join('、')} 影响
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-md border p-3">
            <h3 className="font-medium">
              14 天内里程碑前置未完成（{data.milestonePredecessorRisks.length}）
            </h3>
            {data.milestonePredecessorRisks.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">近期里程碑没有未完成前置任务。</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {data.milestonePredecessorRisks.map(({ milestone, blockingTasks }) => (
                  <li key={milestone.id}>
                    <Link
                      className="text-sm hover:underline"
                      to={`/projects/${milestone.project_id}#project-milestones`}
                    >
                      {milestone.name} · 前置：{blockingTasks.map((task) => task.title).join('、')}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-lg font-medium">项目健康度</h2>
        {data.projects.length === 0 ? (
          <EmptyState
            title="暂无进行中项目"
            description="创建项目后可在这里查看真实任务完成率。"
            action={
              <Button size="sm" asChild>
                <Link to="/projects">前往项目</Link>
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {data.projects.map(({ project, progress }) => (
              <li key={project.id}>
                <Link
                  to={`/projects/${encodeURIComponent(project.id)}`}
                  className="flex justify-between text-sm hover:underline"
                >
                  <span>{project.name}</span>
                  <span>
                    {progress.total === 0 ? '暂无任务' : `${String(progress.percent)}%`} · 已完成{' '}
                    {String(progress.done)}/{String(progress.total)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-medium">即将举行的会议（7 天内）</h2>
            <p className="text-xs text-muted-foreground">显示这些会议尚未完成的行动项。</p>
          </div>
          <Link to="/meetings" className="text-sm hover:underline">
            查看全部会议
          </Link>
        </div>
        {data.upcomingMeetings.length === 0 ? (
          <p className="text-sm text-muted-foreground">未来 7 天没有会议。</p>
        ) : (
          <ul className="space-y-3">
            {data.upcomingMeetings.map(({ meeting, project, actionItems }) => (
              <li key={meeting.id} className="rounded-md border p-3">
                <Link
                  className="text-sm font-medium hover:underline"
                  to={`/meetings/${meeting.id}`}
                >
                  {meeting.topic} · {meeting.date}
                  {meeting.start_time === null ? '' : ` ${meeting.start_time}`} ·{' '}
                  {project?.name ?? '独立会议'}
                </Link>
                {actionItems.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">没有未完成行动项。</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {actionItems.map((item) => (
                      <li key={item.id}>
                        <Link
                          className="text-xs text-muted-foreground hover:underline"
                          to={`/meetings/${meeting.id}`}
                        >
                          行动项：{item.content} · {item.owner || '未设置负责人'} · 截止：
                          {item.due_date ?? '未设置'}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-medium">里程碑</h2>
            <p className="text-sm text-muted-foreground">不显示已达成或已取消的里程碑。</p>
          </div>
          <Link to="/projects" className="text-sm hover:underline">
            查看项目
          </Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {milestoneList('今天到期', data.todayMilestones, '今天没有待处理里程碑。')}
          {milestoneList('已逾期', data.overdueMilestones, '没有逾期里程碑。')}
          {milestoneList('未来 30 天', data.futureMilestones, '未来 30 天没有待处理里程碑。')}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium">风险摘要</h2>
            <p className="text-xs text-muted-foreground">显示开放和监控中的已登记风险。</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to="/risks?new=1">新建风险</Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/risks">查看全部风险</Link>
            </Button>
          </div>
        </div>
        {data.openRisks.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无开放或监控中的风险。</p>
        ) : (
          <ul className="space-y-2">
            {data.openRisks.slice(0, 5).map((risk) => (
              <li key={risk.id}>
                <Link
                  to={`/projects/${encodeURIComponent(risk.project_id)}#project-risks`}
                  className="flex justify-between gap-2 text-sm hover:underline"
                >
                  <span>
                    {risk.title} · {risk.project_name}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge
                      variant={
                        risk.level === 'critical' || risk.level === 'high'
                          ? 'destructive'
                          : 'outline'
                      }
                    >
                      {RISK_LEVEL_LABELS[risk.level]}风险
                    </Badge>
                    <Badge variant="outline">{RISK_STATUS_LABELS[risk.status]}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
