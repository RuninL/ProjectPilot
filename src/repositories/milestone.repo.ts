import { milestoneRowSchema } from '@/db/schemas';
import type { SqlExecutor } from '@/lib/db';
import type { Milestone } from '@/types';
import { buildUpdate, parseOptional, parseRows, runUpdate } from './_shared';

const UPDATABLE = [
  'linked_task_id',
  'name',
  'description',
  'date',
  'status',
  'achieved_at',
] as const;

export function createMilestoneRepository(db: SqlExecutor) {
  return {
    async findByProject(projectId: string): Promise<Milestone[]> {
      const rows = await db.select(
        'SELECT * FROM milestones WHERE project_id = ? ORDER BY date ASC, created_at ASC',
        [projectId],
      );
      return parseRows(milestoneRowSchema, rows);
    },

    /** Milestones dated inside `[from, to]`, across every project (calendar window). */
    async findByDateRange(from: string, to: string): Promise<Milestone[]> {
      const rows = await db.select(
        'SELECT * FROM milestones WHERE date BETWEEN ? AND ? ORDER BY date ASC, created_at ASC',
        [from, to],
      );
      return parseRows(milestoneRowSchema, rows);
    },

    /** All non-terminal milestones through a bounded dashboard horizon, including overdue rows. */
    async findPendingThrough(to: string): Promise<Milestone[]> {
      const rows = await db.select(
        `SELECT * FROM milestones
          WHERE date <= ? AND status NOT IN ('achieved', 'cancelled')
          ORDER BY date ASC, created_at ASC`,
        [to],
      );
      return parseRows(milestoneRowSchema, rows);
    },

    async findById(id: string): Promise<Milestone | null> {
      const rows = await db.select('SELECT * FROM milestones WHERE id = ?', [id]);
      return parseOptional(milestoneRowSchema, rows);
    },

    async insert(milestone: Milestone): Promise<void> {
      await db.execute(
        `INSERT INTO milestones
          (id, project_id, linked_task_id, name, description, date, status,
           achieved_at, is_sample, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          milestone.id,
          milestone.project_id,
          milestone.linked_task_id,
          milestone.name,
          milestone.description,
          milestone.date,
          milestone.status,
          milestone.achieved_at,
          milestone.is_sample,
          milestone.created_at,
          milestone.updated_at,
        ],
      );
    },

    async update(id: string, patch: Partial<Milestone>, now: string): Promise<number> {
      return runUpdate(db, buildUpdate('milestones', UPDATABLE, patch, id, now));
    },

    async deleteById(id: string): Promise<number> {
      const result = await db.execute('DELETE FROM milestones WHERE id = ?', [id]);
      return result.rowsAffected;
    },
  };
}

export type MilestoneRepository = ReturnType<typeof createMilestoneRepository>;
