import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DependencySection } from '@/features/dependencies/components/DependencySection';
import type { ProjectDependencyAnalysis } from '@/services/dependency.service';
import { buildDependencyGraph } from '@/services/dependencyGraph';
import { useGanttStore } from '@/stores/useGanttStore';
import type { Task, TaskDependency } from '@/types';
import { makeTask } from '../helpers/fixtures';
import { NOW } from '../helpers/testDb';

function dependency(id: string, predecessorId: string, successorId: string): TaskDependency {
  return {
    id,
    predecessor_id: predecessorId,
    successor_id: successorId,
    dep_type: 'FS',
    lag_days: 0,
    created_at: NOW,
    updated_at: NOW,
  };
}

function analyze(
  tasks: readonly Task[],
  dependencies: readonly TaskDependency[] = [],
  overrides: Partial<ProjectDependencyAnalysis> = {},
): ProjectDependencyAnalysis {
  return {
    tasks,
    dependencies,
    graph: buildDependencyGraph(tasks, dependencies),
    conflicts: [],
    blockedRisks: [],
    cyclicTaskIds: [],
    ...overrides,
  };
}

function setup(
  analysis: ProjectDependencyAnalysis | null,
  options: {
    loading?: boolean;
    error?: string | null;
    canEdit?: boolean;
    editHint?: string | null;
    onCreate?: (predecessorId: string, successorId: string) => Promise<void>;
    onDelete?: (id: string) => Promise<void>;
  } = {},
) {
  const onCreate = vi.fn(options.onCreate ?? (() => Promise.resolve()));
  const onDelete = vi.fn(options.onDelete ?? (() => Promise.resolve()));
  const onRetry = vi.fn();
  render(
    <DependencySection
      analysis={analysis}
      loading={options.loading ?? false}
      error={options.error ?? null}
      canEdit={options.canEdit ?? true}
      editHint={options.editHint ?? null}
      onCreate={onCreate}
      onDelete={onDelete}
      onRetry={onRetry}
    />,
  );
  return { onCreate, onDelete, onRetry, user: userEvent.setup() };
}

const THREE_TASKS = [
  makeTask({ id: 'a', title: '需求' }),
  makeTask({ id: 'b', title: '设计' }),
  makeTask({ id: 'c', title: '开发' }),
];

beforeEach(() => {
  useGanttStore.setState({ scale: 'month', selectedTaskId: null, showConflicts: true });
});

describe('DependencySection — states', () => {
  it('shows a loading state before the first analysis arrives', () => {
    setup(null, { loading: true });

    expect(screen.getByText('正在加载任务依赖…')).toBeInTheDocument();
  });

  it('shows an error state with a retry action', async () => {
    const { onRetry, user } = setup(null, { error: '读取依赖失败' });

    expect(screen.getByText('读取依赖失败')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state when the project has no dependencies', () => {
    setup(analyze(THREE_TASKS));

    expect(screen.getByText(/该项目暂无任务依赖/)).toBeInTheDocument();
  });

  it('disables editing for an archived project and says why', () => {
    setup(analyze(THREE_TASKS), { canEdit: false, editHint: '项目已归档，无法新建任务依赖' });

    expect(screen.getByLabelText('前驱任务')).toBeDisabled();
    expect(screen.getByRole('button', { name: '添加依赖' })).toBeDisabled();
    expect(screen.getByText('项目已归档，无法新建任务依赖')).toBeInTheDocument();
  });
});

describe('DependencySection — candidate filtering', () => {
  it('offers every unarchived task as a predecessor', () => {
    setup(analyze([...THREE_TASKS, makeTask({ id: 'old', title: '归档任务', archived_at: NOW })]));

    const options = screen.getByLabelText<HTMLSelectElement>('前驱任务').querySelectorAll('option');
    expect([...options].map((option) => option.textContent)).toEqual([
      '请选择前驱任务',
      '需求',
      '设计',
      '开发',
    ]);
  });

  it('excludes itself, archived, already-linked and cycle-forming successors', async () => {
    const tasks = [...THREE_TASKS, makeTask({ id: 'old', title: '归档任务', archived_at: NOW })];
    // 需求 -> 设计 exists, and 设计 -> 开发 exists, so from 开发 every other task
    // would close a cycle.
    const { user } = setup(
      analyze(tasks, [dependency('e1', 'a', 'b'), dependency('e2', 'b', 'c')]),
    );

    await user.selectOptions(screen.getByLabelText('前驱任务'), 'a');
    const fromNeedsAnalysis = [
      ...screen.getByLabelText<HTMLSelectElement>('后继任务').querySelectorAll('option'),
    ].map((option) => option.textContent);
    // 设计 already linked, 需求 is itself, 归档任务 is archived — only 开发 remains.
    expect(fromNeedsAnalysis).toEqual(['请选择后继任务', '开发']);

    await user.selectOptions(screen.getByLabelText('前驱任务'), 'c');
    expect(
      screen.getByText(/没有可选的后继任务：其余任务或已建立依赖，或会形成循环依赖，或已归档/),
    ).toBeInTheDocument();
  });

  it('keeps the successor list disabled until a predecessor is chosen', () => {
    setup(analyze(THREE_TASKS));

    expect(screen.getByLabelText('后继任务')).toBeDisabled();
    expect(screen.getByRole('button', { name: '添加依赖' })).toBeDisabled();
  });
});

describe('DependencySection — creating', () => {
  it('creates the chosen pair and clears the form', async () => {
    const { onCreate, user } = setup(analyze(THREE_TASKS));

    await user.selectOptions(screen.getByLabelText('前驱任务'), 'a');
    await user.selectOptions(screen.getByLabelText('后继任务'), 'b');
    await user.click(screen.getByRole('button', { name: '添加依赖' }));

    expect(onCreate).toHaveBeenCalledWith('a', 'b');
    expect(screen.getByLabelText<HTMLSelectElement>('前驱任务').value).toBe('');
  });

  it('surfaces the service error and keeps the selection', async () => {
    const { user } = setup(analyze(THREE_TASKS), {
      onCreate: () => Promise.reject(new Error('会形成循环依赖：「需求」已经是「开发」的前置任务')),
    });

    await user.selectOptions(screen.getByLabelText('前驱任务'), 'a');
    await user.selectOptions(screen.getByLabelText('后继任务'), 'b');
    await user.click(screen.getByRole('button', { name: '添加依赖' }));

    expect(
      await screen.findByText('会形成循环依赖：「需求」已经是「开发」的前置任务'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText<HTMLSelectElement>('前驱任务').value).toBe('a');
  });
});

describe('DependencySection — listing and deleting', () => {
  it('lists each edge with both task names and its type', () => {
    setup(analyze(THREE_TASKS, [dependency('e1', 'a', 'b')]));

    // Scoped to the row, because the task names also appear in the dropdowns.
    const [row] = screen.getAllByRole('listitem');
    expect(row).toHaveTextContent('需求');
    expect(row).toHaveTextContent('设计');
    expect(row).toHaveTextContent('完成后开始（FS）');
  });

  it('marks a conflicted edge and a blocked-risk successor with names', () => {
    setup(
      analyze(THREE_TASKS, [dependency('e1', 'a', 'b')], {
        conflicts: [
          {
            edgeId: 'e1',
            predecessorId: 'a',
            successorId: 'b',
            predecessorDueDate: '2026-08-20',
            successorStartDate: '2026-08-10',
          },
        ],
        blockedRisks: [{ taskId: 'b', blockedBy: ['a'] }],
      }),
    );

    expect(screen.getByText('排期冲突')).toBeInTheDocument();
    expect(screen.getByText('受阻风险：需求')).toBeInTheDocument();
  });

  it('asks for a second confirmation before deleting', async () => {
    const { onDelete, user } = setup(analyze(THREE_TASKS, [dependency('e1', 'a', 'b')]));

    await user.click(screen.getByRole('button', { name: '删除依赖：需求 → 设计' }));

    expect(
      screen.getByText('确定删除「需求」→「设计」的依赖吗？两个任务的状态不会改变。'),
    ).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '删除' }));
    expect(onDelete).toHaveBeenCalledWith('e1');
  });

  it('cancelling the confirmation deletes nothing', async () => {
    const { onDelete, user } = setup(analyze(THREE_TASKS, [dependency('e1', 'a', 'b')]));

    await user.click(screen.getByRole('button', { name: '删除依赖：需求 → 设计' }));
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('完成后开始（FS）')).toBeInTheDocument();
  });

  it('locates the successor in the Gantt chart', async () => {
    const { user } = setup(analyze(THREE_TASKS, [dependency('e1', 'a', 'b')]));

    await user.click(screen.getByRole('button', { name: '在甘特图中定位' }));

    expect(useGanttStore.getState().selectedTaskId).toBe('b');
  });

  it('reports a stored cycle with the task names involved', () => {
    setup(
      analyze(THREE_TASKS, [dependency('e1', 'a', 'b'), dependency('e2', 'b', 'c')], {
        cyclicTaskIds: ['a', 'b', 'c'],
      }),
    );

    expect(screen.getByText(/检测到循环依赖，涉及任务：需求、设计、开发/)).toBeInTheDocument();
  });
});
