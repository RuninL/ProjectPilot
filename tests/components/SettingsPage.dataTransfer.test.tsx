import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectPilotExport } from '@/features/settings/data/dataTransfer.schema';
import { SettingsPage } from '@/features/settings/pages/SettingsPage';
import {
  createCompleteExport,
  createTransferHarness,
  seedSnapshot,
} from '../helpers/dataTransferFixture';

const mocks = vi.hoisted(() => ({
  chooseJsonImport: vi.fn<() => Promise<{ path: string; contents: string } | null>>(),
  chooseDatabaseRestoreFile: vi.fn<() => Promise<string | null>>(),
  getDataTransferService: vi.fn(),
  restoreSelectedDatabase: vi.fn<() => Promise<string>>(),
  saveJsonExport: vi.fn<(file: ProjectPilotExport) => Promise<string | null>>(),
}));

vi.mock('@/lib/commands', () => ({
  getDbPath: vi.fn().mockResolvedValue('C:\\ProjectPilot\\projectpilot.db'),
  openDataDir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/sampleData.service', () => ({
  getSampleDataService: vi.fn().mockResolvedValue({
    hasSampleData: vi.fn().mockResolvedValue(true),
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

vi.mock('@/features/settings/services/dataTransfer.service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/settings/services/dataTransfer.service')>();
  return { ...actual, getDataTransferService: mocks.getDataTransferService };
});

vi.mock('@/features/settings/services/dataFile.service', () => ({
  chooseDatabaseBackup: vi.fn(),
  chooseDatabaseRestoreFile: mocks.chooseDatabaseRestoreFile,
  chooseJsonImport: mocks.chooseJsonImport,
  readAppVersion: vi.fn().mockResolvedValue('0.1.0'),
  restoreSelectedDatabase: mocks.restoreSelectedDatabase,
  saveCsv: vi.fn(),
  saveJsonExport: mocks.saveJsonExport,
}));

describe('SettingsPage 数据交换验收', () => {
  let harness: ReturnType<typeof createTransferHarness>;

  beforeEach(() => {
    harness = createTransferHarness();
    seedSnapshot(harness.db);
    mocks.chooseJsonImport.mockReset();
    mocks.chooseDatabaseRestoreFile.mockReset();
    mocks.restoreSelectedDatabase.mockReset();
    mocks.saveJsonExport.mockReset();
    mocks.getDataTransferService.mockReset();
    mocks.getDataTransferService.mockResolvedValue(harness.service);
    mocks.saveJsonExport.mockResolvedValue('C:\\exports\\projectpilot.json');
  });

  afterEach(() => {
    harness.db.close();
  });

  it('示例数据勾选项默认未勾选且导出按选择过滤', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    const checkbox = screen.getByRole('checkbox', { name: '包含示例数据' });

    expect(checkbox).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: '导出全量 JSON' }));
    await waitFor(() => {
      expect(mocks.saveJsonExport).toHaveBeenCalledTimes(1);
    });
    const defaultFile = mocks.saveJsonExport.mock.calls[0]?.[0];
    expect(defaultFile?.data.projects.some((row) => row.is_sample === 1)).toBe(false);

    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: '导出全量 JSON' }));
    await waitFor(() => {
      expect(mocks.saveJsonExport).toHaveBeenCalledTimes(2);
    });
    const completeFile = mocks.saveJsonExport.mock.calls[1]?.[0];
    expect(completeFile?.data.projects.some((row) => row.is_sample === 1)).toBe(true);
  });

  it('导入确认框展示统计，取消后真实数据库零变化且不写入', async () => {
    const user = userEvent.setup();
    const before = await harness.repository.readSnapshot();
    const file = await createCompleteExport(harness.db);
    mocks.chooseJsonImport.mockResolvedValue({
      path: 'C:\\imports\\projectpilot.json',
      contents: JSON.stringify(file),
    });
    render(<SettingsPage />);

    await user.click(screen.getByRole('button', { name: '选择 JSON 导入文件' }));
    expect(await screen.findByText(/内容统计：项目 2、会议 2、任务 4/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('导入模式（必须明确选择）'), 'replace');
    await user.click(screen.getByRole('button', { name: '预览并确认导入' }));

    expect(await screen.findByText('确认替换全部数据')).toBeInTheDocument();
    expect(
      screen.getByText(/替换模式会删除当前全部数据（项目 2、会议 2、任务 4/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(harness.runBatch).not.toHaveBeenCalled();
    expect(await harness.repository.readSnapshot()).toEqual(before);
  });

  it('合并确认框展示预计跳过统计', async () => {
    const user = userEvent.setup();
    const file = await createCompleteExport(harness.db);
    mocks.chooseJsonImport.mockResolvedValue({
      path: 'C:\\imports\\projectpilot.json',
      contents: JSON.stringify(file),
    });
    render(<SettingsPage />);

    await user.click(screen.getByRole('button', { name: '选择 JSON 导入文件' }));
    await user.selectOptions(await screen.findByLabelText('导入模式（必须明确选择）'), 'merge');
    await user.click(screen.getByRole('button', { name: '预览并确认导入' }));

    expect(await screen.findByText('确认合并数据')).toBeInTheDocument();
    expect(screen.getByText(/预计跳过：项目 2、会议 2、任务 4/)).toBeInTheDocument();
  });

  it('还原确认框明确提示不可撤销', async () => {
    const user = userEvent.setup();
    mocks.chooseDatabaseRestoreFile.mockResolvedValue('C:\\backup\\data.db');
    render(<SettingsPage />);

    await user.click(screen.getByRole('button', { name: '还原数据库' }));

    expect(await screen.findByText('确认还原数据库')).toBeInTheDocument();
    expect(screen.getByText('当前数据将被所选备份覆盖，此操作不可撤销。')).toBeInTheDocument();
  });

  it('非法导入以中文错误状态渲染且不写库', async () => {
    const user = userEvent.setup();
    mocks.chooseJsonImport.mockResolvedValue({
      path: 'C:\\imports\\bad.json',
      contents: '不是 JSON',
    });
    render(<SettingsPage />);

    await user.click(screen.getByRole('button', { name: '选择 JSON 导入文件' }));

    expect(await screen.findByText('JSON 文件格式无效，未修改任何数据。')).toBeInTheDocument();
    expect(harness.runBatch).not.toHaveBeenCalled();
  });
});
