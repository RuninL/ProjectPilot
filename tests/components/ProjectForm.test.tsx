import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProjectForm } from '@/features/projects/components/ProjectForm';
import { AppError } from '@/lib/errors';
import type { ProjectInput } from '@/services/schemas';
import { makeProject } from '../helpers/fixtures';

function setup(overrides: { onSubmit?: (input: ProjectInput) => Promise<void> } = {}) {
  const onSubmit = vi.fn<(input: ProjectInput) => Promise<void>>(
    overrides.onSubmit ?? (() => Promise.resolve()),
  );
  const onClose = vi.fn();
  render(<ProjectForm open project={null} onSubmit={onSubmit} onClose={onClose} />);
  return { onSubmit, onClose, user: userEvent.setup() };
}

describe('ProjectForm', () => {
  it('rejects an empty name with the Chinese schema message', async () => {
    const { onSubmit, onClose, user } = setup();

    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('项目名称不能为空')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('rejects a target end date earlier than the start date', async () => {
    const { onSubmit, user } = setup();

    await user.type(screen.getByLabelText('项目名称'), '内网门户重构');
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByLabelText('目标结束日期'), { target: { value: '2026-08-01' } });
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('目标结束日期不能早于开始日期')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits parsed input — blank dates become null, not empty strings', async () => {
    const { onSubmit, onClose, user } = setup();

    await user.type(screen.getByLabelText('项目名称'), '  内网门户重构  ');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: '内网门户重构',
        description: '',
        status: 'active',
        color: '#6366f1',
        start_date: null,
        target_end_date: null,
      });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open and shows the service error when the write fails', async () => {
    const { onClose, user } = setup({
      onSubmit: () => Promise.reject(new AppError('db', '数据库暂时不可写入')),
    });

    await user.type(screen.getByLabelText('项目名称'), '内网门户重构');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('数据库暂时不可写入')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('prefills the existing project when editing', () => {
    render(
      <ProjectForm
        open
        project={makeProject({ name: '现有项目', status: 'on_hold', start_date: '2026-07-01' })}
        onSubmit={() => Promise.resolve()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: '编辑项目' })).toBeInTheDocument();
    expect(screen.getByLabelText('项目名称')).toHaveValue('现有项目');
    expect(screen.getByLabelText('状态')).toHaveValue('on_hold');
    expect(screen.getByLabelText('开始日期')).toHaveValue('2026-07-01');
  });
});
