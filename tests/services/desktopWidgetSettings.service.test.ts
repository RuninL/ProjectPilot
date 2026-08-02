import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DESKTOP_WIDGET_SETTINGS,
  loadDesktopWidgetSettings,
  migrateLegacyWidgetView,
  saveDesktopWidgetSettings,
} from '@/features/settings/services/desktopWidgetSettings.service';
import { setDbForTesting } from '@/lib/db';
import { createAppSettingRepository } from '@/repositories/appSetting.repo';
import { createTestDb, NOW, type TestDb } from '../helpers/testDb';

describe('desktopWidgetSettings.service', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
    setDbForTesting(db.executor);
  });

  afterEach(() => {
    setDbForTesting(null);
    db.close();
  });

  it('默认记住今日任务视图', async () => {
    expect(await loadDesktopWidgetSettings()).toEqual(DEFAULT_DESKTOP_WIDGET_SETTINGS);
    expect(DEFAULT_DESKTOP_WIDGET_SETTINGS.lastView).toBe('today');
  });

  it('保存并读回最后视图与几何信息（复用 app_settings，无新增 migration）', async () => {
    const next = {
      ...DEFAULT_DESKTOP_WIDGET_SETTINGS,
      lastView: 'calendar' as const,
      calendarView: 'seven-day' as const,
      monitorId: 'DISPLAY-1:0:0',
      layouts: { 'DISPLAY-1:0:0': { x: 12, y: 34, width: 400, height: 560 } },
    };
    await saveDesktopWidgetSettings(next);
    expect(await loadDesktopWidgetSettings()).toEqual(next);
  });

  it('损坏的存量值回退默认，不抛错', async () => {
    await createAppSettingRepository(db.executor).set('desktop.widget.v1', '{broken', NOW);
    expect(await loadDesktopWidgetSettings()).toEqual(DEFAULT_DESKTOP_WIDGET_SETTINGS);
  });

  it('首次运行时从旧 companionView 迁移视图', async () => {
    await createAppSettingRepository(db.executor).set(
      'desktop.reminders.v1',
      JSON.stringify({ companionView: 'sevenDays' }),
      NOW,
    );
    const loaded = await loadDesktopWidgetSettings();
    expect(loaded.lastView).toBe('calendar');
    expect(loaded.calendarView).toBe('seven-day');
  });
});

describe('migrateLegacyWidgetView', () => {
  it('today → 今日任务', () => {
    expect(migrateLegacyWidgetView('today')).toEqual({ lastView: 'today', calendarView: 'today' });
  });

  it('seven-day / sevenDays → 日历·近七天', () => {
    expect(migrateLegacyWidgetView('seven-day')).toEqual({
      lastView: 'calendar',
      calendarView: 'seven-day',
    });
    expect(migrateLegacyWidgetView('sevenDays')).toEqual({
      lastView: 'calendar',
      calendarView: 'seven-day',
    });
  });

  it('month / calendar → 日历（月视图已删除）', () => {
    expect(migrateLegacyWidgetView('month')).toEqual({
      lastView: 'calendar',
      calendarView: 'today',
    });
    expect(migrateLegacyWidgetView('calendar')).toEqual({
      lastView: 'calendar',
      calendarView: 'today',
    });
  });

  it('未知值安全回退今日任务', () => {
    expect(migrateLegacyWidgetView(undefined)).toEqual({
      lastView: 'today',
      calendarView: 'today',
    });
    expect(migrateLegacyWidgetView('workerw')).toEqual({
      lastView: 'today',
      calendarView: 'today',
    });
  });
});
