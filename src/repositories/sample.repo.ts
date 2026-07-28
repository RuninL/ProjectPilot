import { projectRowSchema } from '@/db/schemas';
import type { BatchStatement } from '@/lib/commands';
import type { SqlExecutor } from '@/lib/db';
import type { Project } from '@/types';
import { parseRows } from './_shared';

/**
 * Deletion order is child-before-parent so the batch never depends on cascade
 * ordering. `action_items` has no `is_sample` column — sample action items are
 * removed by the ON DELETE CASCADE from their sample meeting.
 */
const CLEAR_SQL = [
  'DELETE FROM tasks WHERE is_sample = 1',
  'DELETE FROM milestones WHERE is_sample = 1',
  'DELETE FROM project_links WHERE is_sample = 1',
  'DELETE FROM meetings WHERE is_sample = 1',
  'DELETE FROM projects WHERE is_sample = 1',
] as const;

/** Cross-table queries and statements scoped to sample (`is_sample = 1`) rows. */
export function createSampleDataRepository(db: SqlExecutor) {
  return {
    async findSampleProjects(): Promise<Project[]> {
      const rows = await db.select(
        'SELECT * FROM projects WHERE is_sample = 1 ORDER BY created_at ASC',
      );
      return parseRows(projectRowSchema, rows);
    },

    /** Statements that delete every sample row and nothing else. */
    buildClear(): BatchStatement[] {
      return CLEAR_SQL.map((sql) => ({ sql }));
    },
  };
}

export type SampleDataRepository = ReturnType<typeof createSampleDataRepository>;
