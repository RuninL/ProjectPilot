import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MeetingForm } from '@/features/meetings/components/MeetingForm';
import { AppError } from '@/lib/errors';
import type { MeetingInput } from '@/services/schemas';
import { makeMeeting, makeProject } from '../helpers/fixtures';

const projects = [makeProject({ id: 'p1', name: '内网门户重构' })];

function setup(
  overrides: {
    onSubmit?: (input: MeetingInput) => Promise<void>;
    lockProject?: boolean;
    defaultProjectId?: string | null;
  } = {},
) {
  const onSubmit = vi.fn<(input: MeetingInput) => Promise<void>>(
    overrides.onSubmit ?? (() => Promise.resolve()),
  );
  const onClose = vi.fn();
  render(
    <MeetingForm
      open
      meeting={null}
      projects={projects}
      defaultProjectId={overrides.defaultProjectId ?? null}
      lockProject={overrides.lockProject ?? false}
      onSubmit={onSubmit}
      onClose={onClose}
    />,
  );
  return { onSubmit, onClose, user: userEvent.setup() };
}

describe('MeetingForm', () => {
  it('rejects an empty topic and an empty date with the Chinese schema messages', async () => {
    const { onSubmit, onClose, user } = setup();

    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('会议主题不能为空')).toBeInTheDocument();
    expect(screen.getByText('日期不能为空')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('submits the meeting with the project and start time it was given', async () => {
    const { onSubmit, user } = setup({ defaultProjectId: 'p1' });

    await user.type(screen.getByLabelText('会议主题'), '双周评审');
    fireEvent.change(screen.getByLabelText('会议日期'), { target: { value: '2026-07-20' } });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '14:00' } });
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ project_id: 'p1', start_time: '14:00' }),
      );
    });
  });

  it('submits a standalone meeting with attendees split into a list', async () => {
    const { onSubmit, onClose, user } = setup();

    await user.type(screen.getByLabelText('会议主题'), '双周评审');
    fireEvent.change(screen.getByLabelText('会议日期'), { target: { value: '2026-07-20' } });
    await user.type(screen.getByLabelText('参与者'), '张三\n李四，王五');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        project_id: null,
        topic: '双周评审',
        date: '2026-07-20',
        start_time: null,
        attendees: ['张三', '李四', '王五'],
        agenda: '',
        notes: '',
        decisions: '',
        risks: '',
        meeting_url: null,
      });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open and shows the service error when the write fails', async () => {
    const { onClose, user } = setup({
      onSubmit: () => Promise.reject(new AppError('db', '数据库暂时不可写入')),
    });

    await user.type(screen.getByLabelText('会议主题'), '双周评审');
    fireEvent.change(screen.getByLabelText('会议日期'), { target: { value: '2026-07-20' } });
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('数据库暂时不可写入')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('prefills an existing meeting and renders attendees one per line', () => {
    render(
      <MeetingForm
        open
        meeting={makeMeeting({
          topic: '需求澄清',
          date: '2026-07-15',
          start_time: '09:30',
          attendees: '["张三","李四"]',
        })}
        projects={projects}
        defaultProjectId="p1"
        lockProject={false}
        onSubmit={() => Promise.resolve()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: '编辑会议' })).toBeInTheDocument();
    expect(screen.getByLabelText('会议主题')).toHaveValue('需求澄清');
    expect(screen.getByLabelText('开始时间')).toHaveValue('09:30');
    expect(screen.getByLabelText('参与者')).toHaveValue('张三\n李四');
    expect(screen.getByLabelText('所属项目')).toHaveValue('p1');
  });

  it('locks the project select when the meeting is created inside a project', () => {
    setup({ lockProject: true, defaultProjectId: 'p1' });

    const select = screen.getByLabelText('所属项目');
    expect(select).toBeDisabled();
    expect(select).toHaveValue('p1');
  });
});
