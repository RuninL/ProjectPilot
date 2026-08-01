import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchStatement } from '@/lib/commands';
import { MeetingsPage } from '@/features/meetings/pages/MeetingsPage';
import { setDbForTesting, type SqlExecutor } from '@/lib/db';
import { getRepositories } from '@/repositories';
import { useMeetingStore } from '@/stores/useMeetingStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useRecurrenceStore } from '@/stores/useRecurrenceStore';
import { makeActionItem, makeMeeting, makeProject } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';
import type { RecurrenceRule } from '@/types';

/**
 * The list page runs against a real in-memory SQLite through the actual
 * store → service → repository stack, so "cancel writes nothing" is proved by
 * reading the database back rather than by trusting a spy.
 */

let db: TestDb | null = null;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: { statements?: BatchStatement[] }) => {
    if (command !== 'execute_batch' || db === null || args?.statements === undefined) {
      return Promise.reject(new Error(`unexpected command: ${command}`));
    }
    return Promise.resolve(db.runBatch(args.statements));
  },
}));

function renderPage() {
  render(
    <MemoryRouter>
      <MeetingsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useMeetingStore.getState().reset();
  useRecurrenceStore.getState().reset();
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
  it('drags only from the handle, moves across multiple rows, and saves the occurrence order', async () => {
    const user = userEvent.setup();
    const current = useRealDb();
    const repos = await getRepositories();
    for (const [id, topic, date] of [
      ['m1', '第一场', '2099-07-14'],
      ['m2', '第二场', '2099-07-15'],
      ['m3', '第三场', '2099-07-16'],
    ] as const) {
      await repos.meetings.insert(makeMeeting({ id, project_id: null, topic, date }));
    }

    renderPage();
    await screen.findByRole('link', { name: '第一场' });
    await user.click(screen.getByRole('button', { name: '全部' }));
    await user.selectOptions(screen.getByLabelText('自定义排序'), 'custom');

    const handle = screen.getByLabelText('拖动排序 第一场');
    const target = screen.getByRole('link', { name: '第三场' }).closest('li');
    if (target === null) throw new Error('第三场会议行应存在');
    // Rows never start a drag themselves; only the handle is armed.
    expect(screen.getByRole('link', { name: '第一场' }).closest('li')).not.toHaveAttribute(
      'data-drag-handle',
    );

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 5, clientY: 120 });
    expect(target).toHaveClass('ring-primary');
    fireEvent.pointerUp(target, { pointerId: 1, clientX: 5, clientY: 120 });

    expect(
      screen
        .getAllByRole('link')
        .map((link) => link.textContent)
        .filter((text) => text !== '打开'),
    ).toEqual(['第二场', '第三场', '第一场']);

    await user.click(screen.getByRole('button', { name: '保存当前排序' }));
    await user.type(screen.getByLabelText('排序名称'), '会议排序2');
    await user.click(screen.getByRole('button', { name: '保存' }));
    // One named config stores all five sub-orders; the drag happened in the
    // standalone "all" range, so only that section carries the new sequence.
    await waitFor(() => {
      const payload = current.raw
        .prepare(
          `SELECT ordered_ids_json FROM named_list_orders
             WHERE context = 'meetings' AND name = '会议排序2'`,
        )
        .pluck()
        .get();
      expect(typeof payload).toBe('string');
      const parsed = JSON.parse(payload as string) as {
        v: number;
        sections: Record<string, string[]>;
      };
      expect(parsed.v).toBe(2);
      expect(parsed.sections['standalone.all']).toEqual(['meeting:m2', 'meeting:m3', 'meeting:m1']);
      expect(parsed.sections['recurringSeries']).toEqual([]);
    });
  });

  it('reorders recurring series by dragging R3 before R1, isolated from standalone meetings', async () => {
    const user = userEvent.setup();
    const current = useRealDb();
    const repos = await getRepositories();
    const base: Omit<RecurrenceRule, 'id' | 'title'> = {
      project_id: null,
      kind: 'meeting',
      byweekday: 0,
      interval: 1,
      start_date: '2099-01-04',
      end_date: '2099-03-01',
      time_of_day: '10:00',
      duration_minutes: null,
      default_priority: null,
      note: '',
      meeting_url: null,
      is_active: 1,
      is_sample: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    await repos.recurrence.insert({ ...base, id: 'r1', title: '系列一' });
    await repos.recurrence.insert({ ...base, id: 'r2', title: '系列二' });
    await repos.recurrence.insert({ ...base, id: 'r3', title: '系列三' });
    await repos.meetings.insert(
      makeMeeting({ id: 'm1', project_id: null, topic: '独立会', date: '2099-02-01' }),
    );

    renderPage();
    await screen.findByText(/系列一 \[周期会议\]/);
    await user.selectOptions(screen.getByLabelText('自定义排序'), 'custom');

    const seriesTitles = () => screen.getAllByText(/\[周期会议\]$/).map((node) => node.textContent);
    // Whatever the dynamic order is, drag the last series directly before the first.
    const initial = seriesTitles();
    expect(initial).toHaveLength(3);
    const firstTitle = (initial[0] ?? '').replace(' [周期会议]', '');
    const lastTitle = (initial[2] ?? '').replace(' [周期会议]', '');

    const handle = screen.getByLabelText(`拖动排序 ${lastTitle}`);
    const target = screen.getByText(`${firstTitle} [周期会议]`).closest('li');
    if (target === null) throw new Error('第一个系列行应存在');
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 0, clientY: 80 });
    expect(target).toHaveClass('ring-primary');
    fireEvent.pointerUp(target, { pointerId: 1, clientX: 0, clientY: 80 });

    const reordered = [initial[2], initial[0], initial[1]];
    expect(seriesTitles()).toEqual(reordered);

    // Dragging a series over a standalone meeting row commits nothing there.
    const standalone = screen.getByRole('link', { name: '独立会' }).closest('li');
    if (standalone === null) throw new Error('独立会议行应存在');
    const handle2 = screen.getByLabelText(`拖动排序 ${firstTitle}`);
    fireEvent.pointerDown(handle2, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(standalone, { pointerId: 1, clientX: 0, clientY: 200 });
    expect(standalone).not.toHaveClass('ring-primary');
    fireEvent.pointerUp(standalone, { pointerId: 1, clientX: 0, clientY: 200 });
    expect(seriesTitles()).toEqual(reordered);

    // One named config stores the series sub-order alongside the standalone ones.
    const idByTitle: Record<string, string> = { 系列一: 'r1', 系列二: 'r2', 系列三: 'r3' };
    const expectedIds = reordered.map((text) => idByTitle[(text ?? '').replace(' [周期会议]', '')]);
    await user.click(screen.getByRole('button', { name: '保存当前排序' }));
    await user.type(screen.getByLabelText('排序名称'), '系列排序');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      const payload = current.raw
        .prepare(
          `SELECT ordered_ids_json FROM named_list_orders
             WHERE context = 'meetings' AND name = '系列排序'`,
        )
        .pluck()
        .get();
      const parsed = JSON.parse(payload as string) as { sections: Record<string, string[]> };
      expect(parsed.sections['recurringSeries']).toEqual(expectedIds);
    });
  });

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
      makeMeeting({
        id: 'm1',
        project_id: 'p1',
        topic: '需求澄清',
        date: '2099-07-14',
        start_time: '09:30',
      }),
    );
    await repos.meetings.insert(
      makeMeeting({ id: 'm2', project_id: null, topic: '一对一', date: '2099-07-16' }),
    );

    renderPage();

    expect(await screen.findByRole('link', { name: '需求澄清' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '一对一' })).toBeInTheDocument();
    expect(screen.getAllByText('内网门户重构')).not.toHaveLength(0);
    expect(screen.getAllByText('独立会议')).not.toHaveLength(0);
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

    await user.click(screen.getByRole('button', { name: '全部' }));
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
    await repos.meetings.insert(
      makeMeeting({ id: 'm1', project_id: 'p1', topic: '需求澄清', date: '2099-07-14' }),
    );
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
    await repos.meetings.insert(
      makeMeeting({ id: 'm1', project_id: 'p1', topic: '需求澄清', date: '2099-07-14' }),
    );
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

  it('creates, edits and deletes standalone and project recurring meeting rules', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1', name: '内网门户重构' }));

    renderPage();
    await screen.findByText('还没有会议记录');
    await user.click(screen.getByRole('button', { name: '创建会议' }));
    await user.click(screen.getByRole('button', { name: '周期会议' }));
    await user.type(screen.getByLabelText('会议主题'), '项目周会');
    await user.selectOptions(screen.getByLabelText('所属项目'), 'p1');
    await user.selectOptions(screen.getByLabelText('每周星期'), '2');
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-12-31' } });
    await user.click(screen.getByRole('button', { name: '保存规则' }));

    expect(await screen.findByText(/每周三，至 2026-12-31/)).toBeInTheDocument();
    const first = (await repos.recurrence.findAll())[0];
    expect(first).toMatchObject({ kind: 'meeting', project_id: 'p1', title: '项目周会' });
    if (first === undefined) throw new Error('周期规则应已创建');

    await user.click(screen.getByRole('button', { name: '修改整个系列' }));
    expect(screen.getByLabelText('会议主题')).toHaveValue('项目周会');
    await user.clear(screen.getByLabelText('会议主题'));
    await user.type(screen.getByLabelText('会议主题'), '项目例会');
    await user.click(screen.getByRole('button', { name: '保存规则' }));
    expect(
      await screen.findByText(
        '确定修改整个周期会议「项目周会」吗？新规则会立即重新展开；为避免旧日期被错误套用，历史单次调整将被清除。',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '修改整个系列' }));
    expect(await screen.findByText(/项目例会 \[周期会议\]/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删除整个系列' }));
    expect(await screen.findByText(/删除整个周期会议/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '删除整个系列' }));
    await waitFor(async () => {
      expect(await repos.recurrence.findById(first.id)).toBeNull();
    });

    await user.click(screen.getByRole('button', { name: '创建会议' }));
    await user.click(screen.getByRole('button', { name: '周期会议' }));
    await user.type(screen.getByLabelText('会议主题'), '独立同步会');
    await user.selectOptions(screen.getByLabelText('每周星期'), '0');
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-07-06' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-12-31' } });
    await user.click(screen.getByRole('button', { name: '保存规则' }));
    expect(await screen.findByText(/独立同步会 \[周期会议\]/)).toBeInTheDocument();
    expect((await repos.recurrence.findAll())[0]?.project_id).toBeNull();
  });

  it('keeps recurring series out of the standalone list and shows each series once', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    const rule: RecurrenceRule = {
      id: 'r1',
      project_id: null,
      kind: 'meeting',
      title: '每周例会',
      byweekday: 0,
      interval: 1,
      start_date: '2099-01-04',
      end_date: '2099-03-01',
      time_of_day: '10:00',
      duration_minutes: null,
      default_priority: null,
      note: '',
      meeting_url: null,
      is_active: 1,
      is_sample: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    await repos.recurrence.insert(rule);
    await repos.meetings.insert(
      makeMeeting({ id: 'm1', project_id: null, topic: '独立评审会', date: '2099-02-01' }),
    );

    renderPage();
    await screen.findByRole('link', { name: '独立评审会' });
    await user.click(screen.getByRole('button', { name: '全部' }));

    // The series appears exactly once, in the recurring area only.
    expect(screen.getAllByText(/每周例会 \[周期会议\]/)).toHaveLength(1);
    // No expanded occurrence rows leak into the standalone list.
    const standaloneLinks = screen
      .getAllByRole('link')
      .map((link) => link.textContent)
      .filter((text) => text !== '打开');
    expect(standaloneLinks).toEqual(['独立评审会']);
    expect(screen.queryByText('周期会议', { selector: 'span' })).toBeNull();
  });
});
