import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { calculateRiskLevel } from '@/services/riskLevel';
import { getRiskService } from '@/services/risk.service';
import type { RiskWithProject } from '@/types';

const levelLabel = { low: '低', medium: '中', high: '高', critical: '严重' } as const;
const statusLabel = { open: '开放', monitoring: '监控中', mitigated: '已缓解', closed: '已关闭' } as const;

/** Cross-project structured risk list. Editing remains in the owning project context. */
export function RisksPage() {
  const [risks, setRisks] = useState<RiskWithProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<RiskWithProject | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRisks(await (await getRiskService()).listRisks({ search }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法加载风险');
    }
  }, [search]);
  useEffect(() => { void load(); }, [load]);

  if (risks === null && error === null) return <div className="p-6"><LoadingState label="正在加载风险…" /></div>;
  if (risks === null) return <div className="p-6"><ErrorState title="无法加载风险" message={error ?? ''} onRetry={() => { void load(); }} /></div>;
  return (
    <div className="p-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">风险</h1><p className="mt-1 text-sm text-muted-foreground">优先显示开放风险，按等级、截止日期和更新时间排序。</p></div>
        <Button asChild><Link to="/projects">在项目中新建风险</Link></Button>
      </header>
      <Input aria-label="搜索风险" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题或描述" className="mb-4 max-w-md" />
      {risks.length === 0 ? <EmptyState title="暂无风险" description="在项目详情页登记风险后，会在这里集中跟踪。" /> : (
        <ul className="divide-y rounded-lg border bg-card">
          {risks.map((risk) => <li key={risk.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{risk.title}</span><Badge variant={risk.level === 'critical' || risk.level === 'high' ? 'destructive' : 'outline'}>{levelLabel[risk.level]}风险</Badge><Badge variant="outline">{statusLabel[risk.status]}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{risk.project_name} · 负责人：{risk.owner || '未设置'} · 截止：{risk.due_date ?? '未设置'} · 更新：{risk.updated_at}</p></div>
            <div className="flex gap-2"><Button size="sm" variant="outline" asChild><Link to={`/projects/${encodeURIComponent(risk.project_id)}#project-risks`}>查看项目</Link></Button><Button size="sm" variant="ghost" onClick={() => setPendingDelete(risk)}>删除</Button></div>
          </li>)}
        </ul>
      )}
      <ConfirmDialog open={pendingDelete !== null} title="删除风险" description={pendingDelete === null ? '' : `确定删除「${pendingDelete.title}」（${pendingDelete.project_name}）吗？此操作不会删除项目、任务、会议、行动项或里程碑。`} confirmLabel="删除" destructive onCancel={() => setPendingDelete(null)} onConfirm={() => { const target = pendingDelete; setPendingDelete(null); if (target !== null) void getRiskService().then((service) => service.deleteRisk(target.id)).then(load); }} />
    </div>
  );
}

export { calculateRiskLevel };
