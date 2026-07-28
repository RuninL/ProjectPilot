import { getDb } from '@/lib/db';
import { createActionItemRepository } from './actionItem.repo';
import { createAppSettingRepository } from './appSetting.repo';
import { createMeetingRepository } from './meeting.repo';
import { createMilestoneRepository } from './milestone.repo';
import { createProjectRepository } from './project.repo';
import { createProjectLinkRepository } from './projectLink.repo';
import { createSampleDataRepository } from './sample.repo';
import { createTaskRepository } from './task.repo';
import { createTaskDependencyRepository } from './taskDependency.repo';

export * from './project.repo';
export * from './task.repo';
export * from './taskDependency.repo';
export * from './milestone.repo';
export * from './meeting.repo';
export * from './actionItem.repo';
export * from './projectLink.repo';
export * from './appSetting.repo';
export * from './sample.repo';

/** Build every repository bound to the live SQLite singleton. */
export async function getRepositories() {
  const db = await getDb();
  return {
    projects: createProjectRepository(db),
    tasks: createTaskRepository(db),
    taskDependencies: createTaskDependencyRepository(db),
    milestones: createMilestoneRepository(db),
    meetings: createMeetingRepository(db),
    actionItems: createActionItemRepository(db),
    projectLinks: createProjectLinkRepository(db),
    appSettings: createAppSettingRepository(db),
    sample: createSampleDataRepository(db),
  };
}

export type Repositories = Awaited<ReturnType<typeof getRepositories>>;
