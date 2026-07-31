import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { AppError } from './errors';

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

interface MigrationChecksumRepair {
  repaired: boolean;
  backup_path: string | null;
}

interface MigrationFailureRecovery {
  archived_path: string;
  snapshot_path: string | null;
}

let instance: SqlExecutor | null = null;
let startupRecoveryNotice: string | null = null;

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
  // SQLx correctly blocks edited migration files. Earlier development builds
  // changed historical migration metadata, so reconcile only a complete,
  // integrity-checked local history after making a SQLite safety copy;
  // new/incomplete databases are untouched.
  let db: SqlExecutor;
  try {
    await invoke<MigrationChecksumRepair>('reconcile_migration_checksum');
    db = await Database.load(DB_URL);
  } catch {
    const recovery = await invoke<MigrationFailureRecovery>('isolate_failed_migration_database');
    startupRecoveryNotice = [
      '检测到无法安全升级的旧数据库，已保留原始文件并启动新的空数据库。',
      `原始数据库：${recovery.archived_path}`,
      recovery.snapshot_path === null ? '' : `一致性快照：${recovery.snapshot_path}`,
      '旧数据未自动导入；请在确认数据后通过设置中的备份恢复或数据导入功能处理。',
    ]
      .filter((part) => part !== '')
      .join(' ');
    db = await Database.load(DB_URL);
  }
  await assertForeignKeys(db);
  instance = db;
  return db;
}

/** Read the one-time startup warning created by safe migration recovery. */
export function takeDatabaseRecoveryNotice(): string | null {
  const notice = startupRecoveryNotice;
  startupRecoveryNotice = null;
  return notice;
}

/** Override the singleton (tests only). */
export function setDbForTesting(executor: SqlExecutor | null): void {
  instance = executor;
}
