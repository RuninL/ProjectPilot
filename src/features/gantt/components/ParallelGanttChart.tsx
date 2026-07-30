import { Link } from 'react-router-dom';
import { PROJECT_STATUS_LABELS } from '@/lib/labels';
import type { ParallelGanttViewModel } from '../parallelGanttViewModel';

interface ParallelGanttChartProps {
  model: ParallelGanttViewModel;
}

const LABEL_WIDTH = 220;
const HEADER_HEIGHT = 30;
const BAR_HEIGHT = 20;

export function ParallelGanttChart({ model }: ParallelGanttChartProps) {
  if (model.rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        当前筛选下没有项目。
      </p>
    );
  }

  return (
    <div>
      <div className="flex overflow-hidden rounded-lg border bg-card">
        <div className="shrink-0 border-r" style={{ width: LABEL_WIDTH }}>
          <div
            className="flex items-end border-b px-3 pb-1 text-xs text-muted-foreground"
            style={{ height: HEADER_HEIGHT }}
          >
            项目
          </div>
          {model.rows.map((row) => (
            <Link
              key={row.projectId}
              to={`/projects/${encodeURIComponent(row.projectId)}`}
              className="flex items-center gap-2 border-b px-3 text-sm last:border-b-0 hover:bg-accent"
              style={{ height: model.rowHeight }}
              title={row.fallback ?? undefined}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              <span className="text-xs text-muted-foreground">
                {PROJECT_STATUS_LABELS[row.status]}
              </span>
            </Link>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <svg
            width={model.width}
            height={HEADER_HEIGHT + model.height}
            role="img"
            aria-label={`跨项目并行甘特图，${model.rangeStart} 至 ${model.rangeEnd}`}
          >
            {model.ticks.map((tick) => (
              <g key={tick.key}>
                <line
                  x1={tick.x}
                  y1={0}
                  x2={tick.x}
                  y2={HEADER_HEIGHT + model.height}
                  stroke="currentColor"
                  strokeOpacity={0.12}
                />
                <text x={tick.x + 4} y={19} fontSize={11} className="fill-muted-foreground">
                  {tick.label}
                </text>
              </g>
            ))}
            <g transform={`translate(0, ${String(HEADER_HEIGHT)})`}>
              {model.rows.map((row) => (
                <g key={row.projectId}>
                  <title>
                    {`${row.name}：${PROJECT_STATUS_LABELS[row.status]}，${row.startDate} 至 ${row.endDate}，整体进度 ${String(row.progress)}%${row.fallback === null ? '' : `；${row.fallback}`}`}
                  </title>
                  <line
                    x1={0}
                    y1={row.y + model.rowHeight}
                    x2={model.width}
                    y2={row.y + model.rowHeight}
                    stroke="currentColor"
                    strokeOpacity={0.08}
                  />
                  <rect
                    x={row.x}
                    y={row.y + (model.rowHeight - BAR_HEIGHT) / 2}
                    width={Math.max(row.width, 2)}
                    height={BAR_HEIGHT}
                    rx={4}
                    fill={row.color}
                    fillOpacity={0.28}
                    stroke={row.color}
                  />
                  <rect
                    x={row.x}
                    y={row.y + (model.rowHeight - BAR_HEIGHT) / 2}
                    width={Math.max((row.width * row.progress) / 100, 0)}
                    height={BAR_HEIGHT}
                    rx={4}
                    fill={row.color}
                  />
                  <text
                    x={row.x + 5}
                    y={row.y + model.rowHeight / 2 + 4}
                    fontSize={11}
                    className="fill-foreground"
                  >
                    {`${String(row.progress)}% · ${PROJECT_STATUS_LABELS[row.status]}`}
                  </text>
                </g>
              ))}
            </g>
            <line
              x1={model.todayX}
              y1={0}
              x2={model.todayX}
              y2={HEADER_HEIGHT + model.height}
              stroke="#F59E0B"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text x={model.todayX + 3} y={10} fontSize={10} fill="#B45309">
              今天
            </text>
          </svg>
        </div>
      </div>
      {model.rows.some((row) => row.fallback !== null) && (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {model.rows
            .filter((row) => row.fallback !== null)
            .map((row) => (
              <li key={row.projectId}>
                {row.name}：{row.fallback}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
