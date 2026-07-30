import {
  actionItemRowSchema,
  appSettingRowSchema,
  meetingRowSchema,
  milestoneRowSchema,
  personRowSchema,
  projectLinkRowSchema,
  projectParticipantRowSchema,
  projectRowSchema,
  riskRowSchema,
  taskDependencyRowSchema,
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
  Person,
  Project,
  ProjectLink,
  ProjectParticipant,
  Risk,
  Task,
  TaskDependency,
  TaskParticipant,
} from '@/types';
import { parseRows } from './_shared';

export interface DatabaseSnapshot {
  projects: Project[];
  meetings: Meeting[];
  tasks: Task[];
  taskDependencies: TaskDependency[];
  milestones: Milestone[];
  actionItems: ActionItem[];
  projectLinks: ProjectLink[];
  risks: Risk[];
  appSettings: AppSetting[];
  people: Person[];
  projectParticipants: ProjectParticipant[];
  taskParticipants: TaskParticipant[];
}

const INSERTS = {
  project: `INSERT INTO projects
    (id, name, description, status, color, start_date, target_end_date, archived_at,
     is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  meeting: `INSERT INTO meetings
    (id, project_id, topic, date, start_time, attendees, agenda, notes, decisions, risks,
     is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  task: `INSERT INTO tasks
    (id, project_id, parent_task_id, title, description, status, priority, start_date, due_date,
     progress, estimated_hours, actual_hours, completed_at, archived_at, source_meeting_id,
     is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  dependency: `INSERT INTO task_dependencies
    (id, predecessor_id, successor_id, dep_type, lag_days, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  milestone: `INSERT INTO milestones
    (id, project_id, linked_task_id, name, description, date, status, achieved_at,
     is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  actionItem: `INSERT INTO action_items
    (id, meeting_id, content, owner, due_date, status, converted_task_id, converted_at,
     created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  projectLink: `INSERT INTO project_links
    (id, project_id, label, link_type, target, description, is_sample, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
} as const;

export function createDataTransferRepository(db: SqlExecutor) {
  return {
    async readSnapshot(): Promise<DatabaseSnapshot> {
      const projects = parseRows(projectRowSchema, await db.select('SELECT * FROM projects'));
      const meetings = parseRows(meetingRowSchema, await db.select('SELECT * FROM meetings'));
      const tasks = parseRows(taskRowSchema, await db.select('SELECT * FROM tasks'));
      const taskDependencies = parseRows(
        taskDependencyRowSchema,
        await db.select('SELECT * FROM task_dependencies'),
      );
      const milestones = parseRows(milestoneRowSchema, await db.select('SELECT * FROM milestones'));
      const actionItems = parseRows(
        actionItemRowSchema,
        await db.select('SELECT * FROM action_items'),
      );
      const projectLinks = parseRows(
        projectLinkRowSchema,
        await db.select('SELECT * FROM project_links'),
      );
      const risks = parseRows(riskRowSchema, await db.select('SELECT * FROM risks'));
      const appSettings = parseRows(
        appSettingRowSchema,
        await db.select('SELECT * FROM app_settings'),
      );
      const people = parseRows(personRowSchema, await db.select('SELECT * FROM people'));
      const projectParticipants = parseRows(
        projectParticipantRowSchema,
        await db.select('SELECT * FROM project_participants'),
      );
      const taskParticipants = parseRows(
        taskParticipantRowSchema,
        await db.select('SELECT * FROM task_participants'),
      );
      return {
        projects,
        meetings,
        tasks,
        taskDependencies,
        milestones,
        actionItems,
        projectLinks,
        risks,
        appSettings,
        people,
        projectParticipants,
        taskParticipants,
      };
    },

    buildClearStatements(): BatchStatement[] {
      return [
        { sql: 'DELETE FROM task_participants' },
        { sql: 'DELETE FROM project_participants' },
        { sql: 'DELETE FROM task_dependencies' },
        { sql: 'DELETE FROM action_items' },
        { sql: 'DELETE FROM milestones' },
        { sql: 'DELETE FROM project_links' },
        { sql: 'DELETE FROM risks' },
        { sql: 'DELETE FROM tasks' },
        { sql: 'DELETE FROM meetings' },
        { sql: 'DELETE FROM projects' },
        { sql: 'DELETE FROM people' },
        { sql: 'DELETE FROM app_settings' },
      ];
    },

    buildInsertStatements(snapshot: DatabaseSnapshot): BatchStatement[] {
      const roots = snapshot.tasks.filter((task) => task.parent_task_id === null);
      const children = snapshot.tasks.filter((task) => task.parent_task_id !== null);
      return [
        ...snapshot.projects.map(projectStatement),
        ...snapshot.people.map(personStatement),
        ...snapshot.meetings.map(meetingStatement),
        ...roots.map(taskStatement),
        ...children.map(taskStatement),
        ...snapshot.taskDependencies.map(dependencyStatement),
        ...snapshot.milestones.map(milestoneStatement),
        ...snapshot.actionItems.map(actionItemStatement),
        ...snapshot.projectLinks.map(projectLinkStatement),
        ...snapshot.risks.map(riskStatement),
        ...snapshot.projectParticipants.map(projectParticipantStatement),
        ...snapshot.taskParticipants.map(taskParticipantStatement),
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
      row.is_sample,
      row.created_at,
      row.updated_at,
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
      row.source_meeting_id,
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

export type DataTransferRepository = ReturnType<typeof createDataTransferRepository>;
