import { invoke } from '@tauri-apps/api/core';
import { toAppError } from './errors';

/** A parameterized statement for the Rust atomic batch command (positional `?1..?n`). */
export interface BatchStatement {
  sql: string;
  params?: unknown[];
}

/**
 * Run several statements atomically in a single Rust-side transaction.
 * Any failure rolls the whole batch back. Returns total rows affected.
 */
export async function executeBatch(statements: BatchStatement[]): Promise<number> {
  try {
    return await invoke<number>('execute_batch', { statements });
  } catch (error) {
    throw toAppError(error);
  }
}

/** Absolute path of the SQLite database file (for the settings page). */
export async function getDbPath(): Promise<string> {
  try {
    return await invoke<string>('get_db_path');
  } catch (error) {
    throw toAppError(error);
  }
}

/** Open the app data directory in the OS file manager. */
export async function openDataDir(): Promise<void> {
  try {
    await invoke('open_data_dir');
  } catch (error) {
    throw toAppError(error);
  }
}

/** Copy the live database to `destPath`. */
export async function backupDatabase(destPath: string): Promise<string> {
  try {
    return await invoke<string>('backup_database', { destPath });
  } catch (error) {
    throw toAppError(error);
  }
}

/** Restore the database from `srcPath` (auto pre-backup performed Rust-side). */
export async function restoreDatabase(srcPath: string): Promise<string> {
  try {
    return await invoke<string>('restore_database', { srcPath });
  } catch (error) {
    throw toAppError(error);
  }
}

/** Check whether a Windows-local file or directory exists without reading it. */
export async function localPathExists(path: string): Promise<boolean> {
  try {
    return await invoke<boolean>('local_path_exists', { path });
  } catch (error) {
    throw toAppError(error);
  }
}

/** Open an existing Windows-local path with the system default application. */
export async function openLocalPath(path: string): Promise<void> {
  try {
    await invoke('open_local_path', { path });
  } catch (error) {
    throw toAppError(error);
  }
}
