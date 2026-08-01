import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskWorkspace } from '@/features/tasks/components/TaskWorkspace';
import type { BatchStatement } from '@/lib/commands';
import { setDbForTesting } from '@/lib/db';
import { getRepositories } from '@/repositories';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTaskFilterStore } from '@/stores/useTaskFilterStore';
import { useTaskStore } from '@/stores/useTaskStore';
import { makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

/**
 * Real pointer-driven task reordering through the shared drag infrastructure,
 * against an in-memory SQLite via the actual store → service → repository
 * stack. Covers the active/archived/all sub-orders sharing one named config.
 */

let db: TestDb | null = null;

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

function renderWorkspace() {
  return render(
    <MemoryRouter>
      <TaskWorkspace projectId={null} canCreate createHint={null} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useTaskStore.setState({ tasks: [], loading: false, error: null });
  useTaskFilterStore.getState().reset();
  useProjectStore.setState({ options: [] });
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

function taskRow(title: string): HTMLElement {
  const row = screen.getByRole('link', { name: title }).closest('li');
  if (row === null) throw new Error(`任务行不存在: ${title}`);
  return row;
}

function visibleTaskTitles(): string[] {
  return screen.getAllByRole('link').map((link) => link.textContent);
}

function pointerDrag(handleLabel: string, target: HTMLElement) {
  const handle = screen.getByLabelText(handleLabel);
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(target, { pointerId: 1, clientX: 0, clientY: 120 });
  fireEvent.pointerUp(target, { pointerId: 1, clientX: 0, clientY: 120 });
}

async function seed() {
  const repos = await getRepositories();
  await repos.projects.insert(makeProject({ id: 'p1', name: '项目一' }));
  const entries: [string, string, string | null][] = [
    ['t1', '任务甲', null],
    ['t2', '任务乙', null],
    ['t3', '任务丙', null],
    ['t4', '归档丁', '2026-01-02T00:00:00Z'],
    ['t5', '归档戊', '2026-01-02T00:00:00Z'],
  ];
  let day = 10;
  for (const [id, title, archivedAt] of entries) {
    await repos.tasks.insert(
      makeTask({
        id,
        title,
        project_id: 'p1',
        archived_at: archivedAt,
        archived_source: archivedAt === null ? null : 'manual',
        due_date: `2099-01-${String(day).padStart(2, '0')}`,
      }),
    );
    day += 1;
  }
}

describe('TaskWorkspace drag reorder', () => {
  it('drags the first task onto the third and the last onto the first', async () => {
    const user = userEvent.setup();
    useRealDb();
    await seed();

    renderWorkspace();
    await screen.findByRole('link', { name: '任务甲' });
    expect(visibleTaskTitles()).toEqual(['任务甲', '任务乙', '任务丙']);
    await user.selectOptions(screen.getByLabelText('自定义排序'), 'custom');

    // First directly onto the third (downwards across several rows).
    pointerDrag('拖动排序 任务甲', taskRow('任务丙'));
    expect(visibleTaskTitles()).toEqual(['任务乙', '任务丙', '任务甲']);

    // Last directly onto the first (upwards across several rows).
    pointerDrag('拖动排序 任务甲', taskRow('任务乙'));
    expect(visibleTaskTitles()).toEqual(['任务甲', '任务乙', '任务丙']);
  });

  it('keeps three sub-orders (active/archived/all) in one config and reloads them per scope', async () => {
    const user = userEvent.setup();
    const current = useRealDb();
    await seed();

    renderWorkspace();
    await screen.findByRole('link', { name: '任务甲' });
    await user.selectOptions(screen.getByLabelText('自定义排序'), 'custom');
    pointerDrag('拖动排序 任务甲', taskRow('任务乙'));
    expect(visibleTaskTitles()).toEqual(['任务乙', '任务甲', '任务丙']);

    await user.click(screen.getByRole('tab', { name: '已归档任务' }));
    await screen.findByRole('link', { name: '归档丁' });
    pointerDrag('拖动排序 归档戊', taskRow('归档丁'));
    expect(visibleTaskTitles()).toEqual(['归档戊', '归档丁']);

    await user.click(screen.getByRole('tab', { name: '全部任务' }));
    await screen.findByRole('link', { name: '任务甲' });
    pointerDrag('拖动排序 归档戊', taskRow('任务甲'));
    await waitFor(() => {
      expect(visibleTaskTitles()[0]).toBe('归档戊');
    });

    await user.click(screen.getByRole('button', { name: '保存当前排序' }));
    await user.type(screen.getByLabelText('排序名称'), '任务排序');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      const payload = current.raw
        .prepare(
          `SELECT ordered_ids_json FROM named_list_orders
             WHERE context = 'tasks' AND name = '任务排序'`,
        )
        .pluck()
        .get();
      const parsed = JSON.parse(payload as string) as { sections: Record<string, string[]> };
      expect(parsed.sections['active']).toEqual(['t2', 't1', 't3']);
      expect(parsed.sections['archived']).toEqual(['t5', 't4']);
      expect(parsed.sections['all']?.[0]).toBe('t5');
    });

    // Switching back re-applies each scope's own saved sub-order.
    await user.click(screen.getByRole('tab', { name: '活动任务' }));
    await screen.findByRole('link', { name: '任务甲' });
    await waitFor(() => {
      expect(visibleTaskTitles()).toEqual(['任务乙', '任务甲', '任务丙']);
    });
    await user.click(screen.getByRole('tab', { name: '已归档任务' }));
    await screen.findByRole('link', { name: '归档丁' });
    await waitFor(() => {
      expect(visibleTaskTitles()).toEqual(['归档戊', '归档丁']);
    });
  });

  it('the row checkbox never starts a drag', async () => {
    const user = userEvent.setup();
    useRealDb();
    await seed();

    renderWorkspace();
    await screen.findByRole('link', { name: '任务甲' });
    await user.selectOptions(screen.getByLabelText('自定义排序'), 'custom');

    const checkbox = screen.getByLabelText('选择任务 任务甲');
    const target = taskRow('任务丙');
    fireEvent.pointerDown(checkbox, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 0, clientY: 120 });
    expect(target).not.toHaveClass('ring-primary');
    fireEvent.pointerUp(target, { pointerId: 1, clientX: 0, clientY: 120 });

    expect(visibleTaskTitles()).toEqual(['任务甲', '任务乙', '任务丙']);
  });
});
