import type { BatchStatement } from '@/lib/commands';
import { executeBatch } from '@/lib/commands';
import { nowIso } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/uuid';
import type {
  ActionItemRepository,
  MeetingRepository,
  ProjectRepository,
  TaskRepository,
} from '@/repositories';
import { getRepositories } from '@/repositories';
import type { ActionItem, Task } from '@/types';
import { conversionState } from './actionItemConversion';
import {
  actionItemInputSchema,
  convertActionItemSchema,
  type ActionItemInput,
  type ConvertActionItemInput,
} from './schemas';

export interface ActionItemServiceDeps {
  actionItems: ActionItemRepository;
  meetings: MeetingRepository;
  tasks: TaskRepository;
  projects: ProjectRepository;
  runBatch: (statements: BatchStatement[]) => Promise<number>;
}

/** Task titles are capped at 160; action item content at 300. */
const TASK_TITLE_MAX = 160;

/**
 * Owner has no home in `tasks` — this schema has no assignee column — so rather
 * than drop it, the conversion keeps it as the first line of the description
 * alongside the item's full, untruncated text.
 */
function conversionDescription(item: ActionItem): string {
  const lines = item.owner === '' ? [] : [`负责人：${item.owner}`];
  lines.push(item.content);
  return lines.join('\n');
}

const REJECTION_MESSAGES = {
  converted: '该行动项已转换为任务，请直接查看关联任务',
  task_deleted: '该行动项已转换过，但关联任务已被删除，无法再次转换',
} as const;

export function createActionItemService(deps: ActionItemServiceDeps) {
  async function requireItem(id: string): Promise<ActionItem> {
    const item = await deps.actionItems.findById(id);
    if (item === null) {
      throw new AppError('not_found', '行动项不存在或已被删除');
    }
    return item;
  }

  async function requireMeetingExists(meetingId: string): Promise<void> {
    if ((await deps.meetings.findById(meetingId)) === null) {
      throw new AppError('not_found', '会议不存在或已被删除');
    }
  }

  return {
    async listByMeeting(meetingId: string): Promise<ActionItem[]> {
      return deps.actionItems.findByMeeting(meetingId);
    },

    async createActionItem(meetingId: string, input: ActionItemInput): Promise<ActionItem> {
      await requireMeetingExists(meetingId);
      const parsed = actionItemInputSchema.parse(input);

      const now = nowIso();
      const item: ActionItem = {
        id: newId(),
        meeting_id: meetingId,
        content: parsed.content,
        owner: parsed.owner,
        due_date: parsed.due_date,
        status: parsed.status,
        converted_task_id: null,
        converted_at: null,
        created_at: now,
        updated_at: now,
      };
      await deps.actionItems.insert(item);
      return item;
    },

    /**
     * Edit the editable half of an action item. The conversion columns are not in
     * the repository's whitelist, so no edit can fabricate or clear a conversion.
     */
    async updateActionItem(id: string, input: ActionItemInput): Promise<ActionItem> {
      await requireItem(id);
      const parsed = actionItemInputSchema.parse(input);
      await deps.actionItems.update(
        id,
        {
          content: parsed.content,
          owner: parsed.owner,
          due_date: parsed.due_date,
          status: parsed.status,
        },
        nowIso(),
      );
      return requireItem(id);
    },

    /**
     * Deleting an action item leaves any task it produced alone: the task is real
     * work that outlived its origin, and `tasks.source_meeting_id` still records
     * where it came from.
     */
    async deleteActionItem(id: string): Promise<void> {
      await requireItem(id);
      await deps.actionItems.deleteById(id);
    },

    /**
     * Turn one action item into a task, atomically and at most once.
     *
     * Both writes go through a single `execute_batch` transaction: the task insert
     * is itself conditional on the item still being unconverted, and the update
     * that links them carries the same condition. A duplicate or double-clicked
     * conversion therefore writes zero rows — not an orphan task — and the
     * affected-row count below is a verification of that, not the mechanism.
     */
    async convertToTask(
      id: string,
      input: ConvertActionItemInput = { project_id: null },
    ): Promise<Task> {
      const item = await requireItem(id);
      const state = conversionState(item);
      if (state !== 'unconverted') {
        throw new AppError('conflict', REJECTION_MESSAGES[state]);
      }

      const meeting = await deps.meetings.findById(item.meeting_id);
      if (meeting === null) {
        throw new AppError('not_found', '会议不存在或已被删除');
      }

      const parsed = convertActionItemSchema.parse(input);
      // The meeting's own project wins; the caller is only asked when there is none.
      const projectId = meeting.project_id ?? parsed.project_id;
      if (projectId === null) {
        throw new AppError('validation', '该会议未关联项目，请选择任务要归属的项目');
      }

      const project = await deps.projects.findById(projectId);
      if (project === null) {
        throw new AppError('not_found', '所属项目不存在或已被删除');
      }
      if (project.archived_at !== null) {
        throw new AppError('conflict', '项目已归档，无法新建任务；请先恢复该项目');
      }

      const now = nowIso();
      const task: Task = {
        id: newId(),
        project_id: project.id,
        parent_task_id: null,
        title: item.content.slice(0, TASK_TITLE_MAX),
        description: conversionDescription(item),
        status: 'todo',
        priority: 'medium',
        start_date: null,
        due_date: item.due_date,
        progress: 0,
        estimated_hours: null,
        actual_hours: null,
        completed_at: null,
        archived_at: null,
        archived_source: null,
        source_meeting_id: meeting.id,
        source_rule_id: null,
        source_occurrence_date: null,
        is_sample: 0,
        created_at: now,
        updated_at: now,
      };

      const affected = await deps.runBatch([
        deps.tasks.buildInsertForConversion(task, item.id),
        deps.actionItems.buildConvertStatement(item.id, task.id, now),
      ]);
      if (affected !== 2) {
        throw new AppError('conflict', REJECTION_MESSAGES.converted);
      }
      return task;
    },
  };
}

export type ActionItemService = ReturnType<typeof createActionItemService>;

export async function getActionItemService(): Promise<ActionItemService> {
  const repos = await getRepositories();
  return createActionItemService({
    actionItems: repos.actionItems,
    meetings: repos.meetings,
    tasks: repos.tasks,
    projects: repos.projects,
    runBatch: executeBatch,
  });
}
