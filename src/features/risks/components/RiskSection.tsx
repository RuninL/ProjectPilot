import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RISK_CATEGORY_LABELS, RISK_LEVEL_LABELS, RISK_STATUS_LABELS } from '@/lib/labels';
import { toAppError } from '@/lib/errors';
import { getRiskService } from '@/services/risk.service';
import type { Project, Risk } from '@/types';
import { RiskForm } from './RiskForm';

interface RiskSectionProps {
  project: Project;
}

function levelVariant(level: Risk['level']): 'destructive' | 'outline' {
  return level === 'critical' || level === 'high' ? 'destructive' : 'outline';
}

/** One project's risk register, including all write controls in the owning context. */
export function RiskSection({ project }: RiskSectionProps) {
  const [risks, setRisks] = useState<Risk[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Risk | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Risk | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const service = await getRiskService();
      const rows = await service.listRisks({ projectIds: [project.id] });
      setRisks(rows);
    } catch (caught) {
      setError(toAppError(caught).message);
    }
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (risks === null && error === null) {
    return <LoadingState label="正在加载风险…" />;
  }
  if (risks === null) {
    return (
      <ErrorState
        title="无法加载风险"
        message={error ?? '无法读取项目风险'}
        onRetry={() => {
          void load();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          等级由可能性和影响自动计算；状态变更遵循风险生命周期。
        </p>
        <Button
          size="sm"
          onClick={() => {
            setActionError(null);
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden />
          新建风险
        </Button>
      </div>
      {actionError !== null && <p className="text-sm text-destructive">{actionError}</p>}
      {risks.length === 0 ? (
        <EmptyState
          title="暂无风险"
          description="登记风险后可记录负责人、缓解计划和生命周期状态。"
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {risks.map((risk) => (
            <li key={risk.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{risk.title}</span>
                  <Badge variant={levelVariant(risk.level)}>
                    {RISK_LEVEL_LABELS[risk.level]}风险
                  </Badge>
                  <Badge variant="outline">{RISK_STATUS_LABELS[risk.status]}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {RISK_CATEGORY_LABELS[risk.category]} · 负责人：{risk.owner || '未设置'} · 截止：
                  {risk.due_date ?? '未设置'}
                </p>
                {risk.mitigation_plan !== '' && (
                  <p className="text-xs text-muted-foreground">缓解：{risk.mitigation_plan}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
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
        projects={[project]}
        projectId={project.id}
        lockProject
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
          pendingDelete === null ? '' : `确定删除风险「${pendingDelete.title}」吗？此操作不可撤销。`
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
