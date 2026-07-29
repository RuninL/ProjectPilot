import { getVersion } from '@tauri-apps/api/app';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { backupDatabase, restoreDatabase } from '@/lib/commands';
import { AppError, toAppError } from '@/lib/errors';
import type { ProjectPilotExport } from '../data/dataTransfer.schema';

function dateStamp(includeTime: boolean): string {
  const iso = new Date().toISOString();
  return includeTime ? iso.replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z') : iso.slice(0, 10);
}

export async function saveJsonExport(file: ProjectPilotExport): Promise<string | null> {
  const path = await save({
    title: '导出 ProjectPilot JSON',
    defaultPath: `projectpilot-export-${dateStamp(false)}.json`,
    filters: [{ name: 'JSON 文件', extensions: ['json'] }],
  });
  if (path === null) {
    return null;
  }
  await writeTextFile(path, `${JSON.stringify(file, null, 2)}\n`);
  return path;
}

export async function chooseJsonImport(): Promise<{ path: string; contents: string } | null> {
  const selected = await open({
    title: '选择 ProjectPilot JSON 文件',
    multiple: false,
    directory: false,
    filters: [{ name: 'JSON 文件', extensions: ['json'] }],
  });
  if (selected === null) {
    return null;
  }
  if (typeof selected !== 'string') {
    throw new AppError('validation', '一次只能导入一个 JSON 文件。', { retryable: false });
  }
  return { path: selected, contents: await readTextFile(selected) };
}

export async function saveCsv(contents: string, entityName: string): Promise<string | null> {
  const path = await save({
    title: `导出${entityName} CSV`,
    defaultPath: `projectpilot-${entityName}-${dateStamp(false)}.csv`,
    filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
  });
  if (path === null) {
    return null;
  }
  await writeTextFile(path, contents);
  return path;
}

export async function chooseDatabaseBackup(): Promise<string | null> {
  const path = await save({
    title: '备份 ProjectPilot 数据库',
    defaultPath: `projectpilot-backup-${dateStamp(true)}.db`,
    filters: [{ name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3'] }],
  });
  return path === null ? null : backupDatabase(path);
}

export async function chooseDatabaseRestoreFile(): Promise<string | null> {
  const selected = await open({
    title: '选择数据库备份',
    multiple: false,
    directory: false,
    filters: [{ name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3'] }],
  });
  if (selected === null) {
    return null;
  }
  if (typeof selected !== 'string') {
    throw new AppError('validation', '一次只能还原一个数据库文件。', { retryable: false });
  }
  return selected;
}

export async function restoreSelectedDatabase(path: string): Promise<string> {
  return restoreDatabase(path);
}

export async function readAppVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch (error) {
    throw toAppError(error);
  }
}
