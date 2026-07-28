import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TaskFilters } from '@/features/tasks/components/TaskFilters';
import type { TaskPriority, TaskStatus } from '@/types';
import { makeProject } from '../helpers/fixtures';

interface Overrides {
  statuses?: TaskStatus[];
  priorities?: TaskPriority[];
  withProjects?: boolean;
  dueFrom?: string | null;
}

function setup({
  statuses = [],
  priorities = [],
  withProjects = false,
  dueFrom = null,
}: Overrides = {}) {
  const handlers = {
    onSearchChange: vi.fn(),
    onStatusesChange: vi.fn(),
    onPrioritiesChange: vi.fn(),
    onProjectIdsChange: vi.fn(),
    onDueRangeChange: vi.fn(),
    onSortChange: vi.fn(),
    onReset: vi.fn(),
  };
  render(
    <TaskFilters
      search=""
      statuses={statuses}
      priorities={priorities}
      projectIds={[]}
      dueFrom={dueFrom}
      dueTo={null}
      sortBy="due_date"
      {...(withProjects ? { projects: [makeProject({ id: 'p1', name: '内网门户重构' })] } : {})}
      {...handlers}
    />,
  );
  return { ...handlers, user: userEvent.setup() };
}

describe('TaskFilters', () => {
  it('adds an unselected status and reflects selection with aria-pressed', async () => {
    const { onStatusesChange, user } = setup();

    const inProgress = screen.getByRole('button', { name: '进行中' });
    expect(inProgress).toHaveAttribute('aria-pressed', 'false');

    await user.click(inProgress);
    expect(onStatusesChange).toHaveBeenCalledWith(['in_progress']);
  });

  it('removes an already selected status and priority', async () => {
    const { onStatusesChange, onPrioritiesChange, user } = setup({
      statuses: ['todo', 'blocked'],
      priorities: ['urgent'],
    });

    expect(screen.getByRole('button', { name: '待办' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '待办' }));
    expect(onStatusesChange).toHaveBeenCalledWith(['blocked']);

    await user.click(screen.getByRole('button', { name: '紧急' }));
    expect(onPrioritiesChange).toHaveBeenCalledWith([]);
  });

  it('reports the due-date range as a YYYY-MM-DD string', () => {
    const { onDueRangeChange } = setup();

    fireEvent.change(screen.getByLabelText('截止起'), { target: { value: '2026-08-01' } });
    expect(onDueRangeChange).toHaveBeenCalledWith('2026-08-01', null);
  });

  it('reports a cleared due-date bound as null rather than an empty string', () => {
    const { onDueRangeChange } = setup({ dueFrom: '2026-08-01' });

    fireEvent.change(screen.getByLabelText('截止起'), { target: { value: '' } });
    expect(onDueRangeChange).toHaveBeenCalledWith(null, null);
  });

  it('hides the project filter when no project options are supplied', () => {
    setup();
    expect(screen.queryByLabelText('项目')).toBeNull();
  });

  it('reports a chosen project and clears back to all projects', async () => {
    const { onProjectIdsChange, user } = setup({ withProjects: true });

    await user.selectOptions(screen.getByLabelText('项目'), 'p1');
    expect(onProjectIdsChange).toHaveBeenCalledWith(['p1']);

    await user.selectOptions(screen.getByLabelText('项目'), '');
    expect(onProjectIdsChange).toHaveBeenLastCalledWith([]);
  });

  it('forwards search, sort and reset', async () => {
    const { onSearchChange, onSortChange, onReset, user } = setup();

    // The input is controlled by the caller, so each keystroke reports on its own.
    await user.type(screen.getByLabelText('搜索'), '接');
    expect(onSearchChange).toHaveBeenCalledWith('接');

    await user.selectOptions(screen.getByLabelText('排序'), 'priority');
    expect(onSortChange).toHaveBeenCalledWith('priority');

    await user.click(screen.getByRole('button', { name: '重置筛选' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
