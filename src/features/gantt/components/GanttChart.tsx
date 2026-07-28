import { TASK_STATUS_LABELS } from '@/lib/labels';
import type { TaskStatus } from '@/types';
import type { GanttLink, GanttRow, GanttViewModel } from '../ganttViewModel';

/**
 * Hand-written SVG Gantt renderer. It draws exactly what the view model already
 * computed and owns no geometry of its own, so the only thing untestable without
 * a DOM is the markup.
 *
 * Colour is never the sole carrier of meaning: every bar also exposes its status
 * in the accessible name and in the tooltip, the legend spells each status out in
 * words, and conflicts are drawn as a dashed outline as well as a red stroke.
 */

interface GanttChartProps {
  model: GanttViewModel;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string | null) => void;
}

const STATUS_FILL: Record<TaskStatus, string> = {
  todo: '#94A3B8',
  in_progress: '#2563EB',
  blocked: '#DC2626',
  done: '#16A34A',
  cancelled: '#CBD5E1',
};

const CONFLICT_STROKE = '#DC2626';

function barLabel(row: GanttRow): string {
  const range = row.singleDay
    ? `${row.startDate}（未设置截止日期，按单日显示）`
    : `${row.startDate} 至 ${row.endDate}`;
  const risk = row.blockedBy.length === 0 ? '' : `，受阻风险来自：${row.blockedBy.join('、')}`;
  const conflict = row.hasConflict ? '，存在排期冲突' : '';
  return `${row.title}：${TASK_STATUS_LABELS[row.status]}，${range}${conflict}${risk}`;
}

function linkPoints(link: GanttLink): string {
  return link.points.map((point) => `${String(point.x)},${String(point.y)}`).join(' ');
}

export function GanttChart({ model, selectedTaskId, onSelectTask }: GanttChartProps) {
  const chartHeight = model.headerHeight + Math.max(model.height, model.rowHeight);

  return (
    <div className="flex rounded-lg border bg-card">
      <div
        className="shrink-0 border-r"
        style={{ width: model.labelWidth }}
        aria-hidden={model.rows.length === 0}
      >
        <div
          className="flex items-end border-b px-3 pb-1 text-xs text-muted-foreground"
          style={{ height: model.headerHeight }}
        >
          任务
        </div>
        <ul className="text-sm">
          {model.rows.map((row) => (
            <li
              key={row.taskId}
              className="flex items-center gap-1 border-b px-3 last:border-b-0"
              style={{ height: model.rowHeight }}
            >
              <button
                type="button"
                onClick={() => {
                  onSelectTask(row.taskId === selectedTaskId ? null : row.taskId);
                }}
                className={`truncate text-left hover:underline ${
                  row.taskId === selectedTaskId ? 'font-semibold' : ''
                }`}
                title={row.title}
              >
                {row.title}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="min-w-0 flex-1 overflow-x-auto">
        <svg
          width={model.width}
          height={chartHeight}
          role="img"
          aria-label={`甘特图时间轴，${model.rangeStart} 至 ${model.rangeEnd}`}
        >
          <defs>
            <marker
              id="gantt-arrow"
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L6,3 L0,6 z" fill="#64748B" />
            </marker>
            <marker
              id="gantt-arrow-conflict"
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L6,3 L0,6 z" fill={CONFLICT_STROKE} />
            </marker>
          </defs>

          {model.ticks.map((tick) => (
            <g key={tick.key}>
              <line
                x1={tick.x}
                y1={0}
                x2={tick.x}
                y2={chartHeight}
                stroke="currentColor"
                strokeOpacity={0.12}
              />
              <text
                x={tick.x + 4}
                y={model.headerHeight - 9}
                className="fill-muted-foreground"
                fontSize={11}
              >
                {tick.label}
              </text>
            </g>
          ))}
          <line
            x1={0}
            y1={model.headerHeight}
            x2={model.width}
            y2={model.headerHeight}
            stroke="currentColor"
            strokeOpacity={0.2}
          />

          <g transform={`translate(0, ${String(model.headerHeight)})`}>
            {model.rows.map((row) => (
              <line
                key={`grid-${row.taskId}`}
                x1={0}
                y1={row.y + model.rowHeight}
                x2={model.width}
                y2={row.y + model.rowHeight}
                stroke="currentColor"
                strokeOpacity={0.08}
              />
            ))}

            {model.links.map((link) => (
              <polyline
                key={link.id}
                points={linkPoints(link)}
                fill="none"
                stroke={link.hasConflict ? CONFLICT_STROKE : '#64748B'}
                strokeWidth={link.hasConflict ? 1.75 : 1.25}
                markerEnd={`url(#${link.hasConflict ? 'gantt-arrow-conflict' : 'gantt-arrow'})`}
              />
            ))}

            {model.rows.map((row) => (
              <g
                key={row.taskId}
                role="button"
                tabIndex={0}
                aria-label={barLabel(row)}
                aria-pressed={row.taskId === selectedTaskId}
                className="cursor-pointer focus:outline-none"
                onClick={() => {
                  onSelectTask(row.taskId === selectedTaskId ? null : row.taskId);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectTask(row.taskId === selectedTaskId ? null : row.taskId);
                  }
                }}
              >
                <title>{barLabel(row)}</title>
                <rect
                  x={row.bar.x}
                  y={row.bar.y}
                  width={Math.max(row.bar.width, 2)}
                  height={row.bar.height}
                  rx={3}
                  fill={STATUS_FILL[row.status]}
                  fillOpacity={row.taskId === selectedTaskId ? 1 : 0.85}
                  stroke={row.hasConflict ? CONFLICT_STROKE : 'none'}
                  strokeWidth={row.hasConflict ? 2 : 0}
                  strokeDasharray={row.hasConflict ? '3 2' : undefined}
                />
                {row.blockedBy.length > 0 && (
                  <text
                    x={row.bar.x + Math.max(row.bar.width, 2) + 4}
                    y={row.bar.y + row.bar.height - 5}
                    fontSize={11}
                    fill={CONFLICT_STROKE}
                  >
                    受阻风险
                  </text>
                )}
              </g>
            ))}
          </g>

          {model.todayX !== null && (
            <g>
              <line
                x1={model.todayX}
                y1={0}
                x2={model.todayX}
                y2={chartHeight}
                stroke="#F59E0B"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <text x={model.todayX + 3} y={11} fontSize={10} fill="#B45309">
                今天
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

/** Text-first legend: each colour is spelled out, so colour alone never carries meaning. */
export function GanttLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {(Object.keys(STATUS_FILL) as TaskStatus[]).map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: STATUS_FILL[status] }}
            aria-hidden
          />
          {TASK_STATUS_LABELS[status]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span
          className="inline-block h-2.5 w-2.5 rounded-sm border-2 border-dashed"
          style={{ borderColor: CONFLICT_STROKE }}
          aria-hidden
        />
        排期冲突
      </li>
      <li className="flex items-center gap-1.5">
        <span
          className="inline-block h-2.5 w-0 border-l-2 border-dashed border-amber-500"
          aria-hidden
        />
        今日线
      </li>
    </ul>
  );
}
