import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BulkEditDialog } from '@/features/tasks/components/BulkEditDialog';
import { AppError } from '@/lib/errors';
import type { BulkTaskUpdate } from '@/services/schemas';

function setup(onSubmitImpl: (patch: BulkTaskUpdate) => Promise<void> = () => Promise.resolve()) {
  const onSubmit = vi.fn<(patch: BulkTaskUpdate) => Promise<void>>(onSubmitImpl);
  const onClose = vi.fn();
  render(<BulkEditDialog open count={3} onSubmit={onSubmit} onClose={onClose} />);
  return { onSubmit, onClose, user: userEvent.setup() };
}

describe('BulkEditDialog', () => {
  it('refuses to advance when nothing was chosen', async () => {
    const { onSubmit, user } = setup();

    await user.click(screen.getByRole('button', { name: '下一步' }));

    expect(await screen.findByText('请至少选择一项要修改的内容')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('requires a second confirmation and writes nothing until it is given', async () => {
    const { onSubmit, user } = setup();

    await user.selectOptions(screen.getByLabelText('状态'), 'in_progress');
    await user.click(screen.getByRole('button', { name: '下一步' }));

    expect(await screen.findByText('确认对 3 个任务执行以下修改？')).toBeInTheDocument();
    expect(screen.getByText('状态改为「进行中」')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '返回修改' }));

    expect(await screen.findByRole('button', { name: '下一步' })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('sends only the fields the user set, and closes on success', async () => {
    const { onSubmit, onClose, user } = setup();

    await user.selectOptions(screen.getByLabelText('优先级'), 'urgent');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(await screen.findByRole('button', { name: '确认修改' }));

    expect(onSubmit).toHaveBeenCalledWith({ priority: 'urgent' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('treats a blank date as an explicit clear, not as "no change"', async () => {
    const { onSubmit, user } = setup();

    await user.click(screen.getByLabelText('修改截止日期'));

    expect(await screen.findByText('留空表示清除这些任务的截止日期。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByText('清除截止日期')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '确认修改' }));
    expect(onSubmit).toHaveBeenCalledWith({ due_date: null });
  });

  it('returns to the compose step and reports the error when the batch fails', async () => {
    const { onClose, user } = setup(() =>
      Promise.reject(new AppError('db', '批量修改失败，已全部回滚')),
    );

    await user.selectOptions(screen.getByLabelText('状态'), 'done');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(await screen.findByRole('button', { name: '确认修改' }));

    expect(await screen.findByText('批量修改失败，已全部回滚')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一步' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
