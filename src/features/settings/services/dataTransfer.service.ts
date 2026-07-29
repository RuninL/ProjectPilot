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
    ): Promise<ProjectPilotExport> {
      const snapshot = await deps.repository.readSnapshot();
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
      validateSnapshot(parsed.data.data);
      return parsed.data;
    },

    async importData(file: ProjectPilotExport, mode: ImportMode): Promise<ImportResult> {
      const current = await deps.repository.readSnapshot();
      const incoming = file.data;
      const selected = mode === 'replace' ? incoming : withoutConflicts(incoming, current);
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
  };
}

function validateSnapshot(snapshot: DatabaseSnapshot): void {
  assertUniqueKeys(snapshot);
  const projectIds = new Set(snapshot.projects.map((row) => row.id));
  const meetingIds = new Set(snapshot.meetings.map((row) => row.id));
  const tasks = new Map(snapshot.tasks.map((row) => [row.id, row]));
  const taskIds = new Set(tasks.keys());

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
    snapshot.taskDependencies.map((row) => `${row.predecessor_id}\u0000${row.successor_id}`),
    '任务依赖关系',
  );
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
