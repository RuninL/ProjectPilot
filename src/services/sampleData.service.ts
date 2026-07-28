import type { BatchStatement } from '@/lib/commands';
import { executeBatch } from '@/lib/commands';
import { nowIso, todayHK } from '@/lib/date';
import { newId } from '@/lib/uuid';
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
  title: string;
  description: string;
  status: Task['status'];
  priority: Task['priority'];
  progress: number;
}

const SAMPLE_PROJECT_NAME = '示例项目：新版官网上线';

/**
 * Tasks carry no dates on purpose: the sample must never look overdue and must
 * not depend on the machine clock beyond the project's start date.
 */
const SAMPLE_TASKS: SampleTaskSeed[] = [
  {
    title: '梳理页面结构与信息架构',
    description: '确认首页、产品页与联系页的层级关系。',
    status: 'done',
    priority: 'high',
    progress: 100,
  },
  {
    title: '完成视觉稿评审',
    description: '与设计确认配色、字体与暗色主题细节。',
    status: 'in_progress',
    priority: 'medium',
    progress: 40,
  },
  {
    title: '接入内容管理后台',
    description: '打通文章与产品数据的录入流程。',
    status: 'todo',
    priority: 'medium',
    progress: 0,
  },
];

function buildSampleProject(now: string): Project {
  return {
    id: newId(),
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
    id: newId(),
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
