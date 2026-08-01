import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MeetingTaskSelector } from '@/features/meetings/components/MeetingTaskSelector';
import type { TaskWithProject } from '@/types';
import { makeTask } from '../helpers/fixtures';

const mocks = vi.hoisted(() => ({
  link: vi.fn(() => Promise.resolve()),
  unlink: vi.fn(() => Promise.resolve()),
  linked: [] as TaskWithProject[],
  tasks: [] as TaskWithProject[],
}));

vi.mock('@/services/task.service', () => ({
  getTaskService: () =>
    Promise.resolve({
      listTasks: () => Promise.resolve(mocks.tasks),
    }),
}));
vi.mock('@/services/taskMeeting.service', () => ({
  getTaskMeetingService: () =>
    Promise.resolve({
      listTasksByMeeting: () => Promise.resolve(mocks.linked),
      link: mocks.link,
      unlink: mocks.unlink,
    }),
}));

function task(id: string, title: string): TaskWithProject {
  return {
    ...makeTask({ id, title }),
    project_name: '项目甲',
    project_color: '#123456',
    project_status: 'active',
  };
}

function Harness({ meetingId }: { meetingId: string | null }) {
  const [selected, setSelected] = useState<readonly string[]>([]);
  return (
    <MemoryRouter>
      <MeetingTaskSelector
        meetingId={meetingId}
        selectedTaskIds={selected}
        onSelectedTaskIdsChange={setSelected}
      />
    </MemoryRouter>
  );
}

describe('MeetingTaskSelector', () => {
  it('stages multiple unique tasks before creating a meeting without writing early', async () => {
    mocks.tasks = [task('t1', '任务一'), task('t2', '任务二')];
    mocks.linked = [];
    mocks.link.mockClear();
    const user = userEvent.setup();
    render(<Harness meetingId={null} />);

    const firstAdd = (await screen.findAllByRole('button', { name: '关联' }))[0];
    if (firstAdd === undefined) throw new Error('missing first task candidate');
    await user.click(firstAdd);
    await user.click(screen.getByRole('button', { name: '关联' }));

    expect(screen.getByText(/任务一 · 项目甲/)).toBeInTheDocument();
    expect(screen.getByText(/任务二 · 项目甲/)).toBeInTheDocument();
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it('loads existing links and persists add/remove immediately when editing', async () => {
    const first = task('t1', '任务一');
    const second = task('t2', '任务二');
    mocks.tasks = [first, second];
    mocks.linked = [first];
    mocks.link.mockClear();
    mocks.unlink.mockClear();
    const user = userEvent.setup();
    render(<Harness meetingId="m1" />);

    expect(await screen.findByRole('link', { name: /任务一/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '关联' }));
    await waitFor(() => {
      expect(mocks.link).toHaveBeenCalledWith('t2', 'm1');
    });
    await user.click(screen.getByRole('button', { name: '移除关联任务 任务一' }));
    await waitFor(() => {
      expect(mocks.unlink).toHaveBeenCalledWith('t1', 'm1');
    });
  });
});
