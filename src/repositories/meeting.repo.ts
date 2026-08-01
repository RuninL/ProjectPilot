import { meetingRowSchema } from '@/db/schemas';
import type { BatchStatement } from '@/lib/commands';
import type { SqlExecutor } from '@/lib/db';
import type { Meeting } from '@/types';
import { buildUpdate, parseOptional, parseRows, runUpdate } from './_shared';

const UPDATABLE = [
  'project_id',
  'topic',
  'date',
  'start_time',
  'attendees',
  'agenda',
  'notes',
  'decisions',
  'risks',
  'meeting_url',
  'source_rule_id',
  'source_occurrence_date',
] as const;

const INSERT_SQL = `INSERT INTO meetings
  (id, project_id, topic, date, start_time, attendees, agenda, notes, decisions, risks,
   source_rule_id, source_occurrence_date, is_sample, created_at, updated_at, meeting_url)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertParams(meeting: Meeting): unknown[] {
  return [
    meeting.id,
    meeting.project_id,
    meeting.topic,
    meeting.date,
    meeting.start_time,
    meeting.attendees,
    meeting.agenda,
    meeting.notes,
    meeting.decisions,
    meeting.risks,
    meeting.source_rule_id,
    meeting.source_occurrence_date,
    meeting.is_sample,
    meeting.created_at,
    meeting.updated_at,
    meeting.meeting_url ?? null,
  ];
}

export function createMeetingRepository(db: SqlExecutor) {
  return {
    async findAll(): Promise<Meeting[]> {
      const rows = await db.select(
        'SELECT * FROM meetings ORDER BY date DESC, start_time DESC, created_at DESC',
      );
      return parseRows(meetingRowSchema, rows);
    },

    async findByProject(projectId: string): Promise<Meeting[]> {
      const rows = await db.select(
        `SELECT * FROM meetings WHERE project_id = ?
          ORDER BY date DESC, start_time DESC, created_at DESC`,
        [projectId],
      );
      return parseRows(meetingRowSchema, rows);
    },

    /** Meetings whose date falls inside `[from, to]` — the calendar's month window. */
    async findByDateRange(from: string, to: string): Promise<Meeting[]> {
      const rows = await db.select(
        'SELECT * FROM meetings WHERE date BETWEEN ? AND ? ORDER BY date ASC, start_time ASC',
        [from, to],
      );
      return parseRows(meetingRowSchema, rows);
    },

    async findById(id: string): Promise<Meeting | null> {
      const rows = await db.select('SELECT * FROM meetings WHERE id = ?', [id]);
      return parseOptional(meetingRowSchema, rows);
    },

    async insert(meeting: Meeting): Promise<void> {
      await db.execute(INSERT_SQL, insertParams(meeting));
    },

    buildInsert(meeting: Meeting): BatchStatement {
      return { sql: INSERT_SQL, params: insertParams(meeting) };
    },

    async update(id: string, patch: Partial<Meeting>, now: string): Promise<number> {
      return runUpdate(db, buildUpdate('meetings', UPDATABLE, patch, id, now));
    },

    async deleteById(id: string): Promise<number> {
      const result = await db.execute('DELETE FROM meetings WHERE id = ?', [id]);
      return result.rowsAffected;
    },

    buildDelete(id: string): BatchStatement {
      return { sql: 'DELETE FROM meetings WHERE id = ?', params: [id] };
    },
  };
}

export type MeetingRepository = ReturnType<typeof createMeetingRepository>;
