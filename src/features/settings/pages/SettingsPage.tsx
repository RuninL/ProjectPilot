import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toAppError } from '@/lib/errors';
import type { Theme } from '@/lib/theme';
import { getSampleDataService } from '@/services/sampleData.service';
import { useAppStore } from '@/stores/useAppStore';
import { useProjectStore } from '@/stores/useProjectStore';

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
  { value: 'system', label: '跟随系统' },
];

/** Capabilities that arrive in a later phase — listed, never clickable, never faked. */
const LATER_PHASE_SETTINGS = [
  { title: '数据备份与恢复', description: '手动备份数据库文件并从备份还原' },
  { title: '导入与导出', description: 'CSV / JSON 数据导入导出' },
  { title: '提醒与通知', description: '任务到期与里程碑提醒' },
  { title: '数据库位置', description: '查看与迁移本机数据库文件' },
];

export function SettingsPage() {
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const loadProjects = useProjectStore((state) => state.loadProjects);
  const loadOptions = useProjectStore((state) => state.loadOptions);

  const [hasSample, setHasSample] = useState<boolean | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [refreshSampleState]);

  const clearSample = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const service = await getSampleDataService();
      const removed = await service.clearSampleData();
      setMessage(`已清除 ${String(removed)} 条示例数据，真实数据未受影响。`);
      await refreshSampleState();
      await loadProjects();
      await loadOptions();
    } catch (caught) {
      setError(toAppError(caught).message);
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          本阶段仅提供主题切换与清除示例数据，其余设置将在后续阶段开放。
        </p>
      </header>

      <section className="mb-6 rounded-lg border bg-card p-4">
        <h2 className="text-lg font-medium">主题</h2>
        <p className="mt-1 text-sm text-muted-foreground">默认深色，可切换为浅色或跟随系统。</p>
        <div className="mt-3 flex items-center gap-2">
          <Label htmlFor="theme-select" className="sr-only">
            主题
          </Label>
          <select
            id="theme-select"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={theme}
            onChange={(event) => {
              setTheme(event.target.value as Theme);
            }}
          >
            {THEME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="mb-6 rounded-lg border bg-card p-4">
        <h2 className="text-lg font-medium">示例数据</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          首次启动会自动创建一个示例项目。清除只会删除标记为「示例」的数据，且清除后不会再次生成。
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant="destructive"
            disabled={busy || hasSample !== true}
            onClick={() => {
              setConfirmOpen(true);
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
        {message !== null && <p className="mt-3 text-sm text-primary">{message}</p>}
        {error !== null && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">后续阶段开放</h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {LATER_PHASE_SETTINGS.map((item) => (
            <li
              key={item.title}
              aria-disabled="true"
              className="cursor-not-allowed rounded-lg border border-dashed bg-muted/30 p-4 opacity-70"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{item.title}</span>
                <Badge variant="outline">后续阶段</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
            </li>
          ))}
        </ul>
      </section>

      <ConfirmDialog
        open={confirmOpen}
        destructive
        busy={busy}
        title="清除示例数据"
        confirmLabel="清除"
        description="将删除所有标记为「示例」的项目与任务，真实数据不受影响。此操作无法撤销。"
        onCancel={() => {
          setConfirmOpen(false);
        }}
        onConfirm={() => {
          void clearSample();
        }}
      />
    </div>
  );
}
