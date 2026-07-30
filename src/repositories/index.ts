import { getDb } from '@/lib/db';
import { createActionItemRepository } from './actionItem.repo';
import { createAppSettingRepository } from './appSetting.repo';
import { createDataTransferRepository } from './dataTransfer.repo';
import { createMeetingRepository } from './meeting.repo';
import { createMilestoneRepository } from './milestone.repo';
import { createPeopleRepository } from './people.repo';
import { createProjectRepository } from './project.repo';
import { createProjectLinkRepository } from './projectLink.repo';
import { createRecurrenceRepository } from './recurrence.repo';
import { createRiskRepository } from './risk.repo';
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
export * from './risk.repo';
export * from './dataTransfer.repo';
export * from './people.repo';
export * from './recurrence.repo';

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
    dataTransfer: createDataTransferRepository(db),
    sample: createSampleDataRepository(db),
    risks: createRiskRepository(db),
    people: createPeopleRepository(db),
    recurrence: createRecurrenceRepository(db),
  };
}

export type Repositories = Awaited<ReturnType<typeof getRepositories>>;
