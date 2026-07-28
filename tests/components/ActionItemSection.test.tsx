import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ActionItemSection } from '@/features/meetings/components/ActionItemSection';
import { AppError } from '@/lib/errors';
import type { ActionItem } from '@/types';
import { makeActionItem, makeProject } from '../helpers/fixtures';
import { NOW } from '../helpers/testDb';

const projects = [makeProject({ id: 'p1', name: '内网门户重构' })];

interface Handlers {
  onConvert?: (id: string, projectId: string | null) => Promise<string>;
  onDelete?: (id: string) => Promise<void>;
}

function setup(
  items: readonly ActionItem[],
  meetingProjectId: string | null,
  handlers: Handlers = {},
) {
  const onConvert = vi.fn<(id: string, projectId: string | null) => Promise<string>>(
    handlers.onConvert ?? (() => Promise.resolve('t-new')),
  );
  const onDelete = vi.fn<(id: string) => Promise<void>>(
    handlers.onDelete ?? (() => Promise.resolve()),
  );
  render(
    <MemoryRouter>
      <ActionItemSection
        items={items}
        meetingProjectId={meetingProjectId}
        projects={projects}
        onCreate={() => Promise.resolve()}
        onUpdate={() => Promise.resolve()}
        onDelete={onDelete}
        onConvert={onConvert}
      />
    </MemoryRouter>,
  );
  return { onConvert, onDelete, user: userEvent.setup() };
}

describe('ActionItemSection', () => {
  it('shows the empty state when the meeting has no action items', () => {
    setup([], 'p1');

    expect(
      screen.getByText('本次会议暂无行动项。新建行动项后可以转为任务跟踪。'),
    ).toBeInTheDocument();
  });

  it('disables the convert button for the whole round-trip so a double click cannot write twice', async () => {
    const deferred: { resolve: (taskId: string) => void } = { resolve: () => undefined };
    const pending = new Promise<string>((resolve) => {
      deferred.resolve = resolve;
    });
    const { onConvert, user } = setup(
      [makeActionItem({ id: 'a1', content: '补充接口文档' })],
      'p1',
      {
        onConvert: () => pending,
      },
    );

    await user.click(screen.getByRole('button', { name: '转为任务' }));

    const busyButton = await screen.findByRole('button', { name: '转换中…' });
    expect(busyButton).toBeDisabled();
    await user.click(busyButton);
    expect(onConvert).toHaveBeenCalledTimes(1);

    deferred.resolve('t-new');
    expect(await screen.findByRole('link', { name: '前往任务' })).toHaveAttribute(
      'href',
      '/tasks?taskId=t-new',
    );
  });

  it('offers a link to the task instead of a second conversion once converted', () => {
    setup(
      [
        makeActionItem({
          id: 'a1',
          content: '补充接口文档',
          converted_task_id: 't9',
          converted_at: NOW,
        }),
      ],
      'p1',
    );

    expect(screen.getByRole('link', { name: '查看任务' })).toHaveAttribute(
      'href',
      '/tasks?taskId=t9',
    );
    expect(screen.queryByRole('button', { name: '转为任务' })).toBeNull();
    expect(screen.getByText('已转为任务')).toBeInTheDocument();
  });

  it('stays terminal when the converted task was later deleted', () => {
    setup(
      [
        makeActionItem({
          id: 'a1',
          content: '补充接口文档',
          converted_task_id: null,
          converted_at: NOW,
        }),
      ],
      'p1',
    );

    expect(screen.queryByRole('button', { name: '转为任务' })).toBeNull();
    expect(screen.getAllByText('任务已删除').length).toBeGreaterThan(0);
  });

  it('asks for a target project when the meeting has none and converts with the choice', async () => {
    const { onConvert, user } = setup(
      [makeActionItem({ id: 'a1', content: '补充接口文档' })],
      null,
    );

    await user.click(screen.getByRole('button', { name: '转为任务' }));

    expect(await screen.findByRole('heading', { name: '选择任务所属项目' })).toBeInTheDocument();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('button', { name: '转为任务' })).toBeDisabled();
    expect(onConvert).not.toHaveBeenCalled();

    await user.selectOptions(dialog.getByLabelText('所属项目'), 'p1');
    await user.click(dialog.getByRole('button', { name: '转为任务' }));

    await waitFor(() => {
      expect(onConvert).toHaveBeenCalledWith('a1', 'p1');
    });
  });

  it('cancelling the project picker converts nothing', async () => {
    const { onConvert, user } = setup(
      [makeActionItem({ id: 'a1', content: '补充接口文档' })],
      null,
    );

    await user.click(screen.getByRole('button', { name: '转为任务' }));
    await screen.findByRole('heading', { name: '选择任务所属项目' });
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '选择任务所属项目' })).toBeNull();
    });
    expect(onConvert).not.toHaveBeenCalled();
  });

  it('surfaces a rejected conversion and leaves the item convertible', async () => {
    const { user } = setup([makeActionItem({ id: 'a1', content: '补充接口文档' })], 'p1', {
      onConvert: () =>
        Promise.reject(new AppError('conflict', '项目已归档，无法新建任务；请先恢复该项目')),
    });

    await user.click(screen.getByRole('button', { name: '转为任务' }));

    expect(await screen.findByText('项目已归档，无法新建任务；请先恢复该项目')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '转为任务' })).toBeEnabled();
  });

  it('cancelling the delete confirmation deletes nothing', async () => {
    const { onDelete, user } = setup([makeActionItem({ id: 'a1', content: '补充接口文档' })], 'p1');

    await user.click(screen.getByRole('button', { name: '删除行动项：补充接口文档' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('confirming the delete says the converted task is kept and deletes the item', async () => {
    const { onDelete, user } = setup(
      [
        makeActionItem({
          id: 'a1',
          content: '补充接口文档',
          converted_task_id: 't9',
          converted_at: NOW,
        }),
      ],
      'p1',
    );

    await user.click(screen.getByRole('button', { name: '删除行动项：补充接口文档' }));

    expect(
      await screen.findByText(
        '确定删除行动项「补充接口文档」吗？已转换出的任务会保留，不会被删除。',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('a1');
    });
  });
});
