import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MeetingsPage } from '@/features/meetings/pages/MeetingsPage';
import { setDbForTesting, type SqlExecutor } from '@/lib/db';
import { getRepositories } from '@/repositories';
import { useMeetingStore } from '@/stores/useMeetingStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { makeActionItem, makeMeeting, makeProject } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

/**
 * The list page runs against a real in-memory SQLite through the actual
 * store → service → repository stack, so "cancel writes nothing" is proved by
 * reading the database back rather than by trusting a spy.
 */

let db: TestDb | null = null;

function renderPage() {
  render(
    <MemoryRouter>
      <MeetingsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useMeetingStore.getState().reset();
  useProjectStore.setState({ options: [] });
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

describe('MeetingsPage', () => {
  it('shows the loading state while the first read is in flight', async () => {
    setDbForTesting({
      select: () => new Promise(() => undefined),
      execute: () => new Promise(() => undefined),
    });

    renderPage();

    expect(await screen.findByText('正在加载会议…')).toBeInTheDocument();
  });

  it('shows the empty state when no meeting has been recorded', async () => {
    useRealDb();

    renderPage();

    expect(await screen.findByText('还没有会议记录')).toBeInTheDocument();
    expect(screen.getByText('新建会议后可以记录议程、纪要、决议与行动项。')).toBeInTheDocument();
  });

  it('shows the database error state with a retry affordance', async () => {
    // Only the meeting read fails, so the page's own error path is what is asserted.
    const failing: SqlExecutor = {
      select: <T,>(query: string): Promise<T> =>
        query.toLowerCase().includes('from meetings')
          ? Promise.reject(new Error('database disk image is malformed'))
          : Promise.resolve([] as unknown as T),
      execute: () => Promise.resolve({ rowsAffected: 0 }),
    };
    setDbForTesting(failing);

    renderPage();

    expect(await screen.findByText('无法加载会议')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('lists meetings with their project and marks standalone ones', async () => {
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1', name: '内网门户重构' }));
    await repos.meetings.insert(
      makeMeeting({ id: 'm1', project_id: 'p1', topic: '需求澄清', start_time: '09:30' }),
    );
    await repos.meetings.insert(
      makeMeeting({ id: 'm2', project_id: null, topic: '一对一', date: '2026-07-16' }),
    );

    renderPage();

    expect(await screen.findByRole('link', { name: '需求澄清' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '一对一' })).toBeInTheDocument();
    expect(screen.getByText('内网门户重构')).toBeInTheDocument();
    expect(screen.getByText('独立会议')).toBeInTheDocument();
    expect(screen.getByText('09:30')).toBeInTheDocument();
  });

  /**
   * The whole create path — form → store → service → repository → SQLite — with
   * an empty meetings table, which is exactly the state the Windows machine was
   * left in: the save threw a ZodError at ["attendees"] (the form had already
   * normalized the free text into a list), nothing was written, and the page
   * turned into 「无法加载会议」 because the list was still empty.
   */
  it('creates a meeting from the dialog instead of failing with a validation error', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();

    renderPage();
    await screen.findByText('还没有会议记录');

    // Both the header and the empty state offer the button; either opens the dialog.
    await user.click(screen.getAllByRole('button', { name: '新建会议' })[0] as HTMLElement);
    await user.type(screen.getByLabelText('会议主题'), '双周评审');
    fireEvent.change(screen.getByLabelText('会议日期'), { target: { value: '2026-07-20' } });
    await user.type(screen.getByLabelText('参与者'), '张三\n李四，王五');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('link', { name: '双周评审' })).toBeInTheDocument();
    expect(screen.queryByText('无法加载会议')).toBeNull();

    const stored = await repos.meetings.findAll();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.attendees).toBe('["张三","李四","王五"]');
    expect(stored[0]?.project_id).toBeNull();
  });

  it('shows the real action item count before deleting and cancels without writing', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1', name: '内网门户重构' }));
    await repos.meetings.insert(makeMeeting({ id: 'm1', project_id: 'p1', topic: '需求澄清' }));
    await repos.actionItems.insert(makeActionItem({ id: 'a1', meeting_id: 'm1' }));
    await repos.actionItems.insert(makeActionItem({ id: 'a2', meeting_id: 'm1' }));

    renderPage();
    await screen.findByRole('link', { name: '需求澄清' });

    await user.click(screen.getByRole('button', { name: '删除会议：需求澄清' }));

    expect(
      await screen.findByText(
        '确定删除会议「需求澄清」吗？该会议的 2 个行动项会一并删除，已转换出的任务会保留。此操作不可撤销。',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(await repos.meetings.findById('m1')).not.toBeNull();
    expect(await repos.actionItems.findByMeeting('m1')).toHaveLength(2);
  });

  it('confirming the delete removes the meeting and cascades its action items', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1', name: '内网门户重构' }));
    await repos.meetings.insert(makeMeeting({ id: 'm1', project_id: 'p1', topic: '需求澄清' }));
    await repos.actionItems.insert(makeActionItem({ id: 'a1', meeting_id: 'm1' }));

    renderPage();
    await screen.findByRole('link', { name: '需求澄清' });

    await user.click(screen.getByRole('button', { name: '删除会议：需求澄清' }));
    await user.click(await screen.findByRole('button', { name: '删除' }));

    await waitFor(async () => {
      expect(await repos.meetings.findById('m1')).toBeNull();
    });
    expect(await repos.actionItems.findByMeeting('m1')).toHaveLength(0);
  });
});
