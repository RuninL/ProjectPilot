import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesPage } from '@/features/links/pages/FilesPage';
import { setDbForTesting } from '@/lib/db';
import { createProjectLinkRepository, createProjectRepository } from '@/repositories';
import { makeProject, makeProjectLink } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

const openerMocks = vi.hoisted(() => ({
  openUrl: vi.fn(),
  localPathExists: vi.fn(),
  openLocalPath: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: openerMocks.openUrl }));
vi.mock('@/lib/commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commands')>();
  return {
    ...actual,
    localPathExists: openerMocks.localPathExists,
    openLocalPath: openerMocks.openLocalPath,
  };
});

let db: TestDb;

beforeEach(async () => {
  db = createTestDb();
  setDbForTesting(db.executor);
  openerMocks.openUrl.mockReset().mockResolvedValue(undefined);
  openerMocks.localPathExists.mockReset().mockResolvedValue(true);
  openerMocks.openLocalPath.mockReset().mockResolvedValue(undefined);
  const projects = createProjectRepository(db.executor);
  const links = createProjectLinkRepository(db.executor);
  await projects.insert(makeProject({ id: 'p1', name: '甲项目' }));
  await projects.insert(makeProject({ id: 'p2', name: '乙项目' }));
  await links.insert(
    makeProjectLink({ id: 'web', project_id: 'p1', label: '需求文档', description: '产品需求' }),
  );
  await links.insert(
    makeProjectLink({
      id: 'mail',
      project_id: 'p1',
      label: '联系邮箱',
      target: 'mailto:owner@example.com',
    }),
  );
  await links.insert(
    makeProjectLink({
      id: 'local',
      project_id: 'p2',
      label: '本地设计稿',
      link_type: 'file_path',
      target: 'C:\\设计\\稿件',
    }),
  );
});

afterEach(() => {
  setDbForTesting(null);
  db.close();
});

describe('FilesPage', () => {
  it('filters globally and retains the existing safe-open rules', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <FilesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('需求文档')).toBeInTheDocument();
    const mailRow = screen.getByText('联系邮箱').closest('li');
    expect(mailRow).not.toBeNull();
    expect(within(mailRow as HTMLElement).queryByRole('button', { name: '打开' })).toBeNull();

    await user.type(screen.getByLabelText('搜索名称或描述'), '产品需求');
    await waitFor(() => {
      expect(screen.queryByText('本地设计稿')).toBeNull();
    });
    expect(screen.getByText('需求文档')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('搜索名称或描述'));
    await user.selectOptions(screen.getByLabelText('所属项目'), 'p2');
    expect(await screen.findByText('本地设计稿')).toBeInTheDocument();
    expect(screen.queryByText('需求文档')).toBeNull();

    await user.selectOptions(screen.getByLabelText('所属项目'), '');
    const webRow = (await screen.findByText('需求文档')).closest('li');
    expect(webRow).not.toBeNull();
    await user.click(within(webRow as HTMLElement).getByRole('button', { name: '打开' }));
    expect(openerMocks.openUrl).toHaveBeenCalledWith('https://example.com/docs');
    expect(openerMocks.openLocalPath).not.toHaveBeenCalled();
  });

  it('creates for a selected project and supports edit and confirmed deletion', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <FilesPage />
      </MemoryRouter>,
    );
    await screen.findByText('需求文档');

    await user.click(screen.getByRole('button', { name: '新增文件或链接' }));
    const createDialog = screen.getByRole('dialog');
    await user.selectOptions(within(createDialog).getByLabelText('所属项目'), 'p2');
    await user.type(within(createDialog).getByLabelText('资料名称'), '会议资料');
    await user.type(within(createDialog).getByLabelText('URL 地址'), 'https://example.com/meeting');
    await user.click(within(createDialog).getByRole('button', { name: '保存' }));
    expect(await screen.findByText('会议资料')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '编辑：会议资料' }));
    await user.clear(screen.getByLabelText('资料名称'));
    await user.type(screen.getByLabelText('资料名称'), '会议纪要');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('会议纪要')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删除：会议纪要' }));
    await user.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(screen.queryByText('会议纪要')).toBeNull();
    });
  });
});
