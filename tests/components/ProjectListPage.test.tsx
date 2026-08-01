import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectListPage } from '@/features/projects/pages/ProjectListPage';
import type { BatchStatement } from '@/lib/commands';
import { setDbForTesting, type SqlExecutor } from '@/lib/db';
import { getRepositories } from '@/repositories';
import { useProjectStore } from '@/stores/useProjectStore';
import { makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

/**
 * Page-level tests run against a real in-memory SQLite through the actual
 * store → service → repository stack; only the Tauri database handle is
 * swapped out. Assertions about "no side effect" therefore read the database
 * back rather than trusting a spy.
 */

let db: TestDb | null = null;

// Archiving a project is now an atomic batch (project + cascade task archive),
// so the Rust command is routed to the same in-memory database.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: { statements?: BatchStatement[] }) => {
    if (command !== 'execute_batch') {
      return Promise.reject(new Error(`unexpected command: ${command}`));
    }
    if (db === null || args?.statements === undefined) {
      return Promise.reject(new Error('test database not installed'));
    }
    return Promise.resolve(db.runBatch(args.statements));
  },
}));

function renderPage() {
  render(
    <MemoryRouter>
      <ProjectListPage />
    </MemoryRouter>,
  );
}

function resetStore() {
  useProjectStore.setState({
    projects: [],
    progress: {},
    loading: false,
    error: null,
    options: [],
    filters: { search: '', status: null, scope: 'active', sort: 'updated_at', participantIds: [] },
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  setDbForTesting(null);
  db?.close();
  db = null;
});

function useRealDb(): TestDb {
  const created = createTestDb();
  db = created;
  setDbForTesting(created.executor);
  return created;
}

describe('ProjectListPage', () => {
  it('shows the loading state while the first read is in flight', async () => {
    const pending: SqlExecutor = {
      select: () => new Promise(() => undefined),
      execute: () => new Promise(() => undefined),
    };
    setDbForTesting(pending);

    renderPage();

    expect(await screen.findByText('正在加载项目…')).toBeInTheDocument();
  });

  it('shows the empty state when no project matches the filters', async () => {
    useRealDb();

    renderPage();

    expect(await screen.findByText('还没有符合条件的项目')).toBeInTheDocument();
    expect(screen.getByText('共 0 个项目符合当前筛选条件。', { exact: false })).toBeInTheDocument();
  });

  it('shows the database error state with a retry affordance', async () => {
    const failing: SqlExecutor = {
      select: () => Promise.reject(new Error('database disk image is malformed')),
      execute: () => Promise.resolve({ rowsAffected: 0 }),
    };
    setDbForTesting(failing);

    renderPage();

    expect(await screen.findByText('无法读取项目')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('lists projects from the database with their real completion rate', async () => {
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1', name: '内网门户重构' }));
    await repos.tasks.insert(
      makeTask({ id: 't1', project_id: 'p1', status: 'done', progress: 100 }),
    );
    await repos.tasks.insert(makeTask({ id: 't2', project_id: 'p1', status: 'todo' }));

    renderPage();

    expect(await screen.findByRole('link', { name: '内网门户重构' })).toBeInTheDocument();
    expect(screen.getByText('1 / 2 已完成')).toBeInTheDocument();
  });

  it('cancelling the archive confirmation leaves the project untouched', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1', name: '内网门户重构' }));

    renderPage();
    await screen.findByRole('link', { name: '内网门户重构' });

    await user.click(screen.getByRole('button', { name: '内网门户重构 的操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '归档项目' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const after = await repos.projects.findById('p1');
    expect(after?.archived_at).toBeNull();
    expect(after?.status).toBe('active');
  });

  it('confirming the archive writes archived_at and the archived status', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1', name: '内网门户重构' }));

    renderPage();
    await screen.findByRole('link', { name: '内网门户重构' });

    await user.click(screen.getByRole('button', { name: '内网门户重构 的操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '归档项目' }));
    await user.click(await screen.findByRole('button', { name: '归档' }));

    await waitFor(async () => {
      const after = await repos.projects.findById('p1');
      expect(after?.archived_at).not.toBeNull();
      expect(after?.status).toBe('archived');
    });
  });

  it('offers permanent delete only for an archived project', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1', name: '活动项目' }));

    renderPage();
    await screen.findByRole('link', { name: '活动项目' });

    await user.click(screen.getByRole('button', { name: '活动项目 的操作' }));
    const item = await screen.findByRole('menuitem', { name: '永久删除（需先归档）' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows the real task count before a permanent delete and cancels without writing', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(
      makeProject({
        id: 'p1',
        name: '已归档项目',
        status: 'archived',
        archived_at: '2026-07-01T00:00:00Z',
      }),
    );
    await repos.tasks.insert(makeTask({ id: 't1', project_id: 'p1' }));
    await repos.tasks.insert(makeTask({ id: 't2', project_id: 'p1' }));
    useProjectStore.setState({
      filters: {
        search: '',
        status: null,
        scope: 'archived',
        sort: 'updated_at',
        participantIds: [],
      },
    });

    renderPage();
    await screen.findByRole('link', { name: '已归档项目' });

    await user.click(screen.getByRole('button', { name: '已归档项目 的操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '永久删除' }));

    expect(
      await screen.findByText('将同时删除 2 个任务、0 场会议、0 个里程碑和 0 个文件/链接。'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(await repos.projects.findById('p1')).not.toBeNull();
  });

  it('restoring with 仅恢复项目 keeps project-archived tasks archived', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(
      makeProject({
        id: 'p1',
        name: '已归档项目',
        status: 'archived',
        archived_at: '2026-07-01T00:00:00Z',
      }),
    );
    await repos.tasks.insert(
      makeTask({
        id: 't1',
        project_id: 'p1',
        archived_at: '2026-07-01T00:00:00Z',
        archived_source: 'project',
      }),
    );
    useProjectStore.setState({
      filters: {
        search: '',
        status: null,
        scope: 'archived',
        sort: 'updated_at',
        participantIds: [],
      },
    });

    renderPage();
    await screen.findByRole('link', { name: '已归档项目' });

    await user.click(screen.getByRole('button', { name: '已归档项目 的操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '恢复项目' }));

    expect(await screen.findByText('是否同时恢复因该项目归档而自动归档的任务？')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '仅恢复项目' }));

    await waitFor(async () => {
      const project = await repos.projects.findById('p1');
      expect(project?.archived_at).toBeNull();
    });
    const task = await repos.tasks.findById('t1');
    expect(task?.archived_at).not.toBeNull();
    expect(task?.archived_source).toBe('project');
  });

  it('restoring with 恢复项目和任务 restores only project-archived tasks', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(
      makeProject({
        id: 'p1',
        name: '已归档项目',
        status: 'archived',
        archived_at: '2026-07-01T00:00:00Z',
      }),
    );
    await repos.tasks.insert(
      makeTask({
        id: 't1',
        project_id: 'p1',
        archived_at: '2026-07-01T00:00:00Z',
        archived_source: 'project',
      }),
    );
    await repos.tasks.insert(
      makeTask({
        id: 't2',
        project_id: 'p1',
        archived_at: '2026-06-01T00:00:00Z',
        archived_source: 'manual',
      }),
    );
    useProjectStore.setState({
      filters: {
        search: '',
        status: null,
        scope: 'archived',
        sort: 'updated_at',
        participantIds: [],
      },
    });

    renderPage();
    await screen.findByRole('link', { name: '已归档项目' });

    await user.click(screen.getByRole('button', { name: '已归档项目 的操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '恢复项目' }));
    await user.click(await screen.findByRole('button', { name: '恢复项目和任务' }));

    await waitFor(async () => {
      const project = await repos.projects.findById('p1');
      expect(project?.archived_at).toBeNull();
    });
    const auto = await repos.tasks.findById('t1');
    expect(auto?.archived_at).toBeNull();
    expect(auto?.archived_source).toBeNull();
    const manual = await repos.tasks.findById('t2');
    expect(manual?.archived_at).not.toBeNull();
    expect(manual?.archived_source).toBe('manual');
  });
});
