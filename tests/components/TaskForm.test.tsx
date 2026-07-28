import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TaskForm } from '@/features/tasks/components/TaskForm';
import type { TaskInput } from '@/services/schemas';
import type { Project, Task } from '@/types';
import { makeProject, makeTask } from '../helpers/fixtures';

const projects: Project[] = [
  makeProject({ id: 'p1', name: '内网门户重构' }),
  makeProject({ id: 'p2', name: '数据迁移' }),
];

/** t1 is a top-level task; t2 is its child, so t2 can never be a parent itself. */
const projectTasks: Task[] = [
  makeTask({ id: 't1', project_id: 'p1', parent_task_id: null, title: '顶层任务' }),
  makeTask({ id: 't2', project_id: 'p1', parent_task_id: 't1', title: '子任务' }),
];

function setup(task: Task | null, tasks: Task[] = projectTasks) {
  const onSubmit = vi.fn<(input: TaskInput) => Promise<void>>(() => Promise.resolve());
  const onClose = vi.fn();
  render(
    <TaskForm
      open
      task={task}
      projectId="p1"
      projects={projects}
      loadProjectTasks={() => Promise.resolve(tasks)}
      onSubmit={onSubmit}
      onClose={onClose}
    />,
  );
  return { onSubmit, onClose, user: userEvent.setup() };
}

describe('TaskForm', () => {
  it('offers only top-level tasks of the selected project as parents', async () => {
    setup(null);

    const parent = screen.getByLabelText('父任务');
    await waitFor(() => {
      expect(screen.getByRole('option', { name: '顶层任务' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('option', { name: '子任务' })).toBeNull();
    expect(parent).toBeEnabled();
  });

  it('blocks a task that already has children from becoming a child itself', async () => {
    setup(makeTask({ id: 't1', project_id: 'p1', title: '顶层任务' }));

    expect(
      await screen.findByText('该任务已有子任务，不能再成为其他任务的子任务。'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('父任务')).toBeDisabled();
    // A task itself is never a candidate parent, even when it has no children.
    expect(screen.queryByRole('option', { name: '顶层任务' })).toBeNull();
  });

  it('locks the project when editing so a task cannot move across projects', async () => {
    setup(makeTask({ id: 't9', project_id: 'p1', title: '已有任务' }));

    expect(await screen.findByText('任务不能移动到其他项目。')).toBeInTheDocument();
    expect(screen.getByLabelText('所属项目')).toBeDisabled();
    // Unrelated top-level tasks stay available as parents.
    expect(await screen.findByRole('option', { name: '顶层任务' })).toBeInTheDocument();
  });

  it('rejects an empty title and an out-of-range progress', async () => {
    const { onSubmit, user } = setup(null);

    await user.clear(screen.getByLabelText('进度（%）'));
    await user.type(screen.getByLabelText('进度（%）'), '150');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('任务标题不能为空')).toBeInTheDocument();
    expect(screen.getByText('进度不能大于 100')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('coerces the string form state into typed service input', async () => {
    const { onSubmit, onClose, user } = setup(null);

    await user.type(screen.getByLabelText('任务标题'), '梳理接口清单');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        project_id: 'p1',
        parent_task_id: null,
        title: '梳理接口清单',
        description: '',
        status: 'todo',
        priority: 'medium',
        start_date: null,
        due_date: null,
        progress: 0,
        estimated_hours: null,
        actual_hours: null,
      });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
