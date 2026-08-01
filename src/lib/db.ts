import Database from '@tauri-apps/plugin-sql';
import { AppError } from './errors';
import { recordPerformanceEvent } from './performanceDiagnostics';

/** Result of a write statement (mirrors tauri-plugin-sql's QueryResult). */
export interface QueryResult {
  rowsAffected: number;
  lastInsertId?: number;
}

/**
 * Minimal database surface the repository layer depends on. Both the
 * tauri-plugin-sql `Database` and the test adapter satisfy this, so
 * repositories can be exercised against an in-memory SQLite in tests.
 */
export interface SqlExecutor {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  execute(query: string, bindValues?: unknown[]): Promise<QueryResult>;
}

const DB_URL = 'sqlite:projectpilot.db';

let instance: SqlExecutor | null = null;

function queryLabel(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function instrumentSqlExecutor(db: SqlExecutor): SqlExecutor {
  return {
    async select<T>(query: string, bindValues?: unknown[]): Promise<T> {
      const started = performance.now();
      try {
        return await db.select<T>(query, bindValues);
      } finally {
        recordPerformanceEvent(
          'sqlite',
          `select:${queryLabel(query)}`,
          performance.now() - started,
        );
      }
    },
    async execute(query: string, bindValues?: unknown[]): Promise<QueryResult> {
      const started = performance.now();
      try {
        return await db.execute(query, bindValues);
      } finally {
        recordPerformanceEvent(
          'sqlite',
          `execute:${queryLabel(query)}`,
          performance.now() - started,
        );
      }
    },
  };
}

interface ForeignKeysRow {
  foreign_keys: number;
}

/**
 * Enforce and assert `PRAGMA foreign_keys = ON`. SQLite defaults this OFF, and
 * cascade rules are load-bearing for our delete semantics, so a failed
 * assertion must block the app from starting (see acceptance-checklist §1).
 *
 * Note: tauri-plugin-sql uses an sqlx connection pool, so this guards the
 * connection the assertion runs on; every multi-statement write goes through
 * the Rust `execute_batch` command, which sets the pragma on its own connection.
 */
async function assertForeignKeys(db: SqlExecutor): Promise<void> {
  await db.execute('PRAGMA foreign_keys = ON');
  const rows = await db.select<ForeignKeysRow[]>('PRAGMA foreign_keys');
  const enabled = rows[0]?.foreign_keys;
  if (enabled !== 1) {
    throw new AppError(
      'db',
      `数据库外键约束未启用（PRAGMA foreign_keys = ${String(enabled)}），已阻止启动以避免数据损坏。`,
      { retryable: false },
    );
  }
}

/** Lazily load the SQLite singleton, asserting foreign-key enforcement once. */
export async function getDb(): Promise<SqlExecutor> {
  if (instance !== null) {
    return instance;
  }
  const db = await Database.load(DB_URL);
  await assertForeignKeys(db);
  instance = import.meta.env.DEV ? instrumentSqlExecutor(db) : db;
  return db;
}

export function takeDatabaseRecoveryNotice(): string | null {
  return null;
}

/** Override the singleton (tests only). */
export function setDbForTesting(executor: SqlExecutor | null): void {
  instance = executor;
}
