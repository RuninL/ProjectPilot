import { useMemo } from 'react';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { todayHK } from '@/lib/date';
import type { ProjectDependencyAnalysis } from '@/services/dependency.service';
import { useGanttStore, type GanttScale } from '@/stores/useGanttStore';
import { buildGanttViewModel, GANTT_SCALE_LABELS } from '../ganttViewModel';
import { GanttChart, GanttLegend } from './GanttChart';

/**
 * The Gantt panel on the project detail page: scale switch, chart, legend and
 * the plain-language notes that make the drawing honest — which tasks could not
 * be placed, which bars are single-day because they have no due date, and which
 * edges overrun. Read-only by design: nothing here writes to the database.
 */

interface GanttSectionProps {
  analysis: ProjectDependencyAnalysis | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

const SCALES: GanttScale[] = ['week', 'month', 'quarter'];

export function GanttSection({ analysis, loading, error, onRetry }: GanttSectionProps) {
  const scale = useGanttStore((state) => state.scale);
  const setScale = useGanttStore((state) => state.setScale);
  const selectedTaskId = useGanttStore((state) => state.selectedTaskId);
  const setSelectedTaskId = useGanttStore((state) => state.setSelectedTaskId);

  const model = useMemo(() => {
    if (analysis === null) {
      return null;
    }
    return buildGanttViewModel({
      tasks: analysis.tasks,
      dependencies: analysis.dependencies,
      conflicts: analysis.conflicts,
      blockedRisks: analysis.blockedRisks,
      scale,
      today: todayHK(),
    });
  }, [analysis, scale]);

  const titleOf = useMemo(
    () => new Map((analysis?.tasks ?? []).map((task) => [task.id, task.title])),
    [analysis],
  );

  if (loading && analysis === null) {
    return <LoadingState label="正在加载甘特图…" />;
  }

  if (error !== null) {
    return <ErrorState title="无法加载甘特图" message={error} onRetry={onRetry} />;
  }

  if (model === null) {
    return <LoadingState label="正在加载甘特图…" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="甘特图时间刻度">
          {SCALES.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={option === scale ? 'default' : 'outline'}
              aria-pressed={option === scale}
              onClick={() => {
                setScale(option);
              }}
            >
              {GANTT_SCALE_LABELS[option]}
            </Button>
          ))}
        </div>
        <Badge variant="outline">里程碑（后续阶段）</Badge>
      </div>

      {model.isEmpty ? (
        <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          该项目暂无可绘制的任务。为任务填写开始日期后，任务条会出现在这里。
        </p>
      ) : (
        <GanttChart
          model={model}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
        />
      )}

      <GanttLegend />

      {model.undated.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {`有 ${String(model.undated.length)} 个任务未设置开始日期，未绘制在甘特图中：`}
          {model.undated.map((task) => task.title).join('、')}
        </p>
      )}

      {model.rows.some((row) => row.singleDay) && (
        <p className="text-xs text-muted-foreground">
          未设置截止日期的任务按单日任务条显示，仅代表开始日期。
        </p>
      )}

      {analysis !== null && analysis.conflicts.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <h3 className="text-sm font-medium text-destructive">
            {`排期冲突（${String(analysis.conflicts.length)}）`}
          </h3>
          <ul className="mt-2 space-y-1 text-xs">
            {analysis.conflicts.map((conflict) => (
              <li key={conflict.edgeId} className="flex flex-wrap items-center gap-1">
                <span>
                  {`「${titleOf.get(conflict.predecessorId) ?? conflict.predecessorId}」截止 ${conflict.predecessorDueDate}，晚于「${titleOf.get(conflict.successorId) ?? conflict.successorId}」开始 ${conflict.successorStartDate}`}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    setSelectedTaskId(conflict.successorId);
                  }}
                >
                  在图中定位
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
