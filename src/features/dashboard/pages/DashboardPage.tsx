import {
  AlertTriangle,
  CalendarClock,
  Flag,
  FolderKanban,
  HeartPulse,
  ShieldAlert,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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

/**
 * Design conventions on this page:
 * - Section headings all use the theme's `heading` accent token so every 栏目
 *   (项目健康度, 派生风险, …) is identified by one uniform color per theme.
 * - Clickable project names are always painted with the project's own color,
 *   accompanied by a same-color dot so color is never the only signal.
 */

/** A project name link/label tinted with the project's configured color. */
function ProjectName({ name, color }: { name: string; color: string | null }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={color === null ? undefined : { backgroundColor: color }}
        aria-hidden
      />
      <span className="truncate font-medium" style={color === null ? undefined : { color }}>
        {name}
      </span>
    </span>
  );
}

/** Uniform section heading: accent bar + heading color, shared by every栏目. */
function SectionTitle({
  icon: Icon,
  children,
  small,
}: {
  icon?: LucideIcon;
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-4 w-1 shrink-0 rounded-full bg-heading" aria-hidden />
      {Icon !== undefined && <Icon className="h-4 w-4 shrink-0 text-heading" aria-hidden />}
      {small ? (
        <h3 className="font-medium text-heading">{children}</h3>
      ) : (
        <h2 className="text-lg font-semibold text-heading">{children}</h2>
      )}
    </div>
  );
}

function taskList(title: string, tasks: readonly TaskWithProject[], empty: string) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-3">
        <SectionTitle icon={CalendarClock}>{title}</SectionTitle>
      </div>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {tasks.map((task) => (
            <li key={task.id}>
              <Link
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                to={`/tasks?taskId=${encodeURIComponent(task.id)}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{task.title}</span>
                  <ProjectName name={task.project_name} color={task.project_color} />
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{task.due_date}</span>
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
    <section className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-3">
        <SectionTitle icon={Flag} small>
          {title}
        </SectionTitle>
      </div>
      {milestones.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {milestones.map(({ milestone, project }) => (
            <li key={milestone.id}>
              <Link
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                to={`/projects/${encodeURIComponent(milestone.project_id)}#project-milestones`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{milestone.name}</span>
                  {project === null ? (
                    <span className="text-muted-foreground">项目已删除</span>
                  ) : (
                    <ProjectName name={project.name} color={project.color} />
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{milestone.date}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const STAT_STYLES = [
  'text-sky-600 dark:text-sky-400',
  'text-amber-600 dark:text-amber-400',
  'text-rose-600 dark:text-rose-400',
  'text-red-600 dark:text-red-400',
] as const;

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
    ['进行中项目', data.projects.length, '/projects', FolderKanban],
    ['今日到期任务', data.todayTasks.length, '/tasks', CalendarClock],
    ['已逾期任务', data.overdueTasks.length, '/tasks', AlertTriangle],
    ['高风险 / 严重风险', highRisks.length, '/risks', ShieldAlert],
  ] as const;

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-heading">仪表盘</h1>
        <p className="text-sm text-muted-foreground">今天是 {data.today}（香港时区）</p>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map(([label, value, to, Icon], index) => (
          <Link
            key={label}
            to={to}
            className="group rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-heading/40 hover:bg-accent"
          >
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon className={`h-3.5 w-3.5 ${STAT_STYLES[index] ?? ''}`} aria-hidden />
              {label}
            </dt>
            <dd className={`mt-1 text-2xl font-semibold tabular-nums ${STAT_STYLES[index] ?? ''}`}>
              {value}
            </dd>
          </Link>
        ))}
      </dl>

      <div className="grid gap-4 lg:grid-cols-3">
        {taskList('今日到期', data.todayTasks, '今天没有到期的未完成任务。')}
        {taskList('即将到期（7 天内）', data.upcomingTasks, '未来 7 天没有到期的未完成任务。')}
        {taskList('已逾期', data.overdueTasks, '没有已逾期的未完成任务。')}
      </div>

      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <SectionTitle icon={AlertTriangle}>派生风险</SectionTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              只读计算，不会改写任务或里程碑状态。
            </p>
          </div>
          <Link to="/risks" className="text-sm text-primary hover:underline">
            查看登记风险
          </Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-md border p-3">
            <h3 className="font-medium text-heading">逾期未完成（{data.overdueRisks.length}）</h3>
            {data.overdueRisks.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">没有逾期的未完成任务。</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {data.overdueRisks.map((task) => (
                  <li key={task.id}>
                    <Link
                      className="flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-accent"
                      to={`/tasks?taskId=${task.id}`}
                    >
                      <span className="truncate">{task.title}</span>
                      <ProjectName name={task.project_name} color={task.project_color} />
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {task.due_date}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-md border p-3">
            <h3 className="font-medium text-heading">
              临期低进度（{data.lowProgressRisks.length}）
            </h3>
            {data.lowProgressRisks.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                未来 7 天没有低于 50% 的未完成任务。
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {data.lowProgressRisks.map((task) => (
                  <li key={task.id}>
                    <Link
                      className="flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-accent"
                      to={`/tasks?taskId=${task.id}`}
                    >
                      <span className="truncate">{task.title}</span>
                      <ProjectName name={task.project_name} color={task.project_color} />
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {task.progress}% · {task.due_date}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-md border p-3">
            <h3 className="font-medium text-heading">
              受阻传导（{data.blockedPropagationRisks.length}）
            </h3>
            {data.blockedPropagationRisks.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                没有受阻前驱影响的未完成后续任务。
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {data.blockedPropagationRisks.map(({ task, blockedBy }) => (
                  <li key={task.id}>
                    <Link
                      className="flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-accent"
                      to={`/tasks?taskId=${task.id}`}
                    >
                      <span className="truncate">
                        {task.title} · 受 {blockedBy.map((blocker) => blocker.title).join('、')}{' '}
                        影响
                      </span>
                      <ProjectName name={task.project_name} color={task.project_color} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-md border p-3">
            <h3 className="font-medium text-heading">
              14 天内里程碑前置未完成（{data.milestonePredecessorRisks.length}）
            </h3>
            {data.milestonePredecessorRisks.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">近期里程碑没有未完成前置任务。</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {data.milestonePredecessorRisks.map(({ milestone, project, blockingTasks }) => (
                  <li key={milestone.id}>
                    <Link
                      className="flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-accent"
                      to={`/projects/${milestone.project_id}#project-milestones`}
                    >
                      <span className="truncate">
                        {milestone.name} · 前置：
                        {blockingTasks.map((task) => task.title).join('、')}
                      </span>
                      {project !== null && (
                        <ProjectName name={project.name} color={project.color} />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3">
          <SectionTitle icon={HeartPulse}>项目健康度</SectionTitle>
        </div>
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
          <ul className="space-y-1">
            {data.projects.map(({ project, progress }) => (
              <li key={project.id}>
                <Link
                  to={`/projects/${encodeURIComponent(project.id)}`}
                  className="flex items-center justify-between gap-4 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent"
                >
                  <ProjectName name={project.name} color={project.color} />
                  <span className="flex shrink-0 items-center gap-3">
                    <span
                      className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-muted sm:block"
                      role="presentation"
                    >
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${String(progress.percent)}%`,
                          backgroundColor: project.color,
                        }}
                      />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {progress.total === 0 ? '暂无任务' : `${String(progress.percent)}%`} · 已完成{' '}
                      {String(progress.done)}/{String(progress.total)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <SectionTitle icon={Users}>即将举行的会议（7 天内）</SectionTitle>
            <p className="mt-1 text-xs text-muted-foreground">显示这些会议尚未完成的行动项。</p>
          </div>
          <Link to="/meetings" className="text-sm text-primary hover:underline">
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
                  className="flex flex-wrap items-center gap-2 text-sm font-medium hover:underline"
                  to={`/meetings/${meeting.id}`}
                >
                  <span>
                    {meeting.topic} · {meeting.date}
                    {meeting.start_time === null ? '' : ` ${meeting.start_time}`}
                  </span>
                  {project === null ? (
                    <span className="text-muted-foreground">独立会议</span>
                  ) : (
                    <ProjectName name={project.name} color={project.color} />
                  )}
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
            <SectionTitle icon={Flag}>里程碑</SectionTitle>
            <p className="mt-1 text-sm text-muted-foreground">不显示已达成或已取消的里程碑。</p>
          </div>
          <Link to="/projects" className="text-sm text-primary hover:underline">
            查看项目
          </Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {milestoneList('今天到期', data.todayMilestones, '今天没有待处理里程碑。')}
          {milestoneList('已逾期', data.overdueMilestones, '没有逾期里程碑。')}
          {milestoneList('未来 30 天', data.futureMilestones, '未来 30 天没有待处理里程碑。')}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionTitle icon={ShieldAlert}>风险摘要</SectionTitle>
            <p className="mt-1 text-xs text-muted-foreground">显示开放和监控中的已登记风险。</p>
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
          <ul className="space-y-1">
            {data.openRisks.slice(0, 5).map((risk) => (
              <li key={risk.id}>
                <Link
                  to={`/projects/${encodeURIComponent(risk.project_id)}#project-risks`}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{risk.title}</span>
                    <ProjectName name={risk.project_name} color={risk.project_color} />
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
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
