import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RISK_CATEGORY_LABELS, RISK_LEVEL_LABELS, RISK_STATUS_LABELS } from '@/lib/labels';
import { toAppError } from '@/lib/errors';
import { getRepositories, type RiskQuery } from '@/repositories';
import { getRiskService } from '@/services/risk.service';
import type { Project, Risk, RiskCategory, RiskLevel, RiskStatus, RiskWithProject } from '@/types';
import { RiskForm } from '../components/RiskForm';

const SELECT_CLASS =
  'h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const categories = Object.entries(RISK_CATEGORY_LABELS) as [RiskCategory, string][];
const levels = Object.entries(RISK_LEVEL_LABELS) as [RiskLevel, string][];
const statuses = Object.entries(RISK_STATUS_LABELS) as [RiskStatus, string][];

function levelVariant(level: Risk['level']): 'destructive' | 'outline' {
  return level === 'critical' || level === 'high' ? 'destructive' : 'outline';
}

/** Cross-project risk register with database-backed filtering and lifecycle-safe editing. */
export function RisksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [risks, setRisks] = useState<RiskWithProject[] | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState<RiskStatus | ''>('');
  const [level, setLevel] = useState<RiskLevel | ''>('');
  const [category, setCategory] = useState<RiskCategory | ''>('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Risk | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RiskWithProject | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useMemo<RiskQuery>(
    () => ({
      search,
      ...(projectId === '' ? {} : { projectIds: [projectId] }),
      ...(status === '' ? {} : { statuses: [status] }),
      ...(level === '' ? {} : { levels: [level] }),
      ...(category === '' ? {} : { categories: [category] }),
    }),
    [category, level, projectId, search, status],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [service, repos] = await Promise.all([getRiskService(), getRepositories()]);
      const [loadedRisks, loadedProjects] = await Promise.all([
        service.listRisks(query),
        repos.projects.findAll(),
      ]);
      setRisks(loadedRisks);
      setProjects(loadedProjects);
    } catch (caught) {
      setError(toAppError(caught).message);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setActionError(null);
      setEditing(null);
      setFormOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const deleteRisk = (): void => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (target === null) {
      return;
    }
    setActionError(null);
    setBusy(true);
    void getRiskService()
      .then((service) => service.deleteRisk(target.id))
      .then(load)
      .catch((caught: unknown) => {
        setActionError(toAppError(caught).message);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  if ((risks === null || projects === null) && error === null) {
    return (
      <div className="p-6">
        <LoadingState label="正在加载风险…" />
      </div>
    );
  }
  if (risks === null || projects === null) {
    return (
      <div className="p-6">
        <ErrorState
          title="无法加载风险"
          message={error ?? '无法读取风险数据'}
          onRetry={() => {
            void load();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">风险</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            开放和监控中的风险优先显示，再按等级、截止日期和更新时间排序。
          </p>
        </div>
        <Button
          onClick={() => {
            setActionError(null);
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden />
          新建风险
        </Button>
      </header>

      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="grid gap-1.5 lg:col-span-2">
          <label className="text-sm font-medium" htmlFor="risk-search">
            搜索
          </label>
          <Input
            id="risk-search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="搜索标题或描述"
          />
        </div>
        <div className="grid gap-1.5">
          <label className="text-sm font-medium" htmlFor="risk-filter-project">
            所属项目
          </label>
          <select
            id="risk-filter-project"
            className={SELECT_CLASS}
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
            }}
          >
            <option value="">全部项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <label className="text-sm font-medium" htmlFor="risk-filter-status">
            状态
          </label>
          <select
            id="risk-filter-status"
            className={SELECT_CLASS}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as RiskStatus | '');
            }}
          >
            <option value="">全部状态</option>
            {statuses.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <label className="text-sm font-medium" htmlFor="risk-filter-level">
            等级
          </label>
          <select
            id="risk-filter-level"
            className={SELECT_CLASS}
            value={level}
            onChange={(event) => {
              setLevel(event.target.value as RiskLevel | '');
            }}
          >
            <option value="">全部等级</option>
            {levels.map(([value, label]) => (
              <option key={value} value={value}>
                {label}风险
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <label className="text-sm font-medium" htmlFor="risk-filter-category">
            分类
          </label>
          <select
            id="risk-filter-category"
            className={SELECT_CLASS}
            value={category}
            onChange={(event) => {
              setCategory(event.target.value as RiskCategory | '');
            }}
          >
            <option value="">全部分类</option>
            {categories.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error !== null && <p className="text-sm text-destructive">{error}</p>}
      {actionError !== null && <p className="text-sm text-destructive">{actionError}</p>}

      {risks.length === 0 ? (
        <EmptyState
          title="暂无符合条件的风险"
          description="新建风险后可按项目、状态、等级和分类集中跟踪。"
          action={
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              新建风险
            </Button>
          }
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {risks.map((risk) => (
            <li key={risk.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{risk.title}</span>
                  <Badge variant={levelVariant(risk.level)}>
                    {RISK_LEVEL_LABELS[risk.level]}风险
                  </Badge>
                  <Badge variant="outline">{RISK_STATUS_LABELS[risk.status]}</Badge>
                  <Badge variant="outline">{RISK_CATEGORY_LABELS[risk.category]}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {risk.project_name} · 负责人：{risk.owner || '未设置'} · 截止：
                  {risk.due_date ?? '未设置'} · 更新：{risk.updated_at}
                </p>
                {risk.description !== '' && (
                  <p className="mt-1 text-sm text-muted-foreground">{risk.description}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/projects/${encodeURIComponent(risk.project_id)}#project-risks`}>
                    查看项目
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`编辑风险：${risk.title}`}
                  disabled={busy}
                  onClick={() => {
                    setActionError(null);
                    setEditing(risk);
                    setFormOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`删除风险：${risk.title}`}
                  disabled={busy}
                  onClick={() => {
                    setPendingDelete(risk);
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <RiskForm
        open={formOpen}
        risk={editing}
        projects={projects}
        projectId={null}
        lockProject={editing !== null}
        onSubmit={async (input) => {
          const service = await getRiskService();
          if (editing === null) {
            await service.createRisk(input);
          } else {
            await service.updateRisk(editing.id, input);
          }
          await load();
        }}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除风险"
        description={
          pendingDelete === null
            ? ''
            : `确定删除「${pendingDelete.title}」（${pendingDelete.project_name}）吗？此操作不可撤销。`
        }
        confirmLabel="删除"
        destructive
        busy={busy}
        onCancel={() => {
          setPendingDelete(null);
        }}
        onConfirm={deleteRisk}
      />
    </div>
  );
}
