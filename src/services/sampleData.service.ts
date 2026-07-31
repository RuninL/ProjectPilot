import type { BatchStatement } from '@/lib/commands';
import { executeBatch } from '@/lib/commands';
import { nowIso, todayHK } from '@/lib/date';
import type {
  AppSettingRepository,
  ProjectRepository,
  SampleDataRepository,
  TaskRepository,
} from '@/repositories';
import { getRepositories } from '@/repositories';
import type { Project, Task } from '@/types';

/**
 * Presence of this `app_settings` key means seeding already ran. It is
 * deliberately NOT removed by `clearSampleData`, so data the user cleared never
 * comes back on the next launch.
 */
export const SAMPLE_SEEDED_KEY = 'sample_seeded';

export interface SampleDataDeps {
  projects: ProjectRepository;
  tasks: TaskRepository;
  appSettings: AppSettingRepository;
  sample: SampleDataRepository;
  runBatch: (statements: BatchStatement[]) => Promise<number>;
}

interface SampleTaskSeed {
  id: string;
  title: string;
  description: string;
  status: Task['status'];
  priority: Task['priority'];
  progress: number;
}

const SAMPLE_PROJECT_NAME = '示例项目：新版官网上线';

/**
 * Sample rows use fixed ids rather than `newId()`. They are the database-level
 * backstop against concurrent seeding: if two seed batches ever run at once,
 * the second collides on the primary key and — because a batch is one
 * transaction — rolls back whole instead of inserting a duplicate sample
 * project. `ensureSampleDataSeeded` prevents the race in the first place; this
 * makes a duplicate unrepresentable even if it slips through.
 */
export const SAMPLE_PROJECT_ID = '5f9b1e00-0000-4000-8000-000000000001';

/**
 * Tasks carry no dates on purpose: the sample must never look overdue and must
 * not depend on the machine clock beyond the project's start date.
 */
const SAMPLE_TASKS: SampleTaskSeed[] = [
  {
    id: '5f9b1e00-0000-4000-8000-000000000011',
    title: '梳理页面结构与信息架构',
    description: '确认首页、产品页与联系页的层级关系。',
    status: 'done',
    priority: 'high',
    progress: 100,
  },
  {
    id: '5f9b1e00-0000-4000-8000-000000000012',
    title: '完成视觉稿评审',
    description: '与设计确认配色、字体与暗色主题细节。',
    status: 'in_progress',
    priority: 'medium',
    progress: 40,
  },
  {
    id: '5f9b1e00-0000-4000-8000-000000000013',
    title: '接入内容管理后台',
    description: '打通文章与产品数据的录入流程。',
    status: 'todo',
    priority: 'medium',
    progress: 0,
  },
];

function buildSampleProject(now: string): Project {
  return {
    id: SAMPLE_PROJECT_ID,
    name: SAMPLE_PROJECT_NAME,
    description: '首次启动自动创建的示例项目，可在设置中一键清除。',
    status: 'active',
    color: '#6366f1',
    start_date: todayHK(),
    target_end_date: null,
    archived_at: null,
    is_sample: 1,
    created_at: now,
    updated_at: now,
  };
}

function buildSampleTask(seed: SampleTaskSeed, projectId: string, now: string): Task {
  return {
    id: seed.id,
    project_id: projectId,
    parent_task_id: null,
    title: seed.title,
    description: seed.description,
    status: seed.status,
    priority: seed.priority,
    start_date: null,
    due_date: null,
    progress: seed.progress,
    estimated_hours: null,
    actual_hours: null,
    completed_at: seed.status === 'done' ? now : null,
    archived_at: null,
    source_meeting_id: null,
    source_rule_id: null,
    source_occurrence_date: null,
    is_sample: 1,
    created_at: now,
    updated_at: now,
  };
}

/** Sample-data use cases. Every write is one all-or-nothing transaction. */
export function createSampleDataService(deps: SampleDataDeps) {
  return {
    /** True once seeding has run, regardless of whether the rows still exist. */
    async hasSeeded(): Promise<boolean> {
      return (await deps.appSettings.get(SAMPLE_SEEDED_KEY)) !== null;
    },

    /** True when sample rows are currently present. */
    async hasSampleData(): Promise<boolean> {
      return (await deps.sample.findSampleProjects()).length > 0;
    },

    /** The seeded project, or `null` after it was cleared. */
    async findSampleProject(): Promise<Project | null> {
      return (await deps.sample.findSampleProjects())[0] ?? null;
    },

    /**
     * Create the sample project and its tasks on first launch. Idempotent: a
     * second call is a no-op and returns `false`.
     */
    async seedSampleData(): Promise<boolean> {
      if ((await deps.appSettings.get(SAMPLE_SEEDED_KEY)) !== null) {
        return false;
      }
      const now = nowIso();
      const project = buildSampleProject(now);
      const statements: BatchStatement[] = [
        deps.projects.buildInsert(project),
        ...SAMPLE_TASKS.map((seed) =>
          deps.tasks.buildInsert(buildSampleTask(seed, project.id, now)),
        ),
        deps.appSettings.buildSet(SAMPLE_SEEDED_KEY, '1', now),
      ];
      await deps.runBatch(statements);
      return true;
    },

    /** Delete every `is_sample = 1` row — and nothing else — in one transaction. */
    async clearSampleData(): Promise<number> {
      return deps.runBatch(deps.sample.buildClear());
    },
  };
}

export type SampleDataService = ReturnType<typeof createSampleDataService>;

/** The service bound to the live database and the Rust `execute_batch` command. */
export async function getSampleDataService(): Promise<SampleDataService> {
  const repos = await getRepositories();
  return createSampleDataService({
    projects: repos.projects,
    tasks: repos.tasks,
    appSettings: repos.appSettings,
    sample: repos.sample,
    runBatch: executeBatch,
  });
}

let bootstrapSeed: Promise<boolean> | null = null;

/**
 * Bootstrap seeding, at most once per process.
 *
 * `seedSampleData` guards itself by reading `sample_seeded` first, but that is
 * check-then-insert: React 18 StrictMode mounts the bootstrap effect twice in
 * development, and both calls read the flag as absent before either writes it,
 * so both seed. Sharing one promise collapses the concurrent callers into a
 * single seed; the second caller awaits the first's result instead of starting
 * its own. Aborting the effect cannot help here — it only gates state updates,
 * not the transaction already in flight.
 */
export function ensureSampleDataSeeded(): Promise<boolean> {
  bootstrapSeed ??= getSampleDataService().then((service) => service.seedSampleData());
  return bootstrapSeed;
}

/** Clears the process-lifetime guard so each test starts from a cold bootstrap. */
export function resetSampleSeedGuardForTesting(): void {
  bootstrapSeed = null;
}
