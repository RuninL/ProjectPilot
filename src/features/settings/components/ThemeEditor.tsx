import { useEffect, useMemo, useState } from 'react';
import { emit } from '@tauri-apps/api/event';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { applyTheme, resolveTheme, type Theme } from '@/lib/theme';
import { toAppError } from '@/lib/errors';
import {
  activeThemeProfile,
  createCustomThemeProfile,
  EMPTY_THEME_PROFILE_BUNDLE,
  exportThemeProfile,
  importThemeProfile,
  loadThemeProfileBundle,
  saveThemeProfileBundle,
  type ThemeProfileBundle,
} from '../services/themeProfile.service';
import {
  applyThemeProfile,
  createSafeThemeProfile,
  rateContrast,
  validateProgressPalette,
  type ThemeColorGroup,
  type ThemeProfile,
} from '../theme/themeProfile';

const GROUPS: {
  id: ThemeColorGroup;
  label: string;
  fields: readonly { key: string; label: string }[];
}[] = [
  {
    id: 'common',
    label: '常用颜色',
    fields: [
      { key: 'appBackground', label: '应用背景' },
      { key: 'mainSurface', label: '主要界面背景' },
      { key: 'cardBackground', label: '卡片背景' },
      { key: 'sidebarBackground', label: '侧边栏背景' },
      { key: 'primaryText', label: '主文字' },
      { key: 'secondaryText', label: '次要文字' },
      { key: 'primaryAccent', label: '主强调色' },
      { key: 'border', label: '边框' },
      { key: 'selectedBackground', label: '选中项背景' },
      { key: 'primaryButton', label: '主要按钮背景' },
      { key: 'primaryButtonText', label: '主要按钮文字' },
    ],
  },
  {
    id: 'text',
    label: '文字颜色',
    fields: [
      { key: 'pageTitle', label: '页面标题' },
      { key: 'sectionTitle', label: '区块标题' },
      { key: 'body', label: '正文' },
      { key: 'secondary', label: '次要说明' },
      { key: 'metadata', label: '日期和元数据' },
      { key: 'link', label: '链接' },
      { key: 'placeholder', label: '占位文字' },
      { key: 'completed', label: '已完成文字' },
      { key: 'archived', label: '已归档文字' },
      { key: 'disabled', label: '禁用文字' },
      { key: 'success', label: '成功文字' },
      { key: 'warning', label: '警告文字' },
      { key: 'error', label: '错误文字' },
    ],
  },
  {
    id: 'surfaces',
    label: '界面颜色',
    fields: [
      { key: 'topBar', label: '顶部栏背景' },
      { key: 'dialog', label: '弹窗背景' },
      { key: 'input', label: '输入框背景' },
      { key: 'hover', label: '悬停背景' },
      { key: 'selected', label: '选中背景' },
      { key: 'border', label: '边框' },
      { key: 'divider', label: '分隔线' },
      { key: 'focus', label: '焦点轮廓' },
      { key: 'overlay', label: '遮罩层' },
      { key: 'scrollbar', label: '滚动条' },
    ],
  },
  {
    id: 'controls',
    label: '按钮颜色',
    fields: [
      { key: 'primaryButton', label: '主按钮' },
      { key: 'primaryButtonText', label: '主按钮文字' },
      { key: 'secondaryButton', label: '次按钮' },
      { key: 'secondaryButtonText', label: '次按钮文字' },
      { key: 'dangerButton', label: '危险按钮' },
      { key: 'dangerButtonText', label: '危险按钮文字' },
    ],
  },
  {
    id: 'statuses',
    label: '状态与任务颜色',
    fields: [
      { key: 'active', label: '活动' },
      { key: 'archived', label: '已归档' },
      { key: 'completed', label: '已完成' },
      { key: 'postponed', label: '延期' },
      { key: 'dueSoon', label: '即将到期' },
      { key: 'priorityHigh', label: '高优先级' },
      { key: 'priorityMedium', label: '中优先级' },
      { key: 'priorityLow', label: '低优先级' },
      { key: 'success', label: '成功' },
      { key: 'warning', label: '警告' },
      { key: 'error', label: '错误' },
      { key: 'info', label: '信息' },
    ],
  },
  {
    id: 'calendar',
    label: '会议与日历',
    fields: [
      { key: 'standaloneMeeting', label: '独立会议' },
      { key: 'recurringMeeting', label: '周期会议' },
      { key: 'today', label: '今日' },
      { key: 'selectedDate', label: '选中日期' },
      { key: 'weekend', label: '周末' },
      { key: 'currentTime', label: '当前时间标记' },
      { key: 'taskBar', label: '任务日期条' },
      { key: 'meetingBar', label: '会议日期条' },
      { key: 'postponed', label: '延期条目' },
      { key: 'completed', label: '已完成条目' },
      { key: 'grid', label: '日历网格线' },
      { key: 'background', label: '日历背景' },
      { key: 'outsideMonth', label: '非当前月份日期' },
    ],
  },
  {
    id: 'desktopWidget',
    label: '桌面组件',
    fields: [
      { key: 'background', label: '组件背景' },
      { key: 'primaryText', label: '组件主文字' },
      { key: 'secondaryText', label: '组件次要文字' },
      { key: 'border', label: '组件边框' },
      { key: 'overlay', label: '壁纸遮罩' },
    ],
  },
];

const CONTRAST_LABEL = { good: '良好', marginal: '勉强', poor: '不建议' } as const;

function contrastChecks(profile: ThemeProfile) {
  return [
    ['正文 / 应用背景', profile.text.body, profile.common.appBackground],
    ['正文 / 卡片背景', profile.text.body, profile.common.cardBackground],
    ['次要文字 / 背景', profile.text.secondary, profile.common.appBackground],
    ['按钮文字 / 按钮', profile.controls.primaryButtonText, profile.controls.primaryButton],
    ['链接 / 背景', profile.text.link, profile.common.appBackground],
    ['错误文字 / 背景', profile.text.error, profile.common.appBackground],
    ['桌面文字 / 组件背景', profile.desktopWidget.primaryText, profile.desktopWidget.background],
  ] as const;
}

interface ThemeEditorProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

export function ThemeEditor({ theme, onThemeChange }: ThemeEditorProps) {
  const [bundle, setBundle] = useState<ThemeProfileBundle>(EMPTY_THEME_PROFILE_BUNDLE);
  const [draft, setDraft] = useState<ThemeProfile | null>(null);
  const [transfer, setTransfer] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnsafe, setConfirmUnsafe] = useState(false);
  const [pendingApply, setPendingApply] = useState(false);

  useEffect(() => {
    let disposed = false;
    void loadThemeProfileBundle()
      .then((loaded) => {
        if (!disposed) setBundle(loaded);
      })
      .catch((caught: unknown) => {
        if (!disposed) setError(toAppError(caught).message);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const checks = useMemo(() => (draft === null ? [] : contrastChecks(draft)), [draft]);
  const hasPoorContrast = checks.some(
    ([, foreground, background]) => rateContrast(foreground, background) === 'poor',
  );
  const paletteWarnings =
    draft === null || !draft.progressPalette.enabled
      ? []
      : validateProgressPalette(draft.progressPalette.colors);

  const updateColor = (group: ThemeColorGroup, key: string, value: string) => {
    setDraft((current) => {
      if (current === null) return null;
      return {
        ...current,
        [group]: { ...current[group], [key]: value },
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const persist = async (apply: boolean) => {
    if (draft === null) return;
    const nextBundle: ThemeProfileBundle = {
      schemaVersion: 1,
      selectedProfileId: apply ? draft.id : bundle.selectedProfileId,
      profiles: [...bundle.profiles.filter((profile) => profile.id !== draft.id), draft],
    };
    await saveThemeProfileBundle(nextBundle);
    setBundle(nextBundle);
    if (apply) {
      onThemeChange(draft.baseTheme);
      applyTheme(draft.baseTheme);
      applyThemeProfile(draft);
      await emit('projectpilot:theme-profile-changed', draft);
    }
    setMessage(apply ? '主题已保存并应用。' : '主题已保存。');
  };

  const requestSave = (apply: boolean) => {
    if (draft === null) return;
    setError(null);
    if (hasPoorContrast) {
      setPendingApply(apply);
      setConfirmUnsafe(true);
      return;
    }
    void persist(apply).catch((caught: unknown) => {
      setError(toAppError(caught).message);
    });
  };

  const resetGroup = (group: ThemeColorGroup) => {
    if (draft === null) return;
    const safe = createSafeThemeProfile(draft.baseTheme);
    setDraft({ ...draft, [group]: safe[group], updatedAt: new Date().toISOString() });
  };

  return (
    <section className="mb-6 rounded-lg border bg-card p-4">
      <h2 className="text-lg font-medium">主题编辑器</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        草稿只影响下方预览；保存并应用后才会改变正式主题。仅支持 #RRGGBB 颜色。
      </p>
      {(message !== null || error !== null) && (
        <p
          className={`mt-2 text-sm ${error === null ? 'text-primary' : 'text-destructive'}`}
          role="status"
        >
          {error ?? message}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setDraft(createCustomThemeProfile(resolveTheme(theme), '我的自定义主题'));
            setMessage(null);
          }}
        >
          新建自定义主题
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const active =
              activeThemeProfile(bundle) ?? createSafeThemeProfile(resolveTheme(theme));
            setDraft({
              ...active,
              id: createCustomThemeProfile(active.baseTheme, active.name).id,
              name: `${active.name} 副本`,
            });
          }}
        >
          复制当前主题
        </Button>
        <select
          aria-label="我的主题"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={draft?.id ?? ''}
          onChange={(event) => {
            setDraft(bundle.profiles.find((profile) => profile.id === event.target.value) ?? null);
          }}
        >
          <option value="">我的主题</option>
          {bundle.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </div>

      {draft !== null && (
        <>
          <label className="mt-4 block text-sm font-medium">
            主题名称
            <input
              className="mt-1 block h-10 w-full max-w-sm rounded-md border bg-background px-3"
              value={draft.name}
              maxLength={50}
              onChange={(event) => {
                setDraft({ ...draft, name: event.target.value });
              }}
            />
          </label>

          <div className="mt-4 space-y-2">
            {GROUPS.map((group, index) => (
              <details
                key={group.id}
                open={index === 0 ? true : undefined}
                className="rounded-md border p-3"
              >
                <summary className="cursor-pointer font-medium">{group.label}</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.fields.map((field) => {
                    const value =
                      draft[group.id][field.key as keyof (typeof draft)[typeof group.id]];
                    return (
                      <label key={field.key} className="text-sm">
                        {field.label}
                        <span className="mt-1 flex items-center gap-2">
                          <input
                            type="color"
                            aria-label={`${field.label}颜色选择器`}
                            value={value}
                            onChange={(event) => {
                              updateColor(group.id, field.key, event.target.value);
                            }}
                          />
                          <input
                            className="h-9 w-28 rounded border bg-background px-2 font-mono text-xs"
                            aria-label={`${field.label}十六进制`}
                            value={value}
                            onChange={(event) => {
                              updateColor(group.id, field.key, event.target.value);
                            }}
                          />
                        </span>
                      </label>
                    );
                  })}
                </div>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    resetGroup(group.id);
                  }}
                >
                  恢复当前分组默认值
                </Button>
              </details>
            ))}
          </div>

          <section className="mt-4 rounded-md border p-3">
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={draft.progressPalette.enabled}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    progressPalette: { ...draft.progressPalette, enabled: event.target.checked },
                  });
                }}
              />
              自定义任务进度调色板
            </label>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="六色顺序预览">
              {draft.progressPalette.colors.map((color, index) => (
                <label key={index} className="text-xs">
                  {index + 1}
                  <input
                    type="color"
                    className="ml-1"
                    value={color}
                    disabled={!draft.progressPalette.enabled}
                    onChange={(event) => {
                      const colors = [...draft.progressPalette.colors];
                      colors[index] = event.target.value;
                      setDraft({ ...draft, progressPalette: { ...draft.progressPalette, colors } });
                    }}
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex h-6 overflow-hidden rounded" aria-label="循环进度分段预览">
              {[...draft.progressPalette.colors, ...draft.progressPalette.colors].map(
                (color, index) => (
                  <span key={index} className="flex-1" style={{ backgroundColor: color }} />
                ),
              )}
            </div>
            {paletteWarnings.map((warning) => (
              <p key={warning} className="mt-2 text-sm text-destructive" role="alert">
                {warning}
              </p>
            ))}
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => {
                setDraft({
                  ...draft,
                  progressPalette: createSafeThemeProfile(draft.baseTheme).progressPalette,
                });
              }}
            >
              一键恢复安全六色
            </Button>
          </section>

          <section
            className="mt-4 rounded-md border p-4"
            style={{
              background: draft.common.appBackground,
              color: draft.text.body,
              borderColor: draft.surfaces.border,
            }}
          >
            <h3 className="text-xl font-semibold" style={{ color: draft.text.pageTitle }}>
              实时预览
            </h3>
            <div className="mt-3 grid gap-3 md:grid-cols-[11rem_1fr]">
              <aside className="rounded p-3" style={{ background: draft.common.sidebarBackground }}>
                <strong>侧边栏</strong>
                <p style={{ color: draft.text.secondary }}>今日 · 七天 · 月历</p>
              </aside>
              <div
                className="rounded border p-3"
                style={{
                  background: draft.common.cardBackground,
                  borderColor: draft.surfaces.border,
                }}
              >
                <h4 style={{ color: draft.text.sectionTitle }}>项目与任务示例</h4>
                <p>
                  正文内容 <span style={{ color: draft.text.secondary }}>次要说明</span>
                </p>
                <input
                  className="mt-2 rounded border px-2 py-1"
                  aria-label="预览输入框"
                  placeholder="输入框"
                  style={{ background: draft.surfaces.input, borderColor: draft.surfaces.border }}
                />
                <div className="mt-2 flex gap-2">
                  <span style={{ color: draft.statuses.success }}>✓ 成功</span>
                  <span style={{ color: draft.statuses.warning }}>⚠ 警告</span>
                  <span style={{ color: draft.statuses.error }}>× 错误</span>
                </div>
                <div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs">
                  {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
                    <span
                      key={day}
                      className="rounded border p-1"
                      style={{ borderColor: draft.calendar.grid }}
                    >
                      {day}
                    </span>
                  ))}
                </div>
                <div
                  className="mt-2 rounded p-2"
                  style={{
                    background: draft.desktopWidget.background,
                    color: draft.desktopWidget.primaryText,
                  }}
                >
                  桌面组件示例
                </div>
              </div>
            </div>
          </section>

          <section className="mt-4 rounded-md border p-3" aria-live="polite">
            <h3 className="font-medium">对比度检查</h3>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              {checks.map(([label, foreground, background]) => {
                const rating = rateContrast(foreground, background);
                return (
                  <li key={label}>
                    {label}：<strong>{CONTRAST_LABEL[rating]}</strong>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                requestSave(false);
              }}
              disabled={paletteWarnings.length > 0 || draft.name.trim() === ''}
            >
              保存
            </Button>
            <Button
              onClick={() => {
                requestSave(true);
              }}
              disabled={paletteWarnings.length > 0 || draft.name.trim() === ''}
            >
              保存并应用
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDraft(null);
              }}
            >
              取消
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDraft(
                  createSafeThemeProfile(draft.baseTheme, { id: draft.id, name: draft.name }),
                );
              }}
            >
              恢复整套默认值
            </Button>
          </div>

          <div className="mt-4 border-t pt-4">
            <label className="text-sm font-medium">
              主题导入 / 导出 JSON
              <textarea
                className="mt-1 block min-h-24 w-full rounded border bg-background p-2 font-mono text-xs"
                value={transfer}
                onChange={(event) => {
                  setTransfer(event.target.value);
                }}
              />
            </label>
            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTransfer(exportThemeProfile(draft));
                }}
              >
                导出到文本
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  try {
                    setDraft(importThemeProfile(transfer, bundle.profiles));
                    setError(null);
                  } catch (caught) {
                    setError(toAppError(caught).message);
                  }
                }}
              >
                从文本导入
              </Button>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmUnsafe}
        destructive
        title="配色可能严重不可读"
        description="部分关键文字与背景的对比度为“不建议”。仍要保存吗？设置页始终可恢复安全主题。"
        confirmLabel="仍然保存"
        onCancel={() => {
          setConfirmUnsafe(false);
        }}
        onConfirm={() => {
          setConfirmUnsafe(false);
          void persist(pendingApply).catch((caught: unknown) => {
            setError(toAppError(caught).message);
          });
        }}
      />
    </section>
  );
}
