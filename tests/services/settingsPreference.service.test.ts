import {
  loadThemePreference,
  saveThemePreference,
} from '@/features/settings/services/settingsPreference.service';
import { setDbForTesting } from '@/lib/db';
import { createAppSettingRepository } from '@/repositories/appSetting.repo';
import { createTestDb, NOW, type TestDb } from '../helpers/testDb';

describe('settingsPreference.service', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
    setDbForTesting(db.executor);
  });

  afterEach(() => {
    setDbForTesting(null);
    db.close();
  });

  it('主题写入 app_settings 并可在重启初始化路径读回', async () => {
    await saveThemePreference('system');
    expect(await loadThemePreference()).toBe('system');
  });

  it('忽略无法识别的旧主题设置', async () => {
    await createAppSettingRepository(db.executor).set('theme', 'unknown', NOW);
    expect(await loadThemePreference()).toBeNull();
  });
});
