import {
  actionItemRowSchema,
  appSettingRowSchema,
  meetingRowSchema,
  milestoneRowSchema,
  namedListOrderRowSchema,
  personRowSchema,
  recurrenceExceptionRowSchema,
  recurrenceRuleRowSchema,
  projectLinkRowSchema,
  projectParticipantRowSchema,
  projectRowSchema,
  riskRowSchema,
  taskDependencyRowSchema,
  taskChecklistItemRowSchema,
  taskMeetingRowSchema,
  taskProgressUpdateRowSchema,
  taskParticipantRowSchema,
  taskRowSchema,
} from '@/db/schemas';
import type { BatchStatement } from '@/lib/commands';
import type { SqlExecutor } from '@/lib/db';
import type {
  ActionItem,
  AppSetting,
  Meeting,
  Milestone,
  NamedListOrder,
  Person,
  Project,
  ProjectLink,
  ProjectParticipant,
  RecurrenceException,
  RecurrenceRule,
  Risk,
  Task,
  TaskChecklistItem,
  TaskDependency,
  TaskMeeting,
  TaskParticipant,
  TaskProgressUpdate,
} from '@/types';
import { parseRows } from './_shared';

export interface DatabaseSnapshot {
  projects: Project[];
  meetings: Meeting[];
  tasks: Task[];
  taskDependencies: TaskDependency[];
  recurrenceRules: RecurrenceRule[];
  recurrenceExceptions: RecurrenceException[];
  milestones: Milestone[];
  actionItems: ActionItem[];
  projectLinks: ProjectLink[];
  risks: Risk[];
  appSettings: AppSetting[];
  people: Person[];
  projectParticipants: ProjectParticipant[];
  taskParticipants: TaskParticipant[];
  taskMeetings: TaskMeeting[];
  namedListOrders: NamedListOrder[];
  taskProgressUpdates: TaskProgressUpdate[];
  taskChecklistItems: TaskChecklistItem[];
}

const INSERTS = {
  project: `INSERT INTO projects
    (id, name, description, status, color, start_date, target_end_date, archived_at,
     is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  meeting: `INSERT INTO meetings
    (id, project_id, topic, date, start_time, attendees, agenda, notes, decisions, risks,
     source_rule_id, source_occurrence_date, is_sample, created_at, updated_at, meeting_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  task: `INSERT INTO tasks
    (id, project_id, parent_task_id, title, description, status, priority, start_date, due_date,
     progress, estimated_hours, actual_hours, completed_at, archived_at, archived_source,
     source_meeting_id, source_rule_id, source_occurrence_date, is_sample, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  dependency: `INSERT INTO task_dependencies
    (id, predecessor_id, successor_id, dep_type, lag_days, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  recurrenceRule: `INSERT INTO recurrence_rules
    (id, project_id, kind, title, byweekday, interval, start_date, end_date, time_of_day,
    duration_minutes, default_priority, note, is_active, is_sample, created_at, updated_at, meeting_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  recurrenceException: `INSERT INTO recurrence_exceptions
    (id, rule_id, occurrence_date, action, replacement_date, materialized_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  milestone: `INSERT INTO milestones
    (id, project_id, linked_task_id, name, description, date, status, achieved_at,
     is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  actionItem: `INSERT INTO action_items
    (id, meeting_id, content, owner, due_date, status, converted_task_id, converted_at,
     created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  projectLink: `INSERT INTO project_links
    (id, project_id, label, link_type, target, description, is_sample, created_at, updated_at, task_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  risk: `INSERT INTO risks
    (id, project_id, title, description, category, likelihood, impact, level, status, owner,
     mitigation_plan, due_date, resolved_at, is_sample, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  appSetting: `INSERT INTO app_settings (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  person: `INSERT INTO people
    (id, name, email, role, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  projectParticipant: `INSERT INTO project_participants
    (project_id, person_id, role, joined_at) VALUES (?, ?, ?, ?)`,
  taskParticipant: `INSERT INTO task_participants
    (task_id, person_id, assigned_at) VALUES (?, ?, ?)`,
  taskMeeting: `INSERT INTO task_meetings
    (task_id, meeting_id, linked_at) VALUES (?, ?, ?)`,
  namedListOrder: `INSERT INTO named_list_orders
    (id, context, context_id, name, ordered_ids_json, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  taskProgressUpdate: `INSERT INTO task_progress_updates
    (id, task_id, title, description, occurred_at, contribution_percent, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  taskChecklistItem: `INSERT INTO task_checklist_items
    (id, task_id, content, is_completed, sort_order, completed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
} as const;

export function createDataTransferRepository(db: SqlExecutor) {
  return {
    async readSnapshot(): Promise<DatabaseSnapshot> {
      const [
        projectRows,
        meetingRows,
        taskRows,
        dependencyRows,
        recurrenceRuleRows,
        recurrenceExceptionRows,
        milestoneRows,
        actionItemRows,
        projectLinkRows,
        riskRows,
        appSettingRows,
        peopleRows,
        projectParticipantRows,
        taskParticipantRows,
        taskMeetingRows,
        namedListOrderRows,
        taskProgressRows,
        taskChecklistRows,
      ] = await Promise.all([
        db.select('SELECT * FROM projects'),
        db.select('SELECT * FROM meetings'),
        db.select('SELECT * FROM tasks'),
        db.select('SELECT * FROM task_dependencies'),
        db.select('SELECT * FROM recurrence_rules'),
        db.select('SELECT * FROM recurrence_exceptions'),
        db.select('SELECT * FROM milestones'),
        db.select('SELECT * FROM action_items'),
        db.select('SELECT * FROM project_links'),
        db.select('SELECT * FROM risks'),
        db.select('SELECT * FROM app_settings'),
        db.select('SELECT * FROM people'),
        db.select('SELECT * FROM project_participants'),
        db.select('SELECT * FROM task_participants'),
        db.select('SELECT * FROM task_meetings'),
        db.select('SELECT * FROM named_list_orders'),
        db.select('SELECT * FROM task_progress_updates'),
        db.select('SELECT * FROM task_checklist_items'),
      ]);
      const projects = parseRows(projectRowSchema, projectRows);
      const meetings = parseRows(meetingRowSchema, meetingRows);
      const tasks = parseRows(taskRowSchema, taskRows);
      const taskDependencies = parseRows(taskDependencyRowSchema, dependencyRows);
      const recurrenceRules = parseRows(recurrenceRuleRowSchema, recurrenceRuleRows);
      const recurrenceExceptions = parseRows(recurrenceExceptionRowSchema, recurrenceExceptionRows);
      const milestones = parseRows(milestoneRowSchema, milestoneRows);
      const actionItems = parseRows(actionItemRowSchema, actionItemRows);
      const projectLinks = parseRows(projectLinkRowSchema, projectLinkRows);
      const risks = parseRows(riskRowSchema, riskRows);
      const appSettings = parseRows(appSettingRowSchema, appSettingRows);
      const people = parseRows(personRowSchema, peopleRows);
      const projectParticipants = parseRows(projectParticipantRowSchema, projectParticipantRows);
      const taskParticipants = parseRows(taskParticipantRowSchema, taskParticipantRows);
      const taskMeetings = parseRows(taskMeetingRowSchema, taskMeetingRows);
      const namedListOrders = parseRows(namedListOrderRowSchema, namedListOrderRows);
      const taskProgressUpdates = parseRows(taskProgressUpdateRowSchema, taskProgressRows);
      const taskChecklistItems = parseRows(taskChecklistItemRowSchema, taskChecklistRows);
      return {
        projects,
        meetings,
        tasks,
        taskDependencies,
        recurrenceRules,
        recurrenceExceptions,
        milestones,
        actionItems,
        projectLinks,
        risks,
        appSettings,
        people,
        projectParticipants,
        taskParticipants,
        taskMeetings,
        namedListOrders,
        taskProgressUpdates,
        taskChecklistItems,
      };
    },

    buildClearStatements(): BatchStatement[] {
      return [
        { sql: 'DELETE FROM task_checklist_items' },
        { sql: 'DELETE FROM task_progress_updates' },
        { sql: 'DELETE FROM task_meetings' },
        { sql: 'DELETE FROM task_participants' },
        { sql: 'DELETE FROM project_participants' },
        { sql: 'DELETE FROM task_dependencies' },
        { sql: 'DELETE FROM action_items' },
        { sql: 'DELETE FROM milestones' },
        { sql: 'DELETE FROM project_links' },
        { sql: 'DELETE FROM risks' },
        { sql: 'DELETE FROM tasks' },
        { sql: 'DELETE FROM meetings' },
        { sql: 'DELETE FROM recurrence_exceptions' },
        { sql: 'DELETE FROM recurrence_rules' },
        { sql: 'DELETE FROM projects' },
        { sql: 'DELETE FROM people' },
        { sql: 'DELETE FROM named_list_orders' },
        { sql: 'DELETE FROM app_settings' },
      ];
    },

    buildInsertStatements(snapshot: DatabaseSnapshot): BatchStatement[] {
      const roots = snapshot.tasks.filter((task) => task.parent_task_id === null);
      const children = snapshot.tasks.filter((task) => task.parent_task_id !== null);
      return [
        ...snapshot.projects.map(projectStatement),
        ...snapshot.people.map(personStatement),
        ...snapshot.recurrenceRules.map(recurrenceRuleStatement),
        ...snapshot.meetings.map(meetingStatement),
        ...roots.map(taskStatement),
        ...children.map(taskStatement),
        ...snapshot.taskDependencies.map(dependencyStatement),
        ...snapshot.recurrenceExceptions.map(recurrenceExceptionStatement),
        ...snapshot.milestones.map(milestoneStatement),
        ...snapshot.actionItems.map(actionItemStatement),
        ...snapshot.projectLinks.map(projectLinkStatement),
        ...snapshot.risks.map(riskStatement),
        ...snapshot.projectParticipants.map(projectParticipantStatement),
        ...snapshot.taskParticipants.map(taskParticipantStatement),
        ...snapshot.taskMeetings.map(taskMeetingStatement),
        ...snapshot.taskProgressUpdates.map(taskProgressUpdateStatement),
        ...snapshot.taskChecklistItems.map(taskChecklistItemStatement),
        ...snapshot.namedListOrders.map(namedListOrderStatement),
        ...snapshot.appSettings.map(appSettingStatement),
      ];
    },
  };
}

function projectStatement(row: Project): BatchStatement {
  return {
    sql: INSERTS.project,
    params: [
      row.id,
      row.name,
      row.description,
      row.status,
      row.color,
      row.start_date,
      row.target_end_date,
      row.archived_at,
      row.is_sample,
      row.created_at,
      row.updated_at,
    ],
  };
}

function meetingStatement(row: Meeting): BatchStatement {
  return {
    sql: INSERTS.meeting,
    params: [
      row.id,
      row.project_id,
      row.topic,
      row.date,
      row.start_time,
      row.attendees,
      row.agenda,
      row.notes,
      row.decisions,
      row.risks,
      row.source_rule_id,
      row.source_occurrence_date,
      row.is_sample,
      row.created_at,
      row.updated_at,
      row.meeting_url ?? null,
    ],
  };
}

function taskStatement(row: Task): BatchStatement {
  return {
    sql: INSERTS.task,
    params: [
      row.id,
      row.project_id,
      row.parent_task_id,
      row.title,
      row.description,
      row.status,
      row.priority,
      row.start_date,
      row.due_date,
      row.progress,
      row.estimated_hours,
      row.actual_hours,
      row.completed_at,
      row.archived_at,
      row.archived_source,
      row.source_meeting_id,
      row.source_rule_id,
      row.source_occurrence_date,
      row.is_sample,
      row.created_at,
      row.updated_at,
    ],
  };
}

function dependencyStatement(row: TaskDependency): BatchStatement {
  return {
    sql: INSERTS.dependency,
    params: [
      row.id,
      row.predecessor_id,
      row.successor_id,
      row.dep_type,
      row.lag_days,
      row.created_at,
      row.updated_at,
    ],
  };
}

function recurrenceRuleStatement(row: RecurrenceRule): BatchStatement {
  return {
    sql: INSERTS.recurrenceRule,
    params: [
      row.id,
      row.project_id,
      row.kind,
      row.title,
      row.byweekday,
      row.interval,
      row.start_date,
      row.end_date,
      row.time_of_day,
      row.duration_minutes,
      row.default_priority,
      row.note,
      row.is_active,
      row.is_sample,
      row.created_at,
      row.updated_at,
      row.meeting_url ?? null,
    ],
  };
}

function recurrenceExceptionStatement(row: RecurrenceException): BatchStatement {
  return {
    sql: INSERTS.recurrenceException,
    params: [
      row.id,
      row.rule_id,
      row.occurrence_date,
      row.action,
      row.replacement_date,
      row.materialized_id,
      row.created_at,
      row.updated_at,
    ],
  };
}

function milestoneStatement(row: Milestone): BatchStatement {
  return {
    sql: INSERTS.milestone,
    params: [
      row.id,
      row.project_id,
      row.linked_task_id,
      row.name,
      row.description,
      row.date,
      row.status,
      row.achieved_at,
      row.is_sample,
      row.created_at,
      row.updated_at,
    ],
  };
}

function actionItemStatement(row: ActionItem): BatchStatement {
  return {
    sql: INSERTS.actionItem,
    params: [
      row.id,
      row.meeting_id,
      row.content,
      row.owner,
      row.due_date,
      row.status,
      row.converted_task_id,
      row.converted_at,
      row.created_at,
      row.updated_at,
    ],
  };
}

function projectLinkStatement(row: ProjectLink): BatchStatement {
  return {
    sql: INSERTS.projectLink,
    params: [
      row.id,
      row.project_id,
      row.label,
      row.link_type,
      row.target,
      row.description,
      row.is_sample,
      row.created_at,
      row.updated_at,
      row.task_id ?? null,
    ],
  };
}

function riskStatement(row: Risk): BatchStatement {
  return {
    sql: INSERTS.risk,
    params: [
      row.id,
      row.project_id,
      row.title,
      row.description,
      row.category,
      row.likelihood,
      row.impact,
      row.level,
      row.status,
      row.owner,
      row.mitigation_plan,
      row.due_date,
      row.resolved_at,
      row.is_sample,
      row.created_at,
      row.updated_at,
    ],
  };
}

function appSettingStatement(row: AppSetting): BatchStatement {
  return {
    sql: INSERTS.appSetting,
    params: [row.key, row.value, row.created_at, row.updated_at],
  };
}

function personStatement(row: Person): BatchStatement {
  return {
    sql: INSERTS.person,
    params: [row.id, row.name, row.email, row.role, row.note, row.created_at, row.updated_at],
  };
}

function projectParticipantStatement(row: ProjectParticipant): BatchStatement {
  return {
    sql: INSERTS.projectParticipant,
    params: [row.project_id, row.person_id, row.role, row.joined_at],
  };
}

function taskParticipantStatement(row: TaskParticipant): BatchStatement {
  return {
    sql: INSERTS.taskParticipant,
    params: [row.task_id, row.person_id, row.assigned_at],
  };
}

function taskMeetingStatement(row: TaskMeeting): BatchStatement {
  return {
    sql: INSERTS.taskMeeting,
    params: [row.task_id, row.meeting_id, row.linked_at],
  };
}

function namedListOrderStatement(row: NamedListOrder): BatchStatement {
  return {
    sql: INSERTS.namedListOrder,
    params: [
      row.id,
      row.context,
      row.context_id,
      row.name,
      row.ordered_ids_json,
      row.is_default,
      row.created_at,
      row.updated_at,
    ],
  };
}

function taskProgressUpdateStatement(row: TaskProgressUpdate): BatchStatement {
  return {
    sql: INSERTS.taskProgressUpdate,
    params: [
      row.id,
      row.task_id,
      row.title,
      row.description,
      row.occurred_at,
      row.contribution_percent,
      row.created_at,
      row.updated_at,
    ],
  };
}

function taskChecklistItemStatement(row: TaskChecklistItem): BatchStatement {
  return {
    sql: INSERTS.taskChecklistItem,
    params: [
      row.id,
      row.task_id,
      row.content,
      row.is_completed,
      row.sort_order,
      row.completed_at,
      row.created_at,
      row.updated_at,
    ],
  };
}

export type DataTransferRepository = ReturnType<typeof createDataTransferRepository>;
