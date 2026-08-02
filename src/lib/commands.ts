import { invoke } from '@tauri-apps/api/core';
import { toAppError } from './errors';
import { recordPerformanceEvent } from './performanceDiagnostics';

/** A parameterized statement for the Rust atomic batch command (positional `?1..?n`). */
export interface BatchStatement {
  sql: string;
  params?: unknown[];
}

async function measuredInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const started = performance.now();
  try {
    return await invoke<T>(command, args);
  } finally {
    recordPerformanceEvent('ipc', command, performance.now() - started);
  }
}

/**
 * Run several statements atomically in a single Rust-side transaction.
 * Any failure rolls the whole batch back. Returns total rows affected.
 */
export async function executeBatch(statements: BatchStatement[]): Promise<number> {
  try {
    return await measuredInvoke<number>('execute_batch', { statements });
  } catch (error) {
    throw toAppError(error);
  }
}

/** Absolute path of the SQLite database file (for the settings page). */
export async function getDbPath(): Promise<string> {
  try {
    return await measuredInvoke<string>('get_db_path');
  } catch (error) {
    throw toAppError(error);
  }
}

/** Open the app data directory in the OS file manager. */
export async function openDataDir(): Promise<void> {
  try {
    await measuredInvoke('open_data_dir');
  } catch (error) {
    throw toAppError(error);
  }
}

/** Copy the live database to `destPath`. */
export async function backupDatabase(destPath: string): Promise<string> {
  try {
    return await measuredInvoke<string>('backup_database', { destPath });
  } catch (error) {
    throw toAppError(error);
  }
}

/** Restore the database from `srcPath` (auto pre-backup performed Rust-side). */
export async function restoreDatabase(srcPath: string): Promise<string> {
  try {
    return await measuredInvoke<string>('restore_database', { srcPath });
  } catch (error) {
    throw toAppError(error);
  }
}

/** Check whether a Windows-local file or directory exists without reading it. */
export async function localPathExists(path: string): Promise<boolean> {
  try {
    return await measuredInvoke<boolean>('local_path_exists', { path });
  } catch (error) {
    throw toAppError(error);
  }
}

/** Open an existing Windows-local path with the system default application. */
export async function openLocalPath(path: string): Promise<void> {
  try {
    await measuredInvoke('open_local_path', { path });
  } catch (error) {
    throw toAppError(error);
  }
}

export interface DesktopWidgetStatus {
  exists: boolean;
  visible: boolean;
  locked: boolean;
  click_through: boolean;
}

/** Create the desktop widget window if missing, otherwise show it. */
export async function openDesktopWidget(): Promise<void> {
  try {
    await measuredInvoke('open_desktop_widget');
  } catch (error) {
    throw toAppError(error);
  }
}

export async function showDesktopWidget(): Promise<void> {
  try {
    await measuredInvoke('show_desktop_widget');
  } catch (error) {
    throw toAppError(error);
  }
}

export async function hideDesktopWidget(): Promise<void> {
  try {
    await measuredInvoke('hide_desktop_widget');
  } catch (error) {
    throw toAppError(error);
  }
}

/** Destroy the widget window for real; the main app keeps running. */
export async function closeDesktopWidget(): Promise<void> {
  try {
    await measuredInvoke('close_desktop_widget');
  } catch (error) {
    throw toAppError(error);
  }
}

/** Live window state — never a persisted "running" flag. */
export async function desktopWidgetStatus(): Promise<DesktopWidgetStatus> {
  try {
    return await measuredInvoke<DesktopWidgetStatus>('desktop_widget_status');
  } catch (error) {
    throw toAppError(error);
  }
}

export async function setDesktopWidgetLocked(locked: boolean): Promise<void> {
  try {
    await measuredInvoke('set_desktop_widget_locked', { locked });
  } catch (error) {
    throw toAppError(error);
  }
}

export async function setDesktopWidgetClickThrough(enabled: boolean): Promise<void> {
  try {
    await measuredInvoke('set_desktop_widget_click_through', { enabled });
  } catch (error) {
    throw toAppError(error);
  }
}

export async function setMainCloseBehavior(exit: boolean): Promise<void> {
  try {
    await measuredInvoke('set_main_close_behavior', { exit });
  } catch (error) {
    throw toAppError(error);
  }
}

export async function setLaunchAtLogin(enabled: boolean): Promise<void> {
  try {
    await measuredInvoke('set_launch_at_login', { enabled });
  } catch (error) {
    throw toAppError(error);
  }
}
