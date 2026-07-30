import {
  personProjectParticipationRowSchema,
  personRowSchema,
  personTaskParticipationRowSchema,
  projectParticipantRowSchema,
  taskParticipantRowSchema,
} from '@/db/schemas';
import type { SqlExecutor } from '@/lib/db';
import type {
  Person,
  PersonProjectParticipation,
  PersonTaskParticipation,
  ProjectParticipant,
  TaskParticipant,
} from '@/types';
import { buildUpdate, parseOptional, parseRows, runUpdate } from './_shared';

const PERSON_UPDATABLE = ['name'] as const;

export function createPeopleRepository(db: SqlExecutor) {
  return {
    async findAll(): Promise<Person[]> {
      const rows = await db.select('SELECT * FROM people ORDER BY name ASC, created_at ASC');
      return parseRows(personRowSchema, rows);
    },

    async findById(id: string): Promise<Person | null> {
      const rows = await db.select('SELECT * FROM people WHERE id = ?', [id]);
      return parseOptional(personRowSchema, rows);
    },

    async insert(person: Person): Promise<void> {
      await db.execute(
        `INSERT INTO people (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
        [person.id, person.name, person.created_at, person.updated_at],
      );
    },

    async update(id: string, patch: Partial<Person>, now: string): Promise<number> {
      return runUpdate(db, buildUpdate('people', PERSON_UPDATABLE, patch, id, now));
    },

    async deleteById(id: string): Promise<number> {
      const result = await db.execute('DELETE FROM people WHERE id = ?', [id]);
      return result.rowsAffected;
    },

    async findProjectParticipant(
      projectId: string,
      personId: string,
    ): Promise<ProjectParticipant | null> {
      const rows = await db.select(
        'SELECT * FROM project_participants WHERE project_id = ? AND person_id = ?',
        [projectId, personId],
      );
      return parseOptional(projectParticipantRowSchema, rows);
    },

    async findProjectParticipantsByPerson(
      personId: string,
    ): Promise<PersonProjectParticipation[]> {
      const rows = await db.select(
        `SELECT pp.*, p.name AS project_name
           FROM project_participants pp
           JOIN projects p ON p.id = pp.project_id
          WHERE pp.person_id = ?
          ORDER BY pp.joined_at ASC, p.name ASC`,
        [personId],
      );
      return parseRows(personProjectParticipationRowSchema, rows);
    },

    async insertProjectParticipant(participant: ProjectParticipant): Promise<void> {
      await db.execute(
        `INSERT INTO project_participants (project_id, person_id, role, joined_at)
         VALUES (?, ?, ?, ?)`,
        [
          participant.project_id,
          participant.person_id,
          participant.role,
          participant.joined_at,
        ],
      );
    },

    async deleteProjectParticipant(projectId: string, personId: string): Promise<number> {
      const result = await db.execute(
        'DELETE FROM project_participants WHERE project_id = ? AND person_id = ?',
        [projectId, personId],
      );
      return result.rowsAffected;
    },

    async findTaskParticipant(
      taskId: string,
      personId: string,
    ): Promise<TaskParticipant | null> {
      const rows = await db.select(
        'SELECT * FROM task_participants WHERE task_id = ? AND person_id = ?',
        [taskId, personId],
      );
      return parseOptional(taskParticipantRowSchema, rows);
    },

    async findTaskParticipantsByPerson(personId: string): Promise<PersonTaskParticipation[]> {
      const rows = await db.select(
        `SELECT tp.*, t.title AS task_title,
                p.id AS project_id, p.name AS project_name
           FROM task_participants tp
           JOIN tasks t ON t.id = tp.task_id
           LEFT JOIN projects p ON p.id = t.project_id
          WHERE tp.person_id = ?
          ORDER BY tp.assigned_at ASC, t.title ASC`,
        [personId],
      );
      return parseRows(personTaskParticipationRowSchema, rows);
    },

    async insertTaskParticipant(participant: TaskParticipant): Promise<void> {
      await db.execute(
        `INSERT INTO task_participants (task_id, person_id, assigned_at)
         VALUES (?, ?, ?)`,
        [participant.task_id, participant.person_id, participant.assigned_at],
      );
    },

    async deleteTaskParticipant(taskId: string, personId: string): Promise<number> {
      const result = await db.execute(
        'DELETE FROM task_participants WHERE task_id = ? AND person_id = ?',
        [taskId, personId],
      );
      return result.rowsAffected;
    },
  };
}

export type PeopleRepository = ReturnType<typeof createPeopleRepository>;
