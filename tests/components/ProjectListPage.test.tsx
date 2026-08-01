import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    expect(
      await screen.findByText('是否同时恢复因该项目归档而自动归档的任务？'),
    ).toBeInTheDocument();
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

/** Real pointer-driven drag reordering through the shared infrastructure. */
describe('ProjectListPage drag reorder', () => {
  function pointerDrag(handleLabel: string, target: HTMLElement) {
    const handle = screen.getByLabelText(handleLabel);
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 0, clientY: 120 });
    fireEvent.pointerUp(target, { pointerId: 1, clientX: 0, clientY: 120 });
  }

  function projectRow(name: string): HTMLElement {
    const row = screen.getByRole('link', { name }).closest('li');
    if (row === null) throw new Error(`项目行不存在: ${name}`);
    return row;
  }

  function visibleProjectNames(): string[] {
    return screen.getAllByRole('link').map((link) => link.textContent ?? '');
  }

  async function seedProjects(entries: readonly [string, string, string?][]) {
    const repos = await getRepositories();
    let minute = 10;
    for (const [id, name, archivedAt] of entries) {
      await repos.projects.insert(
        makeProject({
          id,
          name,
          archived_at: archivedAt ?? null,
          status: archivedAt === undefined ? 'active' : 'archived',
          updated_at: `2026-01-01T00:${String(minute).padStart(2, '0')}:00Z`,
        }),
      );
      minute -= 1;
    }
  }

  it('drags the first project onto the third, persists once, and survives a remount', async () => {
    const user = userEvent.setup();
    const current = useRealDb();
    await seedProjects([
      ['p1', '项目甲'],
      ['p2', '项目乙'],
      ['p3', '项目丙'],
    ]);

    const view = render(
      <MemoryRouter>
        <ProjectListPage />
      </MemoryRouter>,
    );
    await screen.findByRole('link', { name: '项目甲' });
    expect(visibleProjectNames()).toEqual(['项目甲', '项目乙', '项目丙']);

    await user.selectOptions(screen.getByLabelText('自定义排序'), 'custom');
    await user.click(screen.getByRole('button', { name: '保存当前排序' }));
    await user.type(screen.getByLabelText('排序名称'), '项目排序');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByDisplayValue('项目排序');

    const before = current.raw
      .prepare(`SELECT updated_at FROM named_list_orders WHERE name = '项目排序'`)
      .pluck()
      .get();

    pointerDrag('拖动排序 项目甲', projectRow('项目丙'));
    // The DOM order changes immediately at drop time.
    expect(visibleProjectNames()).toEqual(['项目乙', '项目丙', '项目甲']);

    await waitFor(() => {
      const payload = current.raw
        .prepare(`SELECT ordered_ids_json FROM named_list_orders WHERE name = '项目排序'`)
        .pluck()
        .get();
      const parsed = JSON.parse(payload as string) as { sections: Record<string, string[]> };
      expect(parsed.sections['active']).toEqual(['p2', 'p3', 'p1']);
    });
    expect(before).not.toBeUndefined();

    // Remount (page navigation / app restart): the saved mode and order reload.
    view.unmount();
    resetStore();
    render(
      <MemoryRouter>
        <ProjectListPage />
      </MemoryRouter>,
    );
    await screen.findByRole('link', { name: '项目甲' });
    await waitFor(() => {
      expect(visibleProjectNames()).toEqual(['项目乙', '项目丙', '项目甲']);
    });
  });

  it('a drop on the original position writes nothing to the saved order', async () => {
    const user = userEvent.setup();
    const current = useRealDb();
    await seedProjects([
      ['p1', '项目甲'],
      ['p2', '项目乙'],
    ]);

    render(
      <MemoryRouter>
        <ProjectListPage />
      </MemoryRouter>,
    );
    await screen.findByRole('link', { name: '项目甲' });
    await user.selectOptions(screen.getByLabelText('自定义排序'), 'custom');
    await user.click(screen.getByRole('button', { name: '保存当前排序' }));
    await user.type(screen.getByLabelText('排序名称'), '项目排序');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByDisplayValue('项目排序');
    const stamp = () =>
      current.raw
        .prepare(`SELECT updated_at FROM named_list_orders WHERE name = '项目排序'`)
        .pluck()
        .get();
    const before = stamp();

    pointerDrag('拖动排序 项目甲', projectRow('项目甲'));

    expect(visibleProjectNames()).toEqual(['项目甲', '项目乙']);
    expect(stamp()).toEqual(before);
  });

  it('dragging while a search hides rows merges into the full order without losing hidden items', async () => {
    const user = userEvent.setup();
    const current = useRealDb();
    await seedProjects([
      ['p1', '甲一'],
      ['p2', '乙搜二'],
      ['p3', '丙三'],
      ['p4', '丁搜四'],
      ['p5', '戊五'],
    ]);

    render(
      <MemoryRouter>
        <ProjectListPage />
      </MemoryRouter>,
    );
    await screen.findByRole('link', { name: '甲一' });
    await user.selectOptions(screen.getByLabelText('自定义排序'), 'custom');
    await user.click(screen.getByRole('button', { name: '保存当前排序' }));
    await user.type(screen.getByLabelText('排序名称'), '项目排序');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByDisplayValue('项目排序');

    // Search leaves only 乙搜二 and 丁搜四 visible — dragging stays enabled.
    await user.type(screen.getByLabelText('搜索'), '搜');
    await waitFor(() => {
      expect(visibleProjectNames()).toEqual(['乙搜二', '丁搜四']);
    });

    // Move 丁搜四 before 乙搜二: hidden rows keep their exact slots.
    pointerDrag('拖动排序 丁搜四', projectRow('乙搜二'));
    expect(visibleProjectNames()).toEqual(['丁搜四', '乙搜二']);

    await user.clear(screen.getByLabelText('搜索'));
    await waitFor(() => {
      expect(visibleProjectNames()).toEqual(['甲一', '丁搜四', '丙三', '乙搜二', '戊五']);
    });
    await waitFor(() => {
      const payload = current.raw
        .prepare(`SELECT ordered_ids_json FROM named_list_orders WHERE name = '项目排序'`)
        .pluck()
        .get();
      const parsed = JSON.parse(payload as string) as { sections: Record<string, string[]> };
      expect(parsed.sections['active']).toEqual(['p1', 'p4', 'p3', 'p2', 'p5']);
    });
  });

  it('keeps independent sub-orders for the active and archived scopes in one config', async () => {
    const user = userEvent.setup();
    const current = useRealDb();
    await seedProjects([
      ['p1', '项目甲'],
      ['p2', '项目乙'],
      ['p3', '归档丙', '2026-01-02T00:00:00Z'],
      ['p4', '归档丁', '2026-01-02T00:00:00Z'],
    ]);

    render(
      <MemoryRouter>
        <ProjectListPage />
      </MemoryRouter>,
    );
    await screen.findByRole('link', { name: '项目甲' });
    await user.selectOptions(screen.getByLabelText('自定义排序'), 'custom');

    pointerDrag('拖动排序 项目甲', projectRow('项目乙'));
    expect(visibleProjectNames()).toEqual(['项目乙', '项目甲']);

    // Switch to the archived scope and reorder there too.
    await user.click(screen.getByRole('tab', { name: '已归档' }));
    await screen.findByRole('link', { name: '归档丙' });
    pointerDrag('拖动排序 归档丁', projectRow('归档丙'));
    expect(visibleProjectNames()).toEqual(['归档丁', '归档丙']);

    await user.click(screen.getByRole('button', { name: '保存当前排序' }));
    await user.type(screen.getByLabelText('排序名称'), '双视图排序');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      const payload = current.raw
        .prepare(`SELECT ordered_ids_json FROM named_list_orders WHERE name = '双视图排序'`)
        .pluck()
        .get();
      const parsed = JSON.parse(payload as string) as { sections: Record<string, string[]> };
      expect(parsed.sections['archived']).toEqual(['p4', 'p3']);
      expect(parsed.sections['active']).toEqual(['p2', 'p1']);
    });

    // Switching back re-applies the active sub-order.
    await user.click(screen.getByRole('tab', { name: '活动' }));
    await screen.findByRole('link', { name: '项目甲' });
    await waitFor(() => {
      expect(visibleProjectNames()).toEqual(['项目乙', '项目甲']);
    });
  });
});
