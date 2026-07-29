import {
  MILESTONE_STATUS_LABELS,
  RISK_CATEGORY_LABELS,
  RISK_LEVEL_LABELS,
  RISK_STATUS_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
} from '@/lib/labels';
import type { DatabaseSnapshot } from '@/repositories/dataTransfer.repo';

export type CsvEntity = 'tasks' | 'milestones' | 'risks';

export function createCsv(
  entity: CsvEntity,
  snapshot: DatabaseSnapshot,
  projectId: string | null,
): string {
  const projectNames = new Map(snapshot.projects.map((project) => [project.id, project.name]));
  if (entity === 'tasks') {
    return serializeCsv(
      [
        '任务 ID',
        '项目',
        '父任务 ID',
        '标题',
        '描述',
        '状态',
        '优先级',
        '开始日期',
        '截止日期',
        '进度',
        '预计工时',
        '实际工时',
        '完成时间',
        '归档时间',
        '来源会议 ID',
        '是否示例',
        '创建时间',
        '更新时间',
      ],
      snapshot.tasks
        .filter((row) => projectId === null || row.project_id === projectId)
        .map((row) => [
          row.id,
          projectNames.get(row.project_id) ?? row.project_id,
          row.parent_task_id,
          row.title,
          row.description,
          TASK_STATUS_LABELS[row.status],
          TASK_PRIORITY_LABELS[row.priority],
          row.start_date,
          row.due_date,
          row.progress,
          row.estimated_hours,
          row.actual_hours,
          row.completed_at,
          row.archived_at,
          row.source_meeting_id,
          row.is_sample === 1 ? '是' : '否',
          row.created_at,
          row.updated_at,
        ]),
    );
  }
  if (entity === 'milestones') {
    return serializeCsv(
      [
        '里程碑 ID',
        '项目',
        '关联任务 ID',
        '名称',
        '描述',
        '日期',
        '状态',
        '达成时间',
        '是否示例',
        '创建时间',
        '更新时间',
      ],
      snapshot.milestones
        .filter((row) => projectId === null || row.project_id === projectId)
        .map((row) => [
          row.id,
          projectNames.get(row.project_id) ?? row.project_id,
          row.linked_task_id,
          row.name,
          row.description,
          row.date,
          MILESTONE_STATUS_LABELS[row.status],
          row.achieved_at,
          row.is_sample === 1 ? '是' : '否',
          row.created_at,
          row.updated_at,
        ]),
    );
  }
  return serializeCsv(
    [
      '风险 ID',
      '项目',
      '标题',
      '描述',
      '类别',
      '可能性',
      '影响',
      '等级',
      '状态',
      '负责人',
      '缓解计划',
      '截止日期',
      '解决时间',
      '是否示例',
      '创建时间',
      '更新时间',
    ],
    snapshot.risks
      .filter((row) => projectId === null || row.project_id === projectId)
      .map((row) => [
        row.id,
        projectNames.get(row.project_id) ?? row.project_id,
        row.title,
        row.description,
        RISK_CATEGORY_LABELS[row.category],
        RISK_LEVEL_LABELS[row.likelihood],
        RISK_LEVEL_LABELS[row.impact],
        RISK_LEVEL_LABELS[row.level],
        RISK_STATUS_LABELS[row.status],
        row.owner,
        row.mitigation_plan,
        row.due_date,
        row.resolved_at,
        row.is_sample === 1 ? '是' : '否',
        row.created_at,
        row.updated_at,
      ]),
  );
}

type CsvCell = string | number | null;

export function serializeCsv(headers: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => row.map(escapeCell).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function escapeCell(value: CsvCell): string {
  const text = value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
