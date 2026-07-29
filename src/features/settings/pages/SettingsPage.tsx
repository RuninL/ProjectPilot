import { useCallback, useEffect, useMemo, useState } from 'react';
import { ContactEmail } from '@/components/AppFooter';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { APP_AUTHOR, APP_NAME, APP_VERSION } from '@/lib/appMetadata';
import { getDbPath, openDataDir } from '@/lib/commands';
import { toAppError } from '@/lib/errors';
import type { Theme } from '@/lib/theme';
import { getSampleDataService } from '@/services/sampleData.service';
import { useAppStore } from '@/stores/useAppStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { ProjectPilotExport, EntityCounts } from '../data/dataTransfer.schema';
import { createCsv, type CsvEntity } from '../services/csvExport';
import {
  chooseDatabaseBackup,
  chooseDatabaseRestoreFile,
  chooseJsonImport,
  readAppVersion,
  restoreSelectedDatabase,
  saveCsv,
  saveJsonExport,
} from '../services/dataFile.service';
import {
  getDataTransferService,
  type ImportMode,
  type ImportPreview,
  type ImportResult,
} from '../services/dataTransfer.service';
import { saveThemePreference } from '../services/settingsPreference.service';

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
  { value: 'warm', label: '暖橙（淡橙+白）' },
  { value: 'colorful', label: '彩色（多彩深底）' },
  { value: 'system', label: '跟随系统' },
];

const CSV_OPTIONS: { value: CsvEntity; label: string }[] = [
  { value: 'tasks', label: '任务' },
  { value: 'milestones', label: '里程碑' },
  { value: 'risks', label: '风险' },
];

const COUNT_LABELS: Record<keyof EntityCounts, string> = {
  projects: '项目',
  meetings: '会议',
  tasks: '任务',
  taskDependencies: '任务依赖',
  milestones: '里程碑',
  actionItems: '行动项',
  projectLinks: '项目链接',
  risks: '风险',
  appSettings: '设置',
};

interface PendingImport {
  path: string;
  file: ProjectPilotExport;
  current: EntityCounts;
}

function countSummary(counts: EntityCounts): string {
  return Object.entries(counts)
    .map(([key, value]) => `${COUNT_LABELS[key as keyof EntityCounts]} ${String(value)}`)
    .join('、');
}

function resultSummary(result: ImportResult): string {
  return `成功导入：${countSummary(result.inserted)}；因 ID 冲突跳过：${countSummary(result.skipped)}。`;
}

export function SettingsPage() {
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const loadProjects = useProjectStore((state) => state.loadProjects);
  const loadOptions = useProjectStore((state) => state.loadOptions);
  const projectOptions = useProjectStore((state) => state.options);

  const [hasSample, setHasSample] = useState<boolean | null>(null);
  const [sampleConfirmOpen, setSampleConfirmOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importMode, setImportMode] = useState<ImportMode | ''>('');
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [restorePath, setRestorePath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [csvEntity, setCsvEntity] = useState<CsvEntity>('tasks');
  const [csvProjectId, setCsvProjectId] = useState('');
  const [includeSampleInExport, setIncludeSampleInExport] = useState(false);

  const refreshSampleState = useCallback(async () => {
    try {
      const service = await getSampleDataService();
      setHasSample(await service.hasSampleData());
    } catch (caught) {
      setError(toAppError(caught).message);
    }
  }, []);

  useEffect(() => {
    void refreshSampleState();
    void loadOptions();
    void getDbPath()
      .then(setDbPath)
      .catch((caught: unknown) => {
        setError(toAppError(caught).message);
      });
  }, [loadOptions, refreshSampleState]);

  const runOperation = useCallback(async (operation: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const success = await operation();
      if (success !== null) {
        setMessage(success);
      }
    } catch (caught) {
      setError(toAppError(caught).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const clearSample = async () => {
    await runOperation(async () => {
      const service = await getSampleDataService();
      const removed = await service.clearSampleData();
      await refreshSampleState();
      await loadProjects();
      await loadOptions();
      return `已清除 ${String(removed)} 条示例数据，真实数据未受影响。`;
    });
    setSampleConfirmOpen(false);
  };

  const exportJson = () =>
    runOperation(async () => {
      const service = await getDataTransferService();
      const file = await service.exportData(
        await readAppVersion(),
        new Date().toISOString(),
        includeSampleInExport,
      );
      const path = await saveJsonExport(file);
      return path === null ? null : `JSON 已导出到：${path}`;
    });

  const selectImport = () =>
    runOperation(async () => {
      const selected = await chooseJsonImport();
      if (selected === null) {
        return null;
      }
      const service = await getDataTransferService();
      const file = service.parseImport(selected.contents);
      setPendingImport({
        path: selected.path,
        file,
        current: await service.getCurrentStatistics(),
      });
      setImportMode('');
      setImportPreview(null);
      return `文件校验通过：${countSummary(file.statistics)}。请选择导入模式。`;
    });

  const importData = async () => {
    if (pendingImport === null || importMode === '') {
      return;
    }
    await runOperation(async () => {
      const service = await getDataTransferService();
      const result = await service.importData(pendingImport.file, importMode);
      await loadProjects();
      await loadOptions();
      setPendingImport(null);
      setImportMode('');
      setImportPreview(null);
      return `导入完成。${resultSummary(result)}`;
    });
    setImportConfirmOpen(false);
  };

  const exportCsv = () =>
    runOperation(async () => {
      const service = await getDataTransferService();
      const csv = createCsv(csvEntity, await service.readSnapshot(), csvProjectId || null);
      const label = CSV_OPTIONS.find((item) => item.value === csvEntity)?.label ?? '数据';
      const path = await saveCsv(csv, label);
      return path === null ? null : `${label} CSV 已导出到：${path}`;
    });

  const selectRestore = () =>
    runOperation(async () => {
      const selected = await chooseDatabaseRestoreFile();
      if (selected !== null) {
        setRestorePath(selected);
      }
      return null;
    });

  const restoreDatabase = async () => {
    if (restorePath === null) {
      return;
    }
    await runOperation(async () => {
      await restoreSelectedDatabase(restorePath);
      setRestorePath(null);
      return '数据库还原成功，系统已自动生成还原前安全副本。请立即重启应用后再继续操作。';
    });
  };

  const importDescription = useMemo(() => {
    if (pendingImport === null || importMode === '') {
      return '';
    }
    if (importMode === 'replace') {
      const deleted = importPreview?.deleted ?? pendingImport.current;
      return `替换模式会删除当前全部数据（${countSummary(deleted)}），再导入所选文件。此操作不可撤销。`;
    }
    const skipped =
      importPreview === null ? '' : `预计跳过：${countSummary(importPreview.skipped)}。`;
    return `合并模式会保留现有数据；所有实体统一采用“同 ID 跳过”策略，不会更新已有记录。${skipped}`;
  }, [importMode, importPreview, pendingImport]);

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">管理外观、示例数据与本机数据安全。</p>
      </header>

      {(message !== null || error !== null) && (
        <div className="mb-6 rounded-lg border bg-card p-4" role="status">
          {message !== null && <p className="text-sm text-primary">{message}</p>}
          {error !== null && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}

      <section className="mb-6 rounded-lg border bg-card p-4">
        <h2 className="text-lg font-medium">主题</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          默认深色，可切换为浅色、暖橙、彩色或跟随系统。
        </p>
        <Label htmlFor="theme-select" className="sr-only">
          主题
        </Label>
        <select
          id="theme-select"
          className="mt-3 h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={theme}
          onChange={(event) => {
            const nextTheme = event.target.value as Theme;
            setTheme(nextTheme);
            void runOperation(async () => {
              await saveThemePreference(nextTheme);
              return '主题设置已保存。';
            });
          }}
        >
          {THEME_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </section>

      <section id="data-management" className="mb-6 rounded-lg border bg-card p-4">
        <h2 className="text-lg font-medium">数据管理</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          JSON 用于完整迁移；CSV 仅导出，不支持 CSV 导入。导入前建议先备份数据库。
        </p>

        <div className="mt-4 border-t pt-4">
          <h3 className="font-medium">JSON 导入与导出</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void exportJson()}>
              导出全量 JSON
            </Button>
            <Label className="flex items-center gap-2 text-sm font-normal">
              <input
                type="checkbox"
                checked={includeSampleInExport}
                onChange={(event) => {
                  setIncludeSampleInExport(event.target.checked);
                }}
              />
              包含示例数据
            </Label>
            <Button variant="outline" disabled={busy} onClick={() => void selectImport()}>
              选择 JSON 导入文件
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                document.getElementById('database-backup')?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              先备份数据库
            </Button>
          </div>
          {pendingImport !== null && (
            <div className="mt-3 rounded-md border p-3 text-sm">
              <p className="break-all">已选文件：{pendingImport.path}</p>
              <p className="mt-1">内容统计：{countSummary(pendingImport.file.statistics)}</p>
              <Label htmlFor="import-mode" className="mt-3 block">
                导入模式（必须明确选择）
              </Label>
              <select
                id="import-mode"
                className="mt-1 h-10 rounded-md border border-input bg-background px-3"
                value={importMode}
                onChange={(event) => {
                  setImportMode(event.target.value as ImportMode | '');
                  setImportPreview(null);
                }}
              >
                <option value="">请选择</option>
                <option value="merge">合并：同 ID 全部跳过</option>
                <option value="replace">替换：清空当前数据后导入</option>
              </select>
              <div className="mt-3">
                <Button
                  variant={importMode === 'replace' ? 'destructive' : 'default'}
                  disabled={busy || importMode === ''}
                  onClick={() => {
                    if (importMode === '') {
                      return;
                    }
                    void runOperation(async () => {
                      const service = await getDataTransferService();
                      setImportPreview(await service.previewImport(pendingImport.file, importMode));
                      setImportConfirmOpen(true);
                      return null;
                    });
                  }}
                >
                  预览并确认导入
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 border-t pt-4">
          <h3 className="font-medium">CSV 导出</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            可导出全部项目，或将当前项目选择作为筛选范围；文件使用 UTF-8 BOM。
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="csv-entity">数据类型</Label>
              <select
                id="csv-entity"
                className="mt-1 block h-10 rounded-md border border-input bg-background px-3"
                value={csvEntity}
                onChange={(event) => {
                  setCsvEntity(event.target.value as CsvEntity);
                }}
              >
                {CSV_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="csv-project">导出范围</Label>
              <select
                id="csv-project"
                className="mt-1 block h-10 rounded-md border border-input bg-background px-3"
                value={csvProjectId}
                onChange={(event) => {
                  setCsvProjectId(event.target.value);
                }}
              >
                <option value="">全部项目</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    当前筛选：{project.name}
                  </option>
                ))}
              </select>
            </div>
            <Button disabled={busy} onClick={() => void exportCsv()}>
              导出 CSV
            </Button>
          </div>
        </div>

        <div id="database-backup" className="mt-4 border-t pt-4">
          <h3 className="font-medium">SQLite 备份与还原</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            还原会先自动生成带时间戳的当前数据库副本，并校验所选 SQLite 文件。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                void runOperation(async () => {
                  const path = await chooseDatabaseBackup();
                  return path === null ? null : `数据库已备份到：${path}`;
                })
              }
            >
              备份数据库
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void selectRestore()}>
              还原数据库
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void runOperation(async () => {
                  await openDataDir();
                  return '已打开数据目录。';
                })
              }
            >
              打开数据目录
            </Button>
          </div>
          <p className="mt-3 break-all text-xs text-muted-foreground">
            数据库路径：{dbPath ?? '正在读取…'}
          </p>
        </div>
      </section>

      <section className="mb-6 rounded-lg border bg-card p-4">
        <h2 className="text-lg font-medium">示例数据</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          清除只会删除标记为「示例」的数据，且清除后不会再次生成。
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant="destructive"
            disabled={busy || hasSample !== true}
            onClick={() => {
              setSampleConfirmOpen(true);
            }}
          >
            清除示例数据
          </Button>
          <span className="text-sm text-muted-foreground">
            {hasSample === null
              ? '正在检查示例数据…'
              : hasSample
                ? '当前存在示例数据。'
                : '当前没有示例数据。'}
          </span>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-lg font-medium">关于</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt className="text-muted-foreground">应用名称</dt>
          <dd>{APP_NAME}</dd>
          <dt className="text-muted-foreground">版本</dt>
          <dd>v{APP_VERSION}</dd>
          <dt className="text-muted-foreground">作者</dt>
          <dd>{APP_AUTHOR}</dd>
          <dt className="text-muted-foreground">联系邮箱</dt>
          <dd>
            <ContactEmail className="justify-start" />
          </dd>
        </dl>
        <p className="mt-3 text-sm text-muted-foreground">
          完全离线运行，所有数据仅存储在本机 SQLite 数据库，不会上传到任何服务器。
        </p>
      </section>

      <ConfirmDialog
        open={sampleConfirmOpen}
        destructive
        busy={busy}
        title="清除示例数据"
        confirmLabel="清除"
        description="将删除所有标记为「示例」的数据，真实数据不受影响。此操作无法撤销。"
        onCancel={() => {
          setSampleConfirmOpen(false);
        }}
        onConfirm={() => {
          void clearSample();
        }}
      />
      <ConfirmDialog
        open={importConfirmOpen}
        destructive={importMode === 'replace'}
        busy={busy}
        title={importMode === 'replace' ? '确认替换全部数据' : '确认合并数据'}
        confirmLabel={importMode === 'replace' ? '删除并导入' : '合并导入'}
        description={
          <div>
            <p>{importDescription}</p>
            <p className="mt-2 font-medium">建议确认已有可用数据库备份后再继续。</p>
          </div>
        }
        onCancel={() => {
          setImportConfirmOpen(false);
        }}
        onConfirm={() => {
          void importData();
        }}
      />
      <ConfirmDialog
        open={restorePath !== null}
        destructive
        busy={busy}
        title="确认还原数据库"
        confirmLabel="覆盖当前数据库"
        description={
          <div>
            <p>当前数据将被所选备份覆盖，此操作不可撤销。</p>
            <p className="mt-2">系统会先自动生成当前数据库的安全副本。</p>
            <p className="mt-2 break-all">文件：{restorePath}</p>
          </div>
        }
        onCancel={() => {
          setRestorePath(null);
        }}
        onConfirm={() => {
          void restoreDatabase();
        }}
      />
    </div>
  );
}
