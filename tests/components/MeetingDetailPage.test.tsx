import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeetingDetailPage } from '@/features/meetings/pages/MeetingDetailPage';
import type { BatchStatement } from '@/lib/commands';
import { setDbForTesting } from '@/lib/db';
import { getRepositories } from '@/repositories';
import { useMeetingStore } from '@/stores/useMeetingStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { makeActionItem, makeMeeting, makeProject } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb | null = null;

// The conversion is a batch write, so the Rust command is routed to the same
// in-memory database the repositories read from — one transaction, all-or-nothing.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: { statements?: BatchStatement[] }) => {
    if (command !== 'execute_batch') {
      return Promise.reject(new Error(`unexpected command: ${command}`));
    }
    if (db === null || args?.statements === undefined) {
      return Promise.reject(new Error('test database not installed'));
    }
    return Promise.resolve(db.runBatch(args.statements));
  },
}));

function renderPage(meetingId = 'm1') {
  render(
    <MemoryRouter initialEntries={[`/meetings/${meetingId}`]}>
      <Routes>
        <Route path="/meetings" element={<h1>会议列表</h1>} />
        <Route path="/meetings/:meetingId" element={<MeetingDetailPage />} />
      </Routes>
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

async function seedMeeting(): Promise<void> {
  const repos = await getRepositories();
  await repos.projects.insert(makeProject({ id: 'p1', name: '内网门户重构' }));
  await repos.meetings.insert(
    makeMeeting({
      id: 'm1',
      project_id: 'p1',
      topic: '需求澄清',
      start_time: '09:30',
      attendees: '["张三","李四"]',
      decisions: '先做只读日历',
    }),
  );
}

describe('MeetingDetailPage', () => {
  it('shows the loading state while the meeting is being read', async () => {
    setDbForTesting({
      select: () => new Promise(() => undefined),
      execute: () => new Promise(() => undefined),
    });

    renderPage();

    expect(await screen.findByText('正在加载会议…')).toBeInTheDocument();
  });

  it('shows a not-found state with a way back when the meeting does not exist', async () => {
    useRealDb();

    renderPage('missing');

    expect(await screen.findByText('无法打开会议')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回会议列表' })).toBeInTheDocument();
  });

  it('renders the meeting, its attendees and its notes', async () => {
    useRealDb();
    await seedMeeting();

    renderPage();

    expect(await screen.findByRole('heading', { name: '需求澄清' })).toBeInTheDocument();
    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.getByText('李四')).toBeInTheDocument();
    expect(screen.getByText('先做只读日历')).toBeInTheDocument();
    expect(screen.getByText('09:30')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '行动项（0）' })).toBeInTheDocument();
  });

  it('converts an action item into exactly one task and then links to it', async () => {
    const user = userEvent.setup();
    useRealDb();
    await seedMeeting();
    const repos = await getRepositories();
    await repos.actionItems.insert(
      makeActionItem({ id: 'a1', meeting_id: 'm1', content: '补充接口文档', owner: '张三' }),
    );

    renderPage();
    await screen.findByText('补充接口文档');

    await user.click(screen.getByRole('button', { name: '转为任务' }));

    expect(await screen.findByRole('link', { name: '查看任务' })).toBeInTheDocument();

    const tasks = await repos.tasks.findByProject('p1');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe('补充接口文档');
    expect(tasks[0]?.description).toBe('负责人：张三\n补充接口文档');
    expect(tasks[0]?.source_meeting_id).toBe('m1');

    const items = await repos.actionItems.findByMeeting('m1');
    expect(items[0]?.converted_task_id).toBe(tasks[0]?.id);
  });

  it('refuses a second conversion of the same action item', async () => {
    const user = userEvent.setup();
    useRealDb();
    await seedMeeting();
    const repos = await getRepositories();
    await repos.actionItems.insert(
      makeActionItem({
        id: 'a1',
        meeting_id: 'm1',
        content: '补充接口文档',
        converted_task_id: null,
        converted_at: '2026-07-14T01:00:00Z',
      }),
    );

    renderPage();
    await screen.findByText('补充接口文档');

    expect(screen.queryByRole('button', { name: '转为任务' })).toBeNull();
    expect(await repos.tasks.findByProject('p1')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: '编辑行动项：补充接口文档' }));
    expect(await screen.findByRole('heading', { name: '编辑行动项' })).toBeInTheDocument();
  });

  it('deleting the meeting confirms with the real action item count and returns to the list', async () => {
    const user = userEvent.setup();
    useRealDb();
    await seedMeeting();
    const repos = await getRepositories();
    await repos.actionItems.insert(makeActionItem({ id: 'a1', meeting_id: 'm1' }));
    await repos.actionItems.insert(makeActionItem({ id: 'a2', meeting_id: 'm1' }));

    renderPage();
    await screen.findByRole('heading', { name: '需求澄清' });

    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(
      await screen.findByText(
        '确定删除会议「需求澄清」吗？该会议的 2 个行动项会一并删除，已转换出的任务会保留。此操作不可撤销。',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(await screen.findByRole('heading', { name: '会议列表' })).toBeInTheDocument();
    await waitFor(async () => {
      expect(await repos.meetings.findById('m1')).toBeNull();
    });
  });
});
