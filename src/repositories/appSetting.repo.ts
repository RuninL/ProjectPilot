import { appSettingRowSchema } from '@/db/schemas';
import type { SqlExecutor } from '@/lib/db';
import type { AppSetting } from '@/types';
import { parseOptional, parseRows } from './_shared';

export function createAppSettingRepository(db: SqlExecutor) {
  return {
    async findAll(): Promise<AppSetting[]> {
      const rows = await db.select('SELECT * FROM app_settings ORDER BY key ASC');
      return parseRows(appSettingRowSchema, rows);
    },

    async get(key: string): Promise<AppSetting | null> {
      const rows = await db.select('SELECT * FROM app_settings WHERE key = ?', [key]);
      return parseOptional(appSettingRowSchema, rows);
    },

    /** Insert or update a key. `created_at` is preserved on conflict. */
    async set(key: string, value: string, now: string): Promise<void> {
      await db.execute(
        `INSERT INTO app_settings (key, value, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, value, now, now],
      );
    },

    async deleteByKey(key: string): Promise<number> {
      const result = await db.execute('DELETE FROM app_settings WHERE key = ?', [key]);
      return result.rowsAffected;
    },
  };
}

export type AppSettingRepository = ReturnType<typeof createAppSettingRepository>;
