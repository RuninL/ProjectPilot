import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskChecklistSection } from '@/features/tasks/components/TaskChecklistSection';
import { TaskProgressSection } from '@/features/tasks/components/TaskProgressSection';
import { TaskResourcesSection } from '@/features/tasks/components/TaskResourcesSection';
import type { BatchStatement } from '@/lib/commands';
import { setDbForTesting } from '@/lib/db';
import { getRepositories } from '@/repositories';
import { getTaskChecklistService } from '@/services/taskChecklist.service';
import { getTaskProgressService } from '@/services/taskProgress.service';
import { makeProject, makeProjectLink, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

/**
 * Pointer-driven drag reordering on the three task-detail lists (progress
 * updates, checklist and resources), each with its own saved-order context,
 * against a real in-memory SQLite.
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

beforeEach(async () => {
  const created = createTestDb();
  db = created;
  setDbForTesting(created.executor);
  const repos = await getRepositories();
  await repos.projects.insert(makeProject({ id: 'p1', name: '项目一' }));
  await repos.tasks.insert(makeTask({ id: 't1', project_id: 'p1', title: '任务一' }));
});

afterEach(() => {
  setDbForTesting(null);
  db?.close();
  db = null;
});

function pointerDrag(handleLabel: string, target: HTMLElement) {
  const handle = screen.getByLabelText(handleLabel);
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(target, { pointerId: 1, clientX: 0, clientY: 120 });
  fireEvent.pointerUp(target, { pointerId: 1, clientX: 0, clientY: 120 });
}

function rowOf(text: string | RegExp): HTMLElement {
  const row = screen.getByText(text).closest('li');
  if (row === null) throw new Error(`行不存在: ${String(text)}`);
  return row;
}

describe('task detail sections drag reorder', () => {
  it('reorders progress updates by pointer drag and stores the task_progress order', async () => {
    const user = userEvent.setup();
    const service = await getTaskProgressService();
    const ids: string[] = [];
    for (const [title, at] of [
      ['进展一', '2026-01-03T10:00:00Z'],
      ['进展二', '2026-01-02T10:00:00Z'],
      ['进展三', '2026-01-01T10:00:00Z'],
    ] as const) {
      const update = await service.create('t1', {
        title,
        description: '',
        occurred_at: at,
        contribution_percent: 10,
      });
      ids.push(update.id);
    }

    render(<TaskProgressSection taskId="t1" onChanged={() => Promise.resolve()} />);
    await screen.findByText('进展一 · 10%');
    await user.selectOptions(screen.getByLabelText('自定义排序'), 'custom');

    const titles = () => screen.getAllByText(/^进展[一二三] · /).map((node) => node.textContent);
    expect(titles()).toEqual(['进展一 · 10%', '进展二 · 10%', '进展三 · 10%']);

    pointerDrag('拖动排序 进展一', rowOf(/进展三 · /));
    expect(titles()).toEqual(['进展二 · 10%', '进展三 · 10%', '进展一 · 10%']);

    await user.click(screen.getByRole('button', { name: '保存当前排序' }));
    await user.type(screen.getByLabelText('排序名称'), '进展排序');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      const payload = db?.raw
        .prepare(
          `SELECT ordered_ids_json FROM named_list_orders
             WHERE context = 'task_progress' AND context_id = 't1' AND name = '进展排序'`,
        )
        .pluck()
        .get();
      expect(JSON.parse(payload as string)).toEqual([ids[1], ids[2], ids[0]]);
    });
  });

  it('reorders checklist items without the checkbox starting a drag', async () => {
    const user = userEvent.setup();
    const service = await getTaskChecklistService();
    const ids: string[] = [];
    for (const content of ['待办一', '待办二', '待办三']) {
      ids.push((await service.create('t1', { content })).id);
    }

    render(<TaskChecklistSection taskId="t1" />);
    await screen.findByText('待办一');
    await user.selectOptions(screen.getByLabelText('自定义排序'), 'custom');

    // The row checkbox never starts a drag.
    const checkbox = screen.getByLabelText('完成 待办一');
    const last = rowOf('待办三');
    fireEvent.pointerDown(checkbox, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(last, { pointerId: 1, clientX: 0, clientY: 120 });
    expect(last).not.toHaveClass('ring-primary');
    fireEvent.pointerUp(last, { pointerId: 1, clientX: 0, clientY: 120 });

    const contents = () => screen.getAllByText(/^待办[一二三]$/).map((node) => node.textContent);
    expect(contents()).toEqual(['待办一', '待办二', '待办三']);

    // Last item directly onto the first.
    pointerDrag('拖动排序 待办三', rowOf('待办一'));
    expect(contents()).toEqual(['待办三', '待办一', '待办二']);

    await user.click(screen.getByRole('button', { name: '保存当前排序' }));
    await user.type(screen.getByLabelText('排序名称'), '待办排序');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      const payload = db?.raw
        .prepare(
          `SELECT ordered_ids_json FROM named_list_orders
             WHERE context = 'task_checklist' AND context_id = 't1' AND name = '待办排序'`,
        )
        .pluck()
        .get();
      expect(JSON.parse(payload as string)).toEqual([ids[2], ids[0], ids[1]]);
    });
  });

  it('reorders task resources and stores the task_resources order', async () => {
    const user = userEvent.setup();
    const repos = await getRepositories();
    for (const [id, label] of [
      ['l1', '资源一'],
      ['l2', '资源二'],
      ['l3', '资源三'],
    ] as const) {
      await repos.projectLinks.insert(
        makeProjectLink({ id, project_id: 'p1', task_id: 't1', label }),
      );
    }
    const task = await repos.tasks.findById('t1');
    if (task === null) throw new Error('任务应存在');

    render(<TaskResourcesSection task={task} projectTasks={[task]} />);
    await screen.findByText('资源一');
    await user.selectOptions(screen.getByLabelText('自定义排序'), 'custom');

    const labels = () => screen.getAllByText(/^资源[一二三]$/).map((node) => node.textContent);
    expect(labels()).toEqual(['资源一', '资源二', '资源三']);

    pointerDrag('拖动排序 资源一', rowOf('资源三'));
    expect(labels()).toEqual(['资源二', '资源三', '资源一']);

    await user.click(screen.getByRole('button', { name: '保存当前排序' }));
    await user.type(screen.getByLabelText('排序名称'), '资源排序');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      const payload = db?.raw
        .prepare(
          `SELECT ordered_ids_json FROM named_list_orders
             WHERE context = 'task_resources' AND context_id = 't1' AND name = '资源排序'`,
        )
        .pluck()
        .get();
      expect(JSON.parse(payload as string)).toEqual(['l2', 'l3', 'l1']);
    });
  });
});
