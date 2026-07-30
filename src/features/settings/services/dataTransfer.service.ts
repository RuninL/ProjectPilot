import { AppError } from '@/lib/errors';
import { executeBatch, type BatchStatement } from '@/lib/commands';
import { getDb } from '@/lib/db';
import {
  createDataTransferRepository,
  type DatabaseSnapshot,
  type DataTransferRepository,
} from '@/repositories/dataTransfer.repo';
import type { Task, TaskDependency } from '@/types';
import { buildDependencyGraph, hasCycle } from '@/services/dependencyGraph';
import { calculateRiskLevel } from '@/services/riskLevel';
import {
  DATA_SCHEMA_VERSION,
  projectPilotExportSchema,
  type EntityCounts,
  type ExportData,
  type ProjectPilotExport,
} from '../data/dataTransfer.schema';

export type ImportMode = 'merge' | 'replace';

export interface ImportResult {
  inserted: EntityCounts;
  skipped: EntityCounts;
}

export interface ImportPreview extends ImportResult {
  deleted: EntityCounts;
}

export interface DataTransferServiceDeps {
  repository: DataTransferRepository;
  runBatch: (statements: BatchStatement[]) => Promise<number>;
}

const ENTITY_KEYS = [
  'projects',
  'meetings',
  'tasks',
  'taskDependencies',
  'milestones',
  'actionItems',
  'projectLinks',
  'risks',
  'appSettings',
  'people',
  'projectParticipants',
  'taskParticipants',
] as const;

export function createDataTransferService(deps: DataTransferServiceDeps) {
  return {
    async getCurrentStatistics(): Promise<EntityCounts> {
      return countSnapshot(await deps.repository.readSnapshot());
    },

    async readSnapshot(): Promise<DatabaseSnapshot> {
      return deps.repository.readSnapshot();
    },

    async exportData(
      appVersion: string,
      exportedAt = new Date().toISOString(),
      includeSample = false,
    ): Promise<ProjectPilotExport> {
      const complete = await deps.repository.readSnapshot();
      const snapshot = includeSample ? complete : withoutSampleData(complete);
      return projectPilotExportSchema.parse({
        schemaVersion: DATA_SCHEMA_VERSION,
        exportedAt,
        appVersion,
        statistics: countSnapshot(snapshot),
        data: snapshot,
      });
    },

    parseImport(contents: string): ProjectPilotExport {
      let raw: unknown;
      try {
        raw = JSON.parse(contents) as unknown;
      } catch (cause) {
        throw new AppError('validation', 'JSON 文件格式无效，未修改任何数据。', {
          retryable: false,
          cause,
        });
      }

      const parsed = projectPilotExportSchema.safeParse(raw);
      if (!parsed.success) {
        const reason = parsed.error.issues[0]?.message ?? '文件结构不完整';
        throw new AppError('validation', `导入校验失败：${reason}。未修改任何数据。`, {
          retryable: false,
          cause: parsed.error,
        });
      }
      assertStatistics(parsed.data);
      const normalized = normalizePeopleData(parsed.data.data);
      validateSnapshot(normalized);
      return {
        ...parsed.data,
        statistics: countSnapshot(normalized),
        data: normalized,
      };
    },

    async previewImport(file: ProjectPilotExport, mode: ImportMode): Promise<ImportPreview> {
      const current = await deps.repository.readSnapshot();
      const selected = selectImportRows(file.data, current, mode);
      validateSnapshot(mode === 'replace' ? selected : mergeSnapshots(current, selected));
      return {
        inserted: countSnapshot(selected),
        skipped:
          mode === 'replace'
            ? emptyCounts()
            : subtractCounts(countSnapshot(file.data), countSnapshot(selected)),
        deleted: mode === 'replace' ? countSnapshot(current) : emptyCounts(),
      };
    },

    async importData(file: ProjectPilotExport, mode: ImportMode): Promise<ImportResult> {
      const current = await deps.repository.readSnapshot();
      const incoming = file.data;
      const selected = selectImportRows(incoming, current, mode);
      const combined = mode === 'replace' ? selected : mergeSnapshots(current, selected);
      validateSnapshot(combined);

      const statements =
        mode === 'replace'
          ? [
              ...deps.repository.buildClearStatements(),
              ...deps.repository.buildInsertStatements(selected),
            ]
          : deps.repository.buildInsertStatements(selected);
      await deps.runBatch(statements);

      return {
        inserted: countSnapshot(selected),
        skipped:
          mode === 'replace'
            ? emptyCounts()
            : subtractCounts(countSnapshot(incoming), countSnapshot(selected)),
      };
    },
  };
}

function selectImportRows(
  incoming: ExportData,
  current: DatabaseSnapshot,
  mode: ImportMode,
): DatabaseSnapshot {
  if (mode === 'replace') return incoming;
  const selected = withoutConflicts(incoming, current);
  const people = new Set([...current.people, ...selected.people].map((row) => row.id));
  const projects = new Set([...current.projects, ...selected.projects].map((row) => row.id));
  const tasks = new Set([...current.tasks, ...selected.tasks].map((row) => row.id));
  return {
    ...selected,
    projectParticipants: selected.projectParticipants.filter(
      (row) => projects.has(row.project_id) && people.has(row.person_id),
    ),
    taskParticipants: selected.taskParticipants.filter(
      (row) => tasks.has(row.task_id) && people.has(row.person_id),
    ),
  };
}

export async function getDataTransferService(): Promise<DataTransferService> {
  const db = await getDb();
  return createDataTransferService({
    repository: createDataTransferRepository(db),
    runBatch: executeBatch,
  });
}

function countSnapshot(snapshot: DatabaseSnapshot): EntityCounts {
  return {
    projects: snapshot.projects.length,
    meetings: snapshot.meetings.length,
    tasks: snapshot.tasks.length,
    taskDependencies: snapshot.taskDependencies.length,
    milestones: snapshot.milestones.length,
    actionItems: snapshot.actionItems.length,
    projectLinks: snapshot.projectLinks.length,
    risks: snapshot.risks.length,
    appSettings: snapshot.appSettings.length,
    people: snapshot.people.length,
    projectParticipants: snapshot.projectParticipants.length,
    taskParticipants: snapshot.taskParticipants.length,
  };
}

function emptyCounts(): EntityCounts {
  return {
    projects: 0,
    meetings: 0,
    tasks: 0,
    taskDependencies: 0,
    milestones: 0,
    actionItems: 0,
    projectLinks: 0,
    risks: 0,
    appSettings: 0,
    people: 0,
    projectParticipants: 0,
    taskParticipants: 0,
  };
}

function subtractCounts(left: EntityCounts, right: EntityCounts): EntityCounts {
  const result = emptyCounts();
  for (const key of ENTITY_KEYS) {
    result[key] = left[key] - right[key];
  }
  return result;
}

function assertStatistics(file: ProjectPilotExport): void {
  const actual = countSnapshot(file.data);
  for (const key of ENTITY_KEYS) {
    if (file.statistics[key] !== actual[key]) {
      throw validationError(`统计摘要与 ${key} 实际记录数不一致`);
    }
  }
}

function withoutConflicts(incoming: ExportData, current: DatabaseSnapshot): DatabaseSnapshot {
  return {
    projects: excludeIds(incoming.projects, current.projects, (row) => row.id),
    meetings: excludeIds(incoming.meetings, current.meetings, (row) => row.id),
    tasks: excludeIds(incoming.tasks, current.tasks, (row) => row.id),
    taskDependencies: excludeIds(
      incoming.taskDependencies,
      current.taskDependencies,
      (row) => row.id,
    ),
    milestones: excludeIds(incoming.milestones, current.milestones, (row) => row.id),
    actionItems: excludeIds(incoming.actionItems, current.actionItems, (row) => row.id),
    projectLinks: excludeIds(incoming.projectLinks, current.projectLinks, (row) => row.id),
    risks: excludeIds(incoming.risks, current.risks, (row) => row.id),
    appSettings: excludeIds(incoming.appSettings, current.appSettings, (row) => row.key),
    people: incoming.people.filter(
      (row) =>
        !current.people.some(
          (existing) =>
            existing.id === row.id ||
            existing.name.trim().toLocaleLowerCase() === row.name.trim().toLocaleLowerCase(),
        ),
    ),
    projectParticipants: excludeIds(
      incoming.projectParticipants,
      current.projectParticipants,
      (row) => `${row.project_id}\u0000${row.person_id}`,
    ),
    taskParticipants: excludeIds(
      incoming.taskParticipants,
      current.taskParticipants,
      (row) => `${row.task_id}\u0000${row.person_id}`,
    ),
  };
}

function withoutSampleData(snapshot: DatabaseSnapshot): DatabaseSnapshot {
  const projects = snapshot.projects.filter((row) => row.is_sample === 0);
  const projectIds = new Set(projects.map((row) => row.id));
  const meetings = snapshot.meetings.filter(
    (row) => row.is_sample === 0 && (row.project_id === null || projectIds.has(row.project_id)),
  );
  const meetingIds = new Set(meetings.map((row) => row.id));
  const candidateTasks = snapshot.tasks.filter(
    (row) =>
      row.is_sample === 0 &&
      projectIds.has(row.project_id) &&
      (row.source_meeting_id === null || meetingIds.has(row.source_meeting_id)),
  );
  const candidateTaskIds = new Set(candidateTasks.map((row) => row.id));
  const tasks = candidateTasks.filter(
    (row) => row.parent_task_id === null || candidateTaskIds.has(row.parent_task_id),
  );
  const taskIds = new Set(tasks.map((row) => row.id));

  return {
    projects,
    meetings,
    tasks,
    taskDependencies: snapshot.taskDependencies.filter(
      (row) => taskIds.has(row.predecessor_id) && taskIds.has(row.successor_id),
    ),
    milestones: snapshot.milestones.filter(
      (row) =>
        row.is_sample === 0 &&
        projectIds.has(row.project_id) &&
        (row.linked_task_id === null || taskIds.has(row.linked_task_id)),
    ),
    actionItems: snapshot.actionItems.filter(
      (row) =>
        meetingIds.has(row.meeting_id) &&
        (row.converted_task_id === null || taskIds.has(row.converted_task_id)),
    ),
    projectLinks: snapshot.projectLinks.filter(
      (row) => row.is_sample === 0 && projectIds.has(row.project_id),
    ),
    risks: snapshot.risks.filter((row) => row.is_sample === 0 && projectIds.has(row.project_id)),
    appSettings: snapshot.appSettings,
    people: snapshot.people,
    projectParticipants: snapshot.projectParticipants.filter((row) =>
      projectIds.has(row.project_id),
    ),
    taskParticipants: snapshot.taskParticipants.filter((row) => taskIds.has(row.task_id)),
  };
}

function excludeIds<T>(
  incoming: readonly T[],
  current: readonly T[],
  keyOf: (row: T) => string,
): T[] {
  const existing = new Set(current.map(keyOf));
  return incoming.filter((row) => !existing.has(keyOf(row)));
}

function mergeSnapshots(current: DatabaseSnapshot, incoming: DatabaseSnapshot): DatabaseSnapshot {
  return {
    projects: [...current.projects, ...incoming.projects],
    meetings: [...current.meetings, ...incoming.meetings],
    tasks: [...current.tasks, ...incoming.tasks],
    taskDependencies: [...current.taskDependencies, ...incoming.taskDependencies],
    milestones: [...current.milestones, ...incoming.milestones],
    actionItems: [...current.actionItems, ...incoming.actionItems],
    projectLinks: [...current.projectLinks, ...incoming.projectLinks],
    risks: [...current.risks, ...incoming.risks],
    appSettings: [...current.appSettings, ...incoming.appSettings],
    people: [...current.people, ...incoming.people],
    projectParticipants: [...current.projectParticipants, ...incoming.projectParticipants],
    taskParticipants: [...current.taskParticipants, ...incoming.taskParticipants],
  };
}

function validateSnapshot(snapshot: DatabaseSnapshot): void {
  assertUniqueKeys(snapshot);
  const projectIds = new Set(snapshot.projects.map((row) => row.id));
  const meetingIds = new Set(snapshot.meetings.map((row) => row.id));
  const tasks = new Map(snapshot.tasks.map((row) => [row.id, row]));
  const taskIds = new Set(tasks.keys());
  const personIds = new Set(snapshot.people.map((row) => row.id));

  for (const meeting of snapshot.meetings) {
    assertNullableReference(meeting.project_id, projectIds, `会议 ${meeting.id} 的项目`);
  }
  for (const task of snapshot.tasks) {
    assertReference(task.project_id, projectIds, `任务 ${task.id} 的项目`);
    assertNullableReference(task.source_meeting_id, meetingIds, `任务 ${task.id} 的来源会议`);
    if (task.parent_task_id !== null) {
      const parent = tasks.get(task.parent_task_id);
      if (parent === undefined) {
        throw validationError(`任务 ${task.id} 的父任务不存在`);
      }
      if (parent.project_id !== task.project_id) {
        throw validationError(`任务 ${task.id} 与父任务不属于同一项目`);
      }
      if (parent.parent_task_id !== null) {
        throw validationError(`任务 ${task.id} 违反最多两层任务限制`);
      }
    }
  }
  for (const dependency of snapshot.taskDependencies) {
    assertReference(dependency.predecessor_id, taskIds, `依赖 ${dependency.id} 的前驱任务`);
    assertReference(dependency.successor_id, taskIds, `依赖 ${dependency.id} 的后继任务`);
    const predecessor = tasks.get(dependency.predecessor_id);
    const successor = tasks.get(dependency.successor_id);
    if (predecessor?.project_id !== successor?.project_id) {
      throw validationError(`依赖 ${dependency.id} 跨越了不同项目`);
    }
  }
  for (const milestone of snapshot.milestones) {
    assertReference(milestone.project_id, projectIds, `里程碑 ${milestone.id} 的项目`);
    assertNullableReference(milestone.linked_task_id, taskIds, `里程碑 ${milestone.id} 的关联任务`);
    if (
      milestone.linked_task_id !== null &&
      tasks.get(milestone.linked_task_id)?.project_id !== milestone.project_id
    ) {
      throw validationError(`里程碑 ${milestone.id} 的关联任务不属于同一项目`);
    }
  }
  const convertedTaskIds = new Set<string>();
  for (const item of snapshot.actionItems) {
    assertReference(item.meeting_id, meetingIds, `行动项 ${item.id} 的会议`);
    assertNullableReference(item.converted_task_id, taskIds, `行动项 ${item.id} 的转换任务`);
    if (item.converted_task_id !== null && item.converted_at === null) {
      throw validationError(`行动项 ${item.id} 缺少转换时间`);
    }
    if (item.converted_task_id !== null) {
      if (convertedTaskIds.has(item.converted_task_id)) {
        throw validationError(`多个行动项关联了同一个转换任务 ${item.converted_task_id}`);
      }
      convertedTaskIds.add(item.converted_task_id);
    }
  }
  for (const link of snapshot.projectLinks) {
    assertReference(link.project_id, projectIds, `项目链接 ${link.id} 的项目`);
  }
  for (const risk of snapshot.risks) {
    assertReference(risk.project_id, projectIds, `风险 ${risk.id} 的项目`);
    if (risk.level !== calculateRiskLevel(risk.likelihood, risk.impact)) {
      throw validationError(`风险 ${risk.id} 的等级与可能性、影响不一致`);
    }
    for (const person of snapshot.people) {
      if (person.name.trim() === '') {
        throw validationError(`人员 ${person.id} 的姓名不能为空`);
      }
    }
    for (const participant of snapshot.projectParticipants) {
      assertReference(participant.project_id, projectIds, '项目参与关系的项目');
      assertReference(participant.person_id, personIds, '项目参与关系的人员');
    }
    for (const participant of snapshot.taskParticipants) {
      assertReference(participant.task_id, taskIds, '任务参与关系的任务');
      assertReference(participant.person_id, personIds, '任务参与关系的人员');
    }
  }
  validateDependencyGraph(snapshot.tasks, snapshot.taskDependencies);
}

function assertUniqueKeys(snapshot: DatabaseSnapshot): void {
  assertUnique(
    snapshot.projects.map((row) => row.id),
    '项目 ID',
  );
  assertUnique(
    snapshot.meetings.map((row) => row.id),
    '会议 ID',
  );
  assertUnique(
    snapshot.tasks.map((row) => row.id),
    '任务 ID',
  );
  assertUnique(
    snapshot.taskDependencies.map((row) => row.id),
    '任务依赖 ID',
  );
  assertUnique(
    snapshot.milestones.map((row) => row.id),
    '里程碑 ID',
  );
  assertUnique(
    snapshot.actionItems.map((row) => row.id),
    '行动项 ID',
  );
  assertUnique(
    snapshot.projectLinks.map((row) => row.id),
    '项目链接 ID',
  );
  assertUnique(
    snapshot.risks.map((row) => row.id),
    '风险 ID',
  );
  assertUnique(
    snapshot.appSettings.map((row) => row.key),
    '设置键',
  );
  assertUnique(
    snapshot.people.map((row) => row.id),
    '人员 ID',
  );
  assertUnique(
    snapshot.people.map((row) => row.name.trim().toLocaleLowerCase()),
    '人员姓名',
  );
  assertUnique(
    snapshot.projectParticipants.map((row) => `${row.project_id}\u0000${row.person_id}`),
    '项目参与关系',
  );
  assertUnique(
    snapshot.taskParticipants.map((row) => `${row.task_id}\u0000${row.person_id}`),
    '任务参与关系',
  );
  assertUnique(
    snapshot.taskDependencies.map((row) => `${row.predecessor_id}\u0000${row.successor_id}`),
    '任务依赖关系',
  );
}

function normalizePeopleData(snapshot: DatabaseSnapshot): DatabaseSnapshot {
  const people: DatabaseSnapshot['people'] = [];
  const personIds = new Set<string>();
  const personNames = new Set<string>();
  for (const person of snapshot.people) {
    const name = person.name.trim().toLocaleLowerCase();
    if (personIds.has(person.id) || personNames.has(name)) continue;
    personIds.add(person.id);
    personNames.add(name);
    people.push(person);
  }
  const projectIds = new Set(snapshot.projects.map((row) => row.id));
  const taskIds = new Set(snapshot.tasks.map((row) => row.id));
  return {
    ...snapshot,
    people,
    projectParticipants: uniqueBy(
      snapshot.projectParticipants.filter(
        (row) => projectIds.has(row.project_id) && personIds.has(row.person_id),
      ),
      (row) => `${row.project_id}\u0000${row.person_id}`,
    ),
    taskParticipants: uniqueBy(
      snapshot.taskParticipants.filter(
        (row) => taskIds.has(row.task_id) && personIds.has(row.person_id),
      ),
      (row) => `${row.task_id}\u0000${row.person_id}`,
    ),
  };
}

function uniqueBy<T>(rows: readonly T[], keyOf: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = keyOf(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw validationError(`${label} 存在重复`);
  }
}

function assertReference(id: string, ids: ReadonlySet<string>, label: string): void {
  if (!ids.has(id)) {
    throw validationError(`${label}不存在`);
  }
}

function assertNullableReference(id: string | null, ids: ReadonlySet<string>, label: string): void {
  if (id !== null) {
    assertReference(id, ids, label);
  }
}

function validateDependencyGraph(
  tasks: readonly Task[],
  dependencies: readonly TaskDependency[],
): void {
  if (hasCycle(buildDependencyGraph([...tasks], [...dependencies]))) {
    throw validationError('任务依赖存在环');
  }
}

function validationError(message: string): AppError {
  return new AppError('validation', `导入校验失败：${message}。未修改任何数据。`, {
    retryable: false,
  });
}

export type DataTransferService = ReturnType<typeof createDataTransferService>;
