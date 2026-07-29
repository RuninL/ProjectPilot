import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '@/features/settings/pages/SettingsPage';

const { restoreSelectedDatabase, chooseDatabaseRestoreFile } = vi.hoisted(() => ({
  restoreSelectedDatabase: vi.fn<() => Promise<string>>(),
  chooseDatabaseRestoreFile: vi.fn<() => Promise<string | null>>(),
}));

vi.mock('@/lib/commands', () => ({
  getDbPath: vi.fn().mockResolvedValue('C:\\ProjectPilot\\projectpilot.db'),
  openDataDir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/sampleData.service', () => ({
  getSampleDataService: vi.fn().mockResolvedValue({
    hasSampleData: vi.fn().mockResolvedValue(false),
    clearSampleData: vi.fn().mockResolvedValue(0),
  }),
}));

vi.mock('@/stores/useAppStore', () => ({
  useAppStore: (selector: (state: { theme: 'dark'; setTheme: () => void }) => unknown) =>
    selector({ theme: 'dark', setTheme: vi.fn() }),
}));

vi.mock('@/stores/useProjectStore', () => ({
  useProjectStore: (
    selector: (state: {
      loadProjects: () => Promise<void>;
      loadOptions: () => Promise<void>;
      options: [];
    }) => unknown,
  ) =>
    selector({
      loadProjects: vi.fn().mockResolvedValue(undefined),
      loadOptions: vi.fn().mockResolvedValue(undefined),
      options: [],
    }),
}));

vi.mock('@/features/settings/services/dataTransfer.service', () => ({
  getDataTransferService: vi.fn(),
}));

vi.mock('@/features/settings/services/dataFile.service', () => ({
  chooseDatabaseBackup: vi.fn(),
  chooseDatabaseRestoreFile,
  chooseJsonImport: vi.fn(),
  readAppVersion: vi.fn(),
  restoreSelectedDatabase,
  saveCsv: vi.fn(),
  saveJsonExport: vi.fn(),
}));

describe('SettingsPage 数据管理', () => {
  beforeEach(() => {
    chooseDatabaseRestoreFile.mockReset();
    restoreSelectedDatabase.mockReset();
  });

  it('还原数据库必须经过明确二次确认', async () => {
    const user = userEvent.setup();
    chooseDatabaseRestoreFile.mockResolvedValue('C:\\backup\\data.db');
    restoreSelectedDatabase.mockResolvedValue('C:\\ProjectPilot\\projectpilot.db');
    render(<SettingsPage />);

    await user.click(screen.getByRole('button', { name: '还原数据库' }));
    expect(await screen.findByText('确认还原数据库')).toBeInTheDocument();
    expect(restoreSelectedDatabase).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '覆盖当前数据库' }));
    expect(restoreSelectedDatabase).toHaveBeenCalledWith('C:\\backup\\data.db');
    expect(await screen.findByText(/请立即重启应用/)).toBeInTheDocument();
  });

  it('还原错误可用中文区域渲染且不会崩溃', async () => {
    const user = userEvent.setup();
    chooseDatabaseRestoreFile.mockResolvedValue('C:\\backup\\bad.db');
    restoreSelectedDatabase.mockRejectedValue(new Error('所选文件不是有效的 SQLite 数据库'));
    render(<SettingsPage />);

    await user.click(screen.getByRole('button', { name: '还原数据库' }));
    await user.click(await screen.findByRole('button', { name: '覆盖当前数据库' }));
    expect(await screen.findByText('所选文件不是有效的 SQLite 数据库')).toBeInTheDocument();
  });
});
