import { addDays, todayHK } from '@/lib/date';
import { getRepositories } from '@/repositories';
import type { Meeting, Milestone, Project, TaskWithProject } from '@/types';
import {
  dailySummaryCandidate,
  dedupeCandidates,
  dueDateCandidate,
  groupByMinute,
  isQuietHour,
  meetingCandidate,
  overdueSummaryCandidate,
  reminderIdentity,
  type ReminderCandidate,
} from './reminder.service';
import { sendNativeNotification } from '@/features/settings/services/notification.service';
import {
  loadDeliveredReminderIds,
  loadReminderSettings,
  saveDeliveredReminderIds,
  type ReminderSettings,
} from '@/features/settings/services/reminderSettings.service';

export interface ReminderScanData {
  tasks: readonly TaskWithProject[];
  meetings: readonly Meeting[];
  projects: readonly Project[];
  milestones: readonly Milestone[];
}

function selectedLead(value: string): number | null {
  return value === 'none' ? null : Number(value);
}

/** Pure candidate construction keeps database reads out of the scheduling policy. */
export function buildReminderCandidates(
  data: ReminderScanData,
  settings: ReminderSettings,
  date = todayHK(),
): ReminderCandidate[] {
  const candidates: ReminderCandidate[] = [];
  const meetingLead = selectedLead(settings.meetingMinutesBefore);
  if (meetingLead !== null) {
    for (const meeting of data.meetings) {
      const candidate = meetingCandidate(
        meeting.source_rule_id ?? meeting.id,
        meeting.topic,
        meeting.source_occurrence_date ?? meeting.date,
        meeting.start_time,
        meetingLead,
      );
      if (candidate !== null) {
        candidates.push(
          meeting.source_rule_id === null || meeting.source_occurrence_date === null
            ? candidate
            : { ...candidate, occurrenceDate: meeting.source_occurrence_date },
        );
      }
    }
  }
  const taskLead = selectedLead(settings.taskLeadDays);
  for (const task of data.tasks) {
    if (
      taskLead !== null &&
      task.due_date !== null &&
      !['done', 'cancelled', 'postponed'].includes(task.status)
    ) {
      const candidate = dueDateCandidate('task', task.id, task.title, task.due_date, taskLead);
      if (candidate !== null) candidates.push(candidate);
    }
  }
  const projectLead = selectedLead(settings.projectMilestoneLeadDays);
  if (projectLead !== null) {
    for (const project of data.projects) {
      if (project.status === 'archived' || project.status === 'completed' || project.target_end_date === null)
        continue;
      const candidate = dueDateCandidate(
        'project',
        project.id,
        project.name,
        project.target_end_date,
        projectLead,
      );
      if (candidate !== null) candidates.push(candidate);
    }
    for (const milestone of data.milestones) {
      if (milestone.status === 'achieved' || milestone.status === 'cancelled') continue;
      const candidate = dueDateCandidate(
        'milestone',
        milestone.id,
        milestone.name,
        milestone.date,
        projectLead,
      );
      if (candidate !== null) candidates.push(candidate);
    }
  }
  const overdue = data.tasks.filter(
    (task) => task.due_date !== null && task.due_date < date && !['done', 'cancelled', 'postponed'].includes(task.status),
  );
  const overdueCandidate = overdueSummaryCandidate(overdue.length, date);
  if (overdueCandidate !== null) candidates.push(overdueCandidate);
  if (settings.dailySummaryTime !== '') {
    candidates.push({ ...dailySummaryCandidate(date), scheduledAt: `${date}T${settings.dailySummaryTime}:00+08:00` });
  }
  // Date-only meetings belong in the daily summary, never in a timed reminder.
  const dateOnlyMeetingCount = data.meetings.filter((meeting) => meeting.start_time === null).length;
  if (dateOnlyMeetingCount > 0) {
    candidates.push({
      entityType: 'summary',
      entityId: date,
      kind: 'date-only-meetings',
      scheduledAt: `${date}T${settings.dailySummaryTime}:00+08:00`,
      title: `${String(dateOnlyMeetingCount)} date-only meeting${dateOnlyMeetingCount === 1 ? '' : 's'} today`,
    });
  }
  return candidates;
}

function nowInHongKong(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
  const { year = '1970', month = '01', day = '01', hour = '00', minute = '00' } = parts;
  return `${year}-${month}-${day}T${hour}:${minute}:00+08:00`;
}

export async function scanAndNotifyReminders(now = new Date().toISOString()): Promise<void> {
  const settings = await loadReminderSettings();
  if (!settings.enabled || (settings.pausedUntil !== null && settings.pausedUntil > now)) return;
  const date = todayHK();
  const repos = await getRepositories();
  const horizon = addDays(date, 7);
  const [tasks, meetings, projects, milestones] = await Promise.all([
    repos.tasks.findByQuery({ sort: 'due_date' }),
    repos.meetings.findByDateRange(addDays(date, -1), addDays(date, 1)),
    repos.projects.findByQuery({ scope: 'active', sort: 'target_end_date' }),
    repos.milestones.findPendingThrough(horizon),
  ]);
  const delivered = await loadDeliveredReminderIds();
  const localNow = now.endsWith('Z') ? nowInHongKong() : now;
  const currentTime = localNow.slice(11, 16);
  const next = dedupeCandidates(buildReminderCandidates({ tasks, meetings, projects, milestones }, settings, date), delivered)
    .filter((candidate) => candidate.scheduledAt.slice(0, 10) === date && candidate.scheduledAt.slice(11, 16) <= currentTime)
    .filter(() => !isQuietHour(currentTime, settings.quietStart, settings.quietEnd));
  if (next.length === 0) return;
  for (const group of groupByMinute(next)) {
    const titles = group.slice(0, 3).map((candidate) => candidate.title);
    const suffix = group.length > titles.length ? ` and ${String(group.length - titles.length)} more` : '';
    await sendNativeNotification('ProjectPilot reminder', `${titles.join('; ')}${suffix}`);
  }
  await saveDeliveredReminderIds([...delivered, ...next.map(reminderIdentity)]);
}
