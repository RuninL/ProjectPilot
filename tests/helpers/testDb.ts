import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import BetterSqlite3, { type Database as RawDb } from 'better-sqlite3';
import type { QueryResult, SqlExecutor } from '@/lib/db';
import type { BatchStatement } from '@/lib/commands';

// Vitest runs from the project root; resolve the real migration files from there.
// Listed in version order so the harness applies exactly what the app applies.
const MIGRATION_DIR = join(process.cwd(), 'src-tauri/migrations');
const MIGRATION_FILES = [
  '0001_init.sql',
  '0002_task_lifecycle.sql',
  '0003_task_dependencies.sql',
  '0004_meetings_action_items.sql',
  '0005_dashboard_risks.sql',
] as const;

/**
 * Integration-style test harness: repositories are exercised against a real
 * in-memory SQLite (better-sqlite3, a devDependency) running the actual
 * migration SQL. This validates the schema, constraints, triggers and
 * cascade rules — not just mocked call shapes.
 */
export class BetterSqliteExecutor implements SqlExecutor {
  constructor(private readonly db: RawDb) {}

  select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    const rows = this.db.prepare(query).all(...(bindValues as never[]));
    return Promise.resolve(rows as T);
  }

  execute(query: string, bindValues: unknown[] = []): Promise<QueryResult> {
    const info = this.db.prepare(query).run(...(bindValues as never[]));
    return Promise.resolve({
      rowsAffected: info.changes,
      lastInsertId: Number(info.lastInsertRowid),
    });
  }
}

export interface TestDb {
  raw: RawDb;
  executor: SqlExecutor;
  /** Replicates the Rust `execute_batch` contract: one transaction, all-or-nothing. */
  runBatch: (statements: BatchStatement[]) => number;
  close: () => void;
}

export function createTestDb(): TestDb {
  const raw = new BetterSqlite3(':memory:');
  raw.pragma('foreign_keys = ON');
  for (const file of MIGRATION_FILES) {
    raw.exec(readFileSync(join(MIGRATION_DIR, file), 'utf8'));
  }

  const runBatch = (statements: BatchStatement[]): number => {
    let affected = 0;
    const tx = raw.transaction((stmts: BatchStatement[]) => {
      for (const stmt of stmts) {
        const info = raw.prepare(stmt.sql).run(...((stmt.params ?? []) as never[]));
        affected += info.changes;
      }
    });
    tx(statements);
    return affected;
  };

  return {
    raw,
    executor: new BetterSqliteExecutor(raw),
    runBatch,
    close: () => {
      raw.close();
    },
  };
}

/** Minimal audit timestamp for fixtures. */
export const NOW = '2026-07-14T00:00:00Z';
