import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toAppError } from '@/lib/errors';
import {
  RISK_CATEGORY_OPTIONS,
  RISK_LEVEL_LABELS,
  RISK_STATUS_LABELS,
  RISK_STATUS_OPTIONS,
} from '@/lib/labels';
import { calculateRiskLevel } from '@/services/riskLevel';
import { canTransitionRiskStatus, RISK_STATUS_TRANSITIONS } from '@/services/risk.service';
import { riskInputSchema, type RiskInput } from '@/services/schemas';
import type { Project, Risk, RiskImpact, RiskLikelihood, RiskStatus } from '@/types';

interface RiskFormValues {
  project_id: string;
  title: string;
  description: string;
  category: Risk['category'];
  likelihood: RiskLikelihood;
  impact: RiskImpact;
  status: RiskStatus;
  owner: string;
  mitigation_plan: string;
  due_date: string;
}

const SELECT_CLASS =
  'h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

function toFormValues(risk: Risk | null, projectId: string | null): RiskFormValues {
  return {
    project_id: risk?.project_id ?? projectId ?? '',
    title: risk?.title ?? '',
    description: risk?.description ?? '',
    category: risk?.category ?? 'other',
    likelihood: risk?.likelihood ?? 'medium',
    impact: risk?.impact ?? 'medium',
    status: risk?.status ?? 'open',
    owner: risk?.owner ?? '',
    mitigation_plan: risk?.mitigation_plan ?? '',
    due_date: risk?.due_date ?? '',
  };
}

function availableStatuses(risk: Risk | null): readonly RiskStatus[] {
  if (risk === null) {
    return RISK_STATUS_OPTIONS.map((option) => option.value);
  }
  return RISK_STATUS_OPTIONS.map((option) => option.value).filter(
    (status) => status === risk.status || canTransitionRiskStatus(risk.status, status),
  );
}

interface RiskFormProps {
  open: boolean;
  risk: Risk | null;
  projects: readonly Project[];
  /** Preselected owning project when opened from a project detail. */
  projectId: string | null;
  /** Project ownership may not change while editing or from a project detail. */
  lockProject: boolean;
  onSubmit: (input: RiskInput) => Promise<void>;
  onClose: () => void;
}

/** Create/edit dialog that previews the persisted likelihood × impact risk level. */
export function RiskForm({
  open,
  risk,
  projects,
  projectId,
  lockProject,
  onSubmit,
  onClose,
}: RiskFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RiskFormValues>({
    resolver: zodResolver(riskInputSchema, undefined, { raw: true }),
    defaultValues: toFormValues(risk, projectId),
  });
  const likelihood = watch('likelihood');
  const impact = watch('impact');
  const level = calculateRiskLevel(likelihood, impact);
  const statuses = availableStatuses(risk);

  useEffect(() => {
    if (open) {
      reset(toFormValues(risk, projectId));
    }
  }, [open, projectId, reset, risk]);

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(riskInputSchema.parse(values));
      onClose();
    } catch (caught) {
      setError('root', { message: toAppError(caught).message });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{risk === null ? '新建风险' : '编辑风险'}</DialogTitle>
          <DialogDescription>
            风险等级会根据可能性和影响实时计算；状态只能按允许的生命周期变更。
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            void submit(event);
          }}
          noValidate
        >
          <div className="grid gap-1.5">
            <Label htmlFor="risk-project">所属项目</Label>
            <select
              id="risk-project"
              className={SELECT_CLASS}
              disabled={lockProject || risk !== null}
              {...register('project_id')}
            >
              <option value="">请选择项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            {(lockProject || risk !== null) && (
              <p className="text-xs text-muted-foreground">风险不能移动到其他项目。</p>
            )}
            {errors.project_id && (
              <p className="text-sm text-destructive">{errors.project_id.message}</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="risk-title">风险标题</Label>
            <Input id="risk-title" {...register('title')} />
            {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="risk-description">风险描述</Label>
            <Textarea id="risk-description" rows={3} {...register('description')} />
            {errors.description && (
              <p className="text-sm text-destructive">{errors.description.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="risk-category">分类</Label>
              <select id="risk-category" className={SELECT_CLASS} {...register('category')}>
                {RISK_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {errors.category && (
                <p className="text-sm text-destructive">{errors.category.message}</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="risk-status">状态</Label>
              <select id="risk-status" className={SELECT_CLASS} {...register('status')}>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {RISK_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
              {risk !== null && (
                <p className="text-xs text-muted-foreground">
                  可变更为：
                  {RISK_STATUS_TRANSITIONS[risk.status]
                    .map((status) => RISK_STATUS_LABELS[status])
                    .join('、') || '无'}
                </p>
              )}
              {errors.status && <p className="text-sm text-destructive">{errors.status.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="risk-likelihood">可能性</Label>
              <select id="risk-likelihood" className={SELECT_CLASS} {...register('likelihood')}>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
              {errors.likelihood && (
                <p className="text-sm text-destructive">{errors.likelihood.message}</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="risk-impact">影响</Label>
              <select id="risk-impact" className={SELECT_CLASS} {...register('impact')}>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
              {errors.impact && <p className="text-sm text-destructive">{errors.impact.message}</p>}
            </div>
          </div>

          <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm" aria-live="polite">
            当前等级：<strong>{RISK_LEVEL_LABELS[level]}风险</strong>
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="risk-owner">负责人</Label>
              <Input id="risk-owner" {...register('owner')} />
              {errors.owner && <p className="text-sm text-destructive">{errors.owner.message}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="risk-due-date">截止日期</Label>
              <Input id="risk-due-date" type="date" {...register('due_date')} />
              {errors.due_date && (
                <p className="text-sm text-destructive">{errors.due_date.message}</p>
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="risk-mitigation-plan">缓解计划</Label>
            <Textarea id="risk-mitigation-plan" rows={3} {...register('mitigation_plan')} />
            {errors.mitigation_plan && (
              <p className="text-sm text-destructive">{errors.mitigation_plan.message}</p>
            )}
          </div>

          {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
