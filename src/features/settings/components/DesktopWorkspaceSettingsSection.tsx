import { useEffect, useState } from 'react';
import { emit } from '@tauri-apps/api/event';
import { availableMonitors } from '@tauri-apps/api/window';
import { Button } from '@/components/ui/button';
import {
  setDesktopWorkspaceClickThrough,
  setDesktopWorkspaceLocked,
  setDesktopWorkspaceMode,
  setLaunchAtLogin,
  setMainCloseBehavior,
} from '@/lib/commands';
import { toAppError } from '@/lib/errors';
import {
  DEFAULT_DESKTOP_WORKSPACE_SETTINGS,
  loadDesktopWorkspaceSettings,
  saveDesktopWorkspaceSettings,
  type DesktopWorkspaceSettings,
} from '../services/desktopWorkspaceSettings.service';

interface MonitorOption {
  id: string;
  label: string;
}

export function DesktopWorkspaceSettingsSection() {
  const [settings, setSettings] = useState(DEFAULT_DESKTOP_WORKSPACE_SETTINGS);
  const [monitors, setMonitors] = useState<readonly MonitorOption[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void Promise.all([loadDesktopWorkspaceSettings(), availableMonitors()])
      .then(([loaded, available]) => {
        if (disposed) return;
        setSettings(loaded);
        setMonitors(
          available.map((monitor, index) => {
            const name = monitor.name ?? `显示器 ${String(index + 1)}`;
            return {
              id: `${name}:${String(monitor.position.x)}:${String(monitor.position.y)}`,
              label: name,
            };
          }),
        );
      })
      .catch((caught: unknown) => {
        if (!disposed) setError(toAppError(caught).message);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const persist = async (next: DesktopWorkspaceSettings) => {
    await saveDesktopWorkspaceSettings(next);
    setSettings(next);
    await emit('projectpilot:workspace-settings-changed', next);
    setMessage('桌面工作区设置已保存。');
  };

  const changeMode = async (mode: DesktopWorkspaceSettings['mode']) => {
    setError(null);
    const previous = settings.mode;
    try {
      await setDesktopWorkspaceMode(mode);
      await persist({ ...settings, mode });
    } catch (caught) {
      if (mode === 'workerw' && settings.workerwFallback) {
        try {
          await setDesktopWorkspaceMode('widget');
          await persist({ ...settings, mode: 'widget' });
          setError(`WorkerW 启动失败，已回退桌面固定组件：${toAppError(caught).message}`);
          return;
        } catch {
          // The original sanitized WorkerW error is more useful than a second fallback error.
        }
      }
      setSettings({ ...settings, mode: previous });
      setError(toAppError(caught).message);
    }
  };

  const update = (next: DesktopWorkspaceSettings) => {
    setError(null);
    void persist(next).catch((caught: unknown) => {
      setError(toAppError(caught).message);
    });
  };

  return (
    <section className="mb-6 rounded-lg border bg-card p-4" aria-labelledby="workspace-heading">
      <h2 id="workspace-heading" className="text-lg font-medium">
        桌面工作区
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        两种 Windows 模式共享同一套任务、会议、日历和主题。WorkerW 失败时可自动回退。
      </p>
      {(message !== null || error !== null) && (
        <p
          className={`mt-2 text-sm ${error === null ? 'text-primary' : 'text-destructive'}`}
          role="status"
        >
          {error ?? message}
        </p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label>
          运行模式
          <select
            className="mt-1 block h-10 w-full rounded border bg-background px-3"
            value={settings.mode}
            onChange={(event) => {
              void changeMode(event.target.value as DesktopWorkspaceSettings['mode']);
            }}
          >
            <option value="off">关闭桌面工作区</option>
            <option value="widget">桌面固定组件</option>
            <option value="workerw">WorkerW 壁纸模式（实验）</option>
          </select>
        </label>
        <label>
          默认视图
          <select
            className="mt-1 block h-10 w-full rounded border bg-background px-3"
            value={settings.defaultView}
            onChange={(event) => {
              update({
                ...settings,
                defaultView: event.target.value as DesktopWorkspaceSettings['defaultView'],
              });
            }}
          >
            <option value="today">今日</option>
            <option value="sevenDays">七天</option>
            <option value="calendar">月历</option>
          </select>
        </label>
        <label>
          显示器
          <select
            className="mt-1 block h-10 w-full rounded border bg-background px-3"
            value={settings.monitorId ?? ''}
            onChange={(event) => {
              update({ ...settings, monitorId: event.target.value || null });
            }}
          >
            <option value="">主显示器（断开时安全回退）</option>
            {monitors.map((monitor) => (
              <option key={monitor.id} value={monitor.id}>
                {monitor.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          内容缩放：{Math.round(settings.scale * 100)}%
          <input
            className="mt-2 block w-full"
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={settings.scale}
            onChange={(event) => {
              update({ ...settings, scale: Number(event.target.value) });
            }}
          />
        </label>
        <label>
          背景透明度：{Math.round(settings.opacity * 100)}%
          <input
            className="mt-2 block w-full"
            type="range"
            min="0.3"
            max="1"
            step="0.05"
            value={settings.opacity}
            onChange={(event) => {
              update({ ...settings, opacity: Number(event.target.value) });
            }}
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.blur}
            onChange={(event) => {
              update({ ...settings, blur: event.target.checked });
            }}
          />
          支持时使用背景模糊
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.locked}
            onChange={(event) => {
              const locked = event.target.checked;
              void setDesktopWorkspaceLocked(locked)
                .then(() => persist({ ...settings, locked }))
                .catch((caught: unknown) => {
                  setError(toAppError(caught).message);
                });
            }}
          />
          锁定位置和尺寸
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.clickThrough}
            onChange={(event) => {
              const clickThrough = event.target.checked;
              void setDesktopWorkspaceClickThrough(clickThrough)
                .then(() => persist({ ...settings, clickThrough }))
                .catch((caught: unknown) => {
                  setError(toAppError(caught).message);
                });
            }}
          />
          点击穿透（可从托盘恢复交互）
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.showCompleted}
            onChange={(event) => {
              update({ ...settings, showCompleted: event.target.checked });
            }}
          />
          显示已完成任务
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.showMeetings}
            onChange={(event) => {
              update({ ...settings, showMeetings: event.target.checked });
            }}
          />
          显示会议
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.showRecurringMeetings}
            onChange={(event) => {
              update({ ...settings, showRecurringMeetings: event.target.checked });
            }}
          />
          显示周期会议
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.showAtLaunch}
            onChange={(event) => {
              update({ ...settings, showAtLaunch: event.target.checked });
            }}
          />
          应用启动时显示
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.launchAtLogin}
            onChange={(event) => {
              const launchAtLogin = event.target.checked;
              void setLaunchAtLogin(launchAtLogin)
                .then(() => persist({ ...settings, launchAtLogin }))
                .catch((caught: unknown) => {
                  setError(toAppError(caught).message);
                });
            }}
          />
          Windows 登录后启动
        </label>
        <label>
          主窗口关闭后
          <select
            className="mt-1 block h-10 w-full rounded border bg-background px-3"
            value={settings.mainCloseBehavior}
            onChange={(event) => {
              const mainCloseBehavior = event.target
                .value as DesktopWorkspaceSettings['mainCloseBehavior'];
              void setMainCloseBehavior(mainCloseBehavior === 'exit')
                .then(() => persist({ ...settings, mainCloseBehavior }))
                .catch((caught: unknown) => {
                  setError(toAppError(caught).message);
                });
            }}
          >
            <option value="hide">隐藏主窗口并保留托盘</option>
            <option value="exit">退出全部</option>
          </select>
        </label>
        <label>
          全屏应用时
          <select
            className="mt-1 block h-10 w-full rounded border bg-background px-3"
            value={settings.fullscreenBehavior}
            onChange={(event) => {
              update({
                ...settings,
                fullscreenBehavior: event.target
                  .value as DesktopWorkspaceSettings['fullscreenBehavior'],
              });
            }}
          >
            <option value="keep">保持</option>
            <option value="reduce">降低更新频率</option>
            <option value="pause">暂停视觉更新</option>
          </select>
        </label>
        <label>
          电池模式
          <select
            className="mt-1 block h-10 w-full rounded border bg-background px-3"
            value={settings.batteryBehavior}
            onChange={(event) => {
              update({
                ...settings,
                batteryBehavior: event.target.value as DesktopWorkspaceSettings['batteryBehavior'],
              });
            }}
          >
            <option value="keep">保持</option>
            <option value="reduce">降低更新频率</option>
            <option value="pause">暂停视觉更新</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.workerwFallback}
            onChange={(event) => {
              update({ ...settings, workerwFallback: event.target.checked });
            }}
          />
          WorkerW 失败时自动回退
        </label>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        安全交互入口：托盘“临时启用交互”或本页关闭点击穿透。WorkerW 输入能力需 Windows 实机确认。
      </p>
      <Button
        className="mt-3"
        variant="outline"
        onClick={() => {
          void setDesktopWorkspaceMode('widget')
            .then(() =>
              persist({
                ...DEFAULT_DESKTOP_WORKSPACE_SETTINGS,
                mode: 'widget',
              }),
            )
            .catch((caught: unknown) => {
              setError(toAppError(caught).message);
            });
        }}
      >
        恢复默认布局与安全交互
      </Button>
    </section>
  );
}
