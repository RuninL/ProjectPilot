import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Badge } from '@/components/ui/badge';
import { addDays, todayHK } from '@/lib/date';
import { getRepositories } from '@/repositories';
import { computeProjectProgress } from '@/services/projectProgress';
import { getRiskService } from '@/services/risk.service';
import type { Project, TaskWithProject } from '@/types';

interface DashboardData {
  projects: Project[];
  today: TaskWithProject[];
  overdue: TaskWithProject[];
  upcoming: TaskWithProject[];
  risks: Awaited<ReturnType<Awaited<ReturnType<typeof getRiskService>>['listRisks']>>;
}

/** Read-only project overview composed from the existing repositories. */
export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const today = todayHK();
      const repos = await getRepositories();
      const [projects, allTasks, risks] = await Promise.all([
        repos.projects.findActive(),
        repos.tasks.findByQuery({ sort: 'due_date' }),
        (await getRiskService()).listRisks(),
      ]);
      const openTasks = allTasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled');
      setData({
        projects,
        today: openTasks.filter((task) => task.due_date === today),
        overdue: openTasks.filter((task) => task.due_date !== null && task.due_date < today),
        upcoming: openTasks.filter((task) => task.due_date !== null && task.due_date > today && task.due_date <= addDays(today, 7)),
        risks,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法加载仪表盘');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (data === null && error === null) return <div className="p-6"><LoadingState label="正在加载仪表盘…" /></div>;
  if (data === null) return <div className="p-6"><ErrorState title="无法加载仪表盘" message={error ?? ''} onRetry={() => { void load(); }} /></div>;
  const highRisks = data.risks.filter((risk) => ['critical', 'high'].includes(risk.level) && ['open', 'monitoring'].includes(risk.status));
  const cards = [
    ['进行中项目', data.projects.length, '/projects'],
    ['今日到期任务', data.today.length, '/tasks'],
    ['已逾期任务', data.overdue.length, '/tasks'],
    ['高风险 / 严重风险', highRisks.length, '/risks'],
  ] as const;
  const taskGroup = (title: string, tasks: TaskWithProject[], empty: string) => <section className="rounded-lg border bg-card p-4"><h2 className="mb-3 text-lg font-medium">{title}</h2>{tasks.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : <ul className="space-y-2">{tasks.map((task) => <li key={task.id}><Link className="flex justify-between gap-2 text-sm hover:underline" to={`/tasks?taskId=${encodeURIComponent(task.id)}`}><span>{task.title} · {task.project_name}</span><span>{task.due_date}</span></Link></li>)}</ul>}</section>;
  return <div className="space-y-6 p-6">
    <header><h1 className="text-2xl font-semibold">仪表盘</h1><p className="text-sm text-muted-foreground">今天是 {todayHK()}（香港时区）</p></header>
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{cards.map(([label, value, to]) => <Link key={label} to={to} className="rounded-lg border bg-card p-4 hover:bg-accent"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-2xl font-semibold">{value}</dd></Link>)}</dl>
    <div className="grid gap-4 lg:grid-cols-3">{taskGroup('今日到期', data.today, '今天没有到期的未完成任务。')}{taskGroup('即将到期（7 天内）', data.upcoming, '未来 7 天没有到期的未完成任务。')}{taskGroup('已逾期', data.overdue, '没有已逾期的未完成任务。')}</div>
    <section className="rounded-lg border bg-card p-4"><h2 className="mb-3 text-lg font-medium">项目健康度</h2>{data.projects.length === 0 ? <EmptyState title="暂无进行中项目" description="创建项目后可在这里查看完成进度和任务健康度。" /> : <ul className="space-y-2">{data.projects.map((project) => { const tasks = [...data.today, ...data.upcoming, ...data.overdue].filter((task) => task.project_id === project.id); return <li key={project.id}><Link to={`/projects/${encodeURIComponent(project.id)}`} className="flex justify-between text-sm hover:underline"><span>{project.name}</span><span>{computeProjectProgress(tasks).percent}% · 待关注 {tasks.length}</span></Link></li>; })}</ul>}</section>
    <section className="rounded-lg border bg-card p-4"><div className="mb-3 flex justify-between"><h2 className="text-lg font-medium">风险摘要</h2><Link to="/risks" className="text-sm hover:underline">查看全部风险</Link></div>{data.risks.filter((risk) => ['open', 'monitoring'].includes(risk.status)).slice(0, 5).map((risk) => <Link key={risk.id} to={`/projects/${risk.project_id}#project-risks`} className="mb-2 flex justify-between text-sm hover:underline"><span>{risk.title} · {risk.project_name}</span><Badge variant={risk.level === 'critical' || risk.level === 'high' ? 'destructive' : 'outline'}>{risk.level}</Badge></Link>)}{data.risks.length === 0 && <p className="text-sm text-muted-foreground">暂无开放风险。</p>}</section>
  </div>;
}
