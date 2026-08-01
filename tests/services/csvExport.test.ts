import { createCsv, serializeCsv } from '@/features/settings/services/csvExport';
import type { DatabaseSnapshot } from '@/repositories/dataTransfer.repo';

function emptySnapshot(): DatabaseSnapshot {
  return {
    projects: [],
    meetings: [],
    tasks: [],
    taskDependencies: [],
    recurrenceRules: [],
    recurrenceExceptions: [],
    milestones: [],
    actionItems: [],
    projectLinks: [],
    risks: [],
    appSettings: [],
    people: [],
    projectParticipants: [],
    taskParticipants: [],
    namedListOrders: [],
    taskProgressUpdates: [],
    taskChecklistItems: [],
  };
}

describe('CSV 导出', () => {
  it('包含 UTF-8 BOM、中文表头并正确转义特殊字符', () => {
    const csv = serializeCsv(['标题', '描述'], [['含,逗号', '引号"与\n换行']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe('\uFEFF标题,描述\r\n"含,逗号","引号""与\n换行"\r\n');
  });

  it('中和 Excel 公式前缀', () => {
    expect(serializeCsv(['标题'], [['=1+1'], ['@命令'], ['正常']])).toBe(
      "\uFEFF标题\r\n'=1+1\r\n'@命令\r\n正常\r\n",
    );
  });

  it.each([
    ['projects', '项目 ID'],
    ['tasks', '任务 ID'],
    ['milestones', '里程碑 ID'],
    ['risks', '风险 ID'],
  ] as const)('%s 空数据仍输出合法表头', (entity, header) => {
    const csv = createCsv(entity, emptySnapshot(), null);
    expect(csv.startsWith(`\uFEFF${header},`)).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('状态、优先级与风险枚举输出中文', () => {
    const base = emptySnapshot();
    const snapshot: DatabaseSnapshot = {
      ...base,
      projects: [
        {
          id: 'p1',
          name: '项目',
          description: '',
          status: 'active',
          color: '#2563EB',
          start_date: null,
          target_end_date: null,
          archived_at: null,
          is_sample: 0,
          created_at: '2026-07-14T00:00:00Z',
          updated_at: '2026-07-14T00:00:00Z',
        },
      ],
      tasks: [
        {
          id: 't1',
          project_id: 'p1',
          parent_task_id: null,
          title: '任务',
          description: '',
          status: 'in_progress',
          priority: 'urgent',
          start_date: null,
          due_date: null,
          progress: 20,
          estimated_hours: null,
          actual_hours: null,
          completed_at: null,
          archived_at: null,
          archived_source: null,
          source_meeting_id: null,
          source_rule_id: null,
          source_occurrence_date: null,
          is_sample: 0,
          created_at: '2026-07-14T00:00:00Z',
          updated_at: '2026-07-14T00:00:00Z',
        },
      ],
      risks: [
        {
          id: 'r1',
          project_id: 'p1',
          title: '风险',
          description: '',
          category: 'technical',
          likelihood: 'high',
          impact: 'high',
          level: 'critical',
          status: 'monitoring',
          owner: '',
          mitigation_plan: '',
          due_date: null,
          resolved_at: null,
          is_sample: 0,
          created_at: '2026-07-14T00:00:00Z',
          updated_at: '2026-07-14T00:00:00Z',
        },
      ],
    };
    expect(createCsv('tasks', snapshot, null)).toContain('进行中,紧急');
    expect(createCsv('risks', snapshot, null)).toContain('技术,高,高,严重,监控中');
  });

  it('为项目和任务导出各自独立的参与人列并保留公式防护', () => {
    const base = emptySnapshot();
    const project = {
      id: 'p1',
      name: '项目',
      description: '',
      status: 'active' as const,
      color: '#2563EB',
      start_date: null,
      target_end_date: null,
      archived_at: null,
      is_sample: 0 as const,
      created_at: '2026-07-14T00:00:00Z',
      updated_at: '2026-07-14T00:00:00Z',
    };
    const task = {
      id: 't1',
      project_id: 'p1',
      parent_task_id: null,
      title: '任务',
      description: '',
      status: 'todo' as const,
      priority: 'medium' as const,
      start_date: null,
      due_date: null,
      progress: 0,
      estimated_hours: null,
      actual_hours: null,
      completed_at: null,
      archived_at: null,
      archived_source: null,
      source_meeting_id: null,
      source_rule_id: null,
      source_occurrence_date: null,
      is_sample: 0 as const,
      created_at: '2026-07-14T00:00:00Z',
      updated_at: '2026-07-14T00:00:00Z',
    };
    const snapshot: DatabaseSnapshot = {
      ...base,
      projects: [project],
      tasks: [task],
      people: [
        {
          id: 'project-person',
          name: '=项目成员',
          email: null,
          role: null,
          note: null,
          created_at: project.created_at,
          updated_at: project.updated_at,
        },
        {
          id: 'task-person',
          name: '任务成员',
          email: null,
          role: null,
          note: null,
          created_at: project.created_at,
          updated_at: project.updated_at,
        },
      ],
      projectParticipants: [
        { project_id: 'p1', person_id: 'project-person', role: '', joined_at: project.created_at },
      ],
      taskParticipants: [
        { task_id: 't1', person_id: 'task-person', assigned_at: project.created_at },
      ],
    };

    expect(createCsv('projects', snapshot, null)).toContain('参与人');
    expect(createCsv('projects', snapshot, null)).toContain("'=项目成员");
    expect(createCsv('projects', snapshot, null)).not.toContain('任务成员');
    expect(createCsv('tasks', snapshot, null)).toContain('任务成员');
    expect(createCsv('tasks', snapshot, null)).not.toContain('=项目成员');
  });
});
