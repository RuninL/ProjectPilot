import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MeetingSection } from '@/features/meetings/components/MeetingSection';
import { setDbForTesting, type SqlExecutor } from '@/lib/db';
import { getRepositories } from '@/repositories';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { useMeetingStore } from '@/stores/useMeetingStore';
import { useRecurrenceStore } from '@/stores/useRecurrenceStore';
import { makeProject } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb | null = null;

beforeEach(() => {
  useMeetingStore.getState().reset();
  useRecurrenceStore.getState().reset();
  useCalendarStore.getState().reset();
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

describe('MeetingSection', () => {
  it('creates project-bound normal and recurring meetings from the same entry point', async () => {
    const user = userEvent.setup();
    useRealDb();
    const project = makeProject({ id: 'p1', name: '内网门户重构' });
    const repos = await getRepositories();
    await repos.projects.insert(project);

    render(
      <MemoryRouter>
        <MeetingSection project={project} />
      </MemoryRouter>,
    );

    await screen.findByText('该项目暂无会议记录。新建会议后可以记录纪要、决议与行动项。');
    await user.click(screen.getByRole('button', { name: '新建会议' }));
    await user.click(screen.getByRole('button', { name: '普通会议' }));
    await user.type(screen.getByLabelText('会议主题'), '项目评审');
    fireEvent.change(screen.getByLabelText('会议日期'), { target: { value: '2026-07-20' } });
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(async () => {
      expect((await repos.meetings.findAll())[0]).toMatchObject({
        project_id: 'p1',
        topic: '项目评审',
      });
    });

    await user.click(screen.getByRole('button', { name: '新建会议' }));
    await user.click(screen.getByRole('button', { name: '周期会议' }));
    await user.type(screen.getByLabelText('会议主题'), '项目周会');
    await user.selectOptions(screen.getByLabelText('每周星期'), '2');
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-12-31' } });
    await user.click(screen.getByRole('button', { name: '保存规则' }));

    await waitFor(async () => {
      expect((await repos.recurrence.findAll())[0]).toMatchObject({
        project_id: 'p1',
        kind: 'meeting',
        title: '项目周会',
      });
    });
  });

  it('shows an error when the project meeting query fails', async () => {
    const project = makeProject({ id: 'p1' });
    const failing: SqlExecutor = {
      select: () => Promise.reject(new Error('database disk image is malformed')),
      execute: () => Promise.resolve({ rowsAffected: 0 }),
    };
    setDbForTesting(failing);

    render(
      <MemoryRouter>
        <MeetingSection project={project} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('无法加载会议')).toBeInTheDocument();
  });
});
