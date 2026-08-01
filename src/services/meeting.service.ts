import { openUrl } from '@tauri-apps/plugin-opener';
import { executeBatch, type BatchStatement } from '@/lib/commands';
import { nowIso } from '@/lib/date';
import { AppError, toAppError } from '@/lib/errors';
import { newId } from '@/lib/uuid';
import { resolveWebAddressForOpen } from '@/lib/webAddress';
import type {
  ActionItemRepository,
  AppSettingRepository,
  MeetingRepository,
  ProjectRepository,
  TaskMeetingRepository,
  TaskRepository,
} from '@/repositories';
import { getRepositories } from '@/repositories';
import type { Meeting } from '@/types';
import { meetingInputSchema, type MeetingInput } from './schemas';

export interface MeetingServiceDeps {
  meetings: MeetingRepository;
  actionItems: ActionItemRepository;
  projects: ProjectRepository;
  tasks: TaskRepository;
  taskMeetings: TaskMeetingRepository;
  appSettings?: AppSettingRepository;
  openUrl: (url: string) => Promise<void>;
  runBatch: (statements: BatchStatement[]) => Promise<number>;
}

/**
 * Attendees are stored as a JSON array in one TEXT column. Reads must tolerate
 * anything: the column is user data that predates this parser, so a malformed
 * value degrades to an empty list rather than breaking the whole meeting page.
 */
export function parseAttendees(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((name): name is string => typeof name === 'string' && name !== '');
  } catch {
    return [];
  }
}

export function createMeetingService(deps: MeetingServiceDeps) {
  async function requireMeeting(id: string): Promise<Meeting> {
    const meeting = await deps.meetings.findById(id);
    if (meeting === null) {
      throw new AppError('not_found', '会议不存在或已被删除');
    }
    return meeting;
  }

  /**
   * A meeting may legitimately have no project (a 1:1, a cross-project review),
   * so only a *named* project is checked. Archived projects are deliberately
   * still allowed here — recording a retrospective about closed work is valid;
   * what the archive forbids is creating new tasks, which is enforced where
   * tasks are actually created.
   */
  async function resolveProjectId(projectId: string | null): Promise<string | null> {
    if (projectId === null) {
      return null;
    }

    const project = await deps.projects.findById(projectId);
    if (project === null) {
      throw new AppError('validation', '所属项目不存在或已被删除');
    }
    return project.id;
  }

  async function openValidatedUrl(url: string | null): Promise<void> {
    const resolved = resolveWebAddressForOpen(url ?? '');
    if (!resolved.ok) {
      throw new AppError(
        'validation',
        resolved.reason === 'unsupported' ? '暂不支持该链接类型' : '会议没有可安全打开的链接',
      );
    }
    try {
      await deps.openUrl(resolved.value);
    } catch (caught) {
      const error = toAppError(caught);
      throw new AppError(error.kind, `无法打开会议链接：${error.message}`, { cause: caught });
    }
  }

  return {
    async listMeetings(): Promise<Meeting[]> {
      return deps.meetings.findAll();
    },

    async listByProject(projectId: string): Promise<Meeting[]> {
      return deps.meetings.findByProject(projectId);
    },

    async getListPreferences(): Promise<{
      range: 'future' | 'today' | 'past' | 'all';
      timeSort: 'time_asc' | 'time_desc';
    }> {
      const [range, timeSort] = await Promise.all([
        deps.appSettings?.get('meetings:list_range'),
        deps.appSettings?.get('meetings:time_sort'),
      ]);
      return {
        range:
          range?.value === 'today' || range?.value === 'past' || range?.value === 'all'
            ? range.value
            : 'future',
        timeSort: timeSort?.value === 'time_desc' ? 'time_desc' : 'time_asc',
      };
    },

    async setListRange(range: 'future' | 'today' | 'past' | 'all'): Promise<void> {
      await deps.appSettings?.set('meetings:list_range', range, nowIso());
    },

    async setListTimeSort(timeSort: 'time_asc' | 'time_desc'): Promise<void> {
      await deps.appSettings?.set('meetings:time_sort', timeSort, nowIso());
    },

    async getMeeting(id: string): Promise<Meeting> {
      return requireMeeting(id);
    },

    async openMeetingUrl(id: string): Promise<void> {
      const meeting = await requireMeeting(id);
      await openValidatedUrl(meeting.meeting_url ?? null);
    },

    async openMeetingUrlValue(url: string): Promise<void> {
      await openValidatedUrl(url);
    },

    async createMeeting(input: MeetingInput, taskIds: readonly string[] = []): Promise<Meeting> {
      const parsed = meetingInputSchema.parse(input);
      const projectId = await resolveProjectId(parsed.project_id);
      const uniqueTaskIds = [...new Set(taskIds)];
      if (uniqueTaskIds.length !== taskIds.length) {
        throw new AppError('validation', '关联任务不能重复');
      }
      const linkedTasks = await deps.tasks.findByIds(uniqueTaskIds);
      if (linkedTasks.length !== uniqueTaskIds.length) {
        throw new AppError('validation', '关联任务不存在或已被删除');
      }

      const now = nowIso();
      const meeting: Meeting = {
        id: newId(),
        project_id: projectId,
        topic: parsed.topic,
        date: parsed.date,
        start_time: parsed.start_time,
        attendees: JSON.stringify(parsed.attendees),
        agenda: parsed.agenda,
        notes: parsed.notes,
        decisions: parsed.decisions,
        risks: parsed.risks,
        meeting_url: parsed.meeting_url,
        source_rule_id: null,
        source_occurrence_date: null,
        is_sample: 0,
        created_at: now,
        updated_at: now,
      };
      await deps.runBatch([
        deps.meetings.buildInsert(meeting),
        ...uniqueTaskIds.map((taskId) =>
          deps.taskMeetings.buildInsert({
            task_id: taskId,
            meeting_id: meeting.id,
            linked_at: now,
          }),
        ),
      ]);
      return meeting;
    },

    async updateMeeting(id: string, input: MeetingInput): Promise<Meeting> {
      await requireMeeting(id);
      const parsed = meetingInputSchema.parse(input);
      const projectId = await resolveProjectId(parsed.project_id);

      await deps.meetings.update(
        id,
        {
          project_id: projectId,
          topic: parsed.topic,
          date: parsed.date,
          start_time: parsed.start_time,
          attendees: JSON.stringify(parsed.attendees),
          agenda: parsed.agenda,
          notes: parsed.notes,
          decisions: parsed.decisions,
          risks: parsed.risks,
          meeting_url: parsed.meeting_url,
        },
        nowIso(),
      );
      return requireMeeting(id);
    },

    /** Real number of action items a delete would take with it, for the confirm dialog. */
    async countActionItems(id: string): Promise<number> {
      return deps.actionItems.countByMeeting(id);
    },

    /**
     * Delete a meeting and, by the schema's ON DELETE CASCADE, its action items.
     * Tasks already converted out of those items survive: `tasks.source_meeting_id`
     * is ON DELETE SET NULL, so real work is never destroyed as a side effect.
     */
    async deleteMeeting(id: string): Promise<void> {
      await requireMeeting(id);
      await deps.meetings.deleteById(id);
    },
  };
}

export type MeetingService = ReturnType<typeof createMeetingService>;

export async function getMeetingService(): Promise<MeetingService> {
  const repos = await getRepositories();
  return createMeetingService({
    meetings: repos.meetings,
    actionItems: repos.actionItems,
    projects: repos.projects,
    tasks: repos.tasks,
    taskMeetings: repos.taskMeetings,
    appSettings: repos.appSettings,
    openUrl,
    runBatch: executeBatch,
  });
}
