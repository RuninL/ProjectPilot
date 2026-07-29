import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectLinkSection } from '@/features/links/components/ProjectLinkSection';
import { setDbForTesting, type SqlExecutor } from '@/lib/db';
import { createProjectLinkRepository, createProjectRepository } from '@/repositories';
import { makeProject, makeProjectLink } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

const openerMocks = vi.hoisted(() => ({
  openUrl: vi.fn(),
  localPathExists: vi.fn(),
  openLocalPath: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: openerMocks.openUrl,
}));

vi.mock('@/lib/commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commands')>();
  return {
    ...actual,
    localPathExists: openerMocks.localPathExists,
    openLocalPath: openerMocks.openLocalPath,
  };
});

let db: TestDb | null = null;
const project = makeProject({ id: 'p1', name: '交付项目' });

function renderSection() {
  render(<ProjectLinkSection project={project} />);
}

async function useRealDb(): Promise<TestDb> {
  const created = createTestDb();
  db = created;
  setDbForTesting(created.executor);
  await createProjectRepository(created.executor).insert(project);
  return created;
}

beforeEach(() => {
  openerMocks.openUrl.mockReset().mockResolvedValue(undefined);
  openerMocks.localPathExists.mockReset().mockResolvedValue(true);
  openerMocks.openLocalPath.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  setDbForTesting(null);
  db?.close();
  db = null;
});

describe('ProjectLinkSection states and form', () => {
  it('renders the loading state while the first read is pending', async () => {
    setDbForTesting({
      select: () => new Promise(() => undefined),
      execute: () => new Promise(() => undefined),
    });

    renderSection();

    expect(await screen.findByText('正在加载文件与链接…')).toBeInTheDocument();
  });

  it('renders the database error state with retry', async () => {
    const failing: SqlExecutor = {
      select: () => Promise.reject(new Error('数据库不可用')),
      execute: () => Promise.resolve({ rowsAffected: 0 }),
    };
    setDbForTesting(failing);

    renderSection();

    expect(await screen.findByText('无法加载文件与链接')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('shows the guided empty state and validates the reusable create form in Chinese', async () => {
    const user = userEvent.setup();
    await useRealDb();
    renderSection();

    expect(await screen.findByText('暂无文件与链接')).toBeInTheDocument();
    expect(screen.getByText('可添加项目资料、网页链接或本地文件快捷方式。')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '新增链接' }));
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('资料名称不能为空')).toBeInTheDocument();
    expect(screen.getByText('目标地址或路径不能为空')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('类型'), 'file_path');
    expect(screen.getByLabelText('本地文件或目录路径')).toHaveAttribute(
      'placeholder',
      'C:\\项目资料\\方案.pdf',
    );
    expect(screen.getByText(/请输入 Windows 绝对路径/)).toBeInTheDocument();
  });
});

describe('ProjectLinkSection actions', () => {
  it('opens allow-listed URLs, copies targets, and hides open for other protocols', async () => {
    const user = userEvent.setup();
    const current = await useRealDb();
    const links = createProjectLinkRepository(current.executor);
    await links.insert(makeProjectLink({ id: 'http', label: '官网' }));
    await links.insert(
      makeProjectLink({
        id: 'mailto',
        label: '联系邮箱',
        target: 'mailto:owner@example.com',
      }),
    );
    renderSection();

    expect(await screen.findByText('官网')).toBeInTheDocument();
    const httpRow = screen.getByText('官网').closest('li');
    const mailRow = screen.getByText('联系邮箱').closest('li');
    expect(httpRow).not.toBeNull();
    expect(mailRow).not.toBeNull();
    expect(
      within(httpRow as HTMLElement).getByRole('button', { name: '打开' }),
    ).toBeInTheDocument();
    expect(within(mailRow as HTMLElement).queryByRole('button', { name: '打开' })).toBeNull();

    await user.click(within(httpRow as HTMLElement).getByRole('button', { name: '打开' }));
    expect(openerMocks.openUrl).toHaveBeenCalledWith('https://example.com/docs');

    await user.click(within(mailRow as HTMLElement).getByRole('button', { name: '复制' }));
    await expect(navigator.clipboard.readText()).resolves.toBe('mailto:owner@example.com');
    expect(await screen.findByText('链接已复制到剪贴板。')).toBeInTheDocument();
  });

  it('reports a missing local path without invoking opener and keeps copy available', async () => {
    const user = userEvent.setup();
    const current = await useRealDb();
    await createProjectLinkRepository(current.executor).insert(
      makeProjectLink({
        id: 'missing',
        label: '已移动文件',
        link_type: 'file_path',
        target: 'C:\\项目\\missing.pdf',
      }),
    );
    openerMocks.localPathExists.mockResolvedValue(false);
    renderSection();

    const row = (await screen.findByText('已移动文件')).closest('li');
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByRole('button', { name: '打开' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('文件或目录不存在');
    expect(openerMocks.openLocalPath).not.toHaveBeenCalled();
    expect(within(row as HTMLElement).getByRole('button', { name: '复制' })).toBeInTheDocument();
  });

  it('cancels deletion without side effects and confirms deletion with a refreshed list', async () => {
    const user = userEvent.setup();
    const current = await useRealDb();
    const links = createProjectLinkRepository(current.executor);
    await links.insert(makeProjectLink({ id: 'delete-me', label: '临时资料' }));
    renderSection();
    await screen.findByText('临时资料');

    await user.click(screen.getByRole('button', { name: '删除文件与链接：临时资料' }));
    expect(
      screen.getByText('确定删除「临时资料」吗？所属项目：交付项目。此操作不可撤销。'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(await links.findById('delete-me')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: '删除文件与链接：临时资料' }));
    await user.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(screen.queryByText('临时资料')).toBeNull();
    });
    expect(await links.findById('delete-me')).toBeNull();
    expect(screen.getByText('暂无文件与链接')).toBeInTheDocument();
  });
});
