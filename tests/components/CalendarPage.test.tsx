import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarPage } from '@/features/calendar/pages/CalendarPage';
import { monthOf } from '@/features/calendar/calendarModel';
import { formatMonthLabel, todayHK } from '@/lib/date';
import { setDbForTesting, type SqlExecutor } from '@/lib/db';
import type { BatchStatement } from '@/lib/commands';
import { getRepositories } from '@/repositories';
import { getRecurrenceService } from '@/services/recurrence.service';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { makeMeeting, makeMilestone, makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb | null = null;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: { statements?: BatchStatement[] }) => {
    if (command !== 'execute_batch' || db === null || args?.statements === undefined) {
      return Promise.reject(new Error(`unexpected command: ${command}`));
    }
    return Promise.resolve(db.runBatch(args.statements));
  },
}));

function renderPage(month?: string) {
  if (month !== undefined) {
    useCalendarStore.setState({ month });
  }
  render(
    <MemoryRouter>
      <CalendarPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
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

describe('CalendarPage', () => {
  it('shows the loading state while the month is being read', async () => {
    setDbForTesting({
      select: () => new Promise(() => undefined),
      execute: () => new Promise(() => undefined),
    });

    renderPage('2026-07');

    expect(await screen.findByText('正在加载日历…')).toBeInTheDocument();
  });

  it('shows the database error state with a retry affordance', async () => {
    const failing: SqlExecutor = {
      select: () => Promise.reject(new Error('database disk image is malformed')),
      execute: () => Promise.resolve({ rowsAffected: 0 }),
    };
    setDbForTesting(failing);

    renderPage('2026-07');

    expect(await screen.findByText('无法加载日历')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('shows the empty state for a month without any entry', async () => {
    useRealDb();

    renderPage('2026-07');

    expect(await screen.findByText('本月暂无任务、会议或里程碑。')).toBeInTheDocument();
    expect(screen.getByText('2026年7月')).toBeInTheDocument();
  });

  it('distinguishes tasks, meetings and milestones on the same day by text, not colour', async () => {
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1', name: '内网门户重构' }));
    await repos.tasks.insert(
      makeTask({ id: 't1', project_id: 'p1', title: '接口联调', due_date: '2026-07-20' }),
    );
    await repos.meetings.insert(
      makeMeeting({ id: 'm1', project_id: 'p1', topic: '需求澄清', date: '2026-07-20' }),
    );
    await repos.milestones.insert(
      makeMilestone({ id: 'ms1', project_id: 'p1', name: '内测上线', date: '2026-07-20' }),
    );

    renderPage('2026-07');

    expect(await screen.findByRole('link', { name: /需求澄清/ })).toHaveAttribute(
      'href',
      '/meetings/m1',
    );
    expect(screen.getByRole('link', { name: /内测上线/ })).toHaveAttribute(
      'href',
      '/projects/p1#project-milestones',
    );
    expect(screen.getByRole('link', { name: /接口联调/ })).toHaveAttribute(
      'href',
      '/tasks?taskId=t1',
    );
    expect(screen.getByText('[会议]')).toBeInTheDocument();
    expect(screen.getByText('[里程碑]')).toBeInTheDocument();
    expect(screen.getByText('[任务截止]')).toBeInTheDocument();
  });

  it('collapses a busy day into a count and expands it on demand', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1', name: '内网门户重构' }));
    for (const index of [1, 2, 3, 4]) {
      await repos.meetings.insert(
        makeMeeting({
          id: `m${String(index)}`,
          project_id: 'p1',
          topic: `会议${String(index)}`,
          date: '2026-07-20',
        }),
      );
    }

    renderPage('2026-07');

    const more = await screen.findByRole('button', { name: '还有 1 项' });
    expect(screen.queryByRole('link', { name: /会议4/ })).toBeNull();

    await user.click(more);

    expect(await screen.findByRole('link', { name: /会议4/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '收起' }));

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /会议4/ })).toBeNull();
    });
  });

  it('keeps the month grid free from span bars', async () => {
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1', name: '内网门户重构' }));
    for (const index of [1, 2, 3, 4]) {
      await repos.meetings.insert(
        makeMeeting({
          id: `bar${String(index)}`,
          project_id: 'p1',
          topic: `色条会议${String(index)}`,
          date: '2026-07-20',
        }),
      );
    }

    renderPage('2026-07');

    await screen.findByRole('link', { name: /色条会议1/ });
    expect(screen.queryByLabelText('日历色条图例')).toBeNull();
    expect(screen.queryByText('+1 个色条')).toBeNull();
  });

  it('steps forward across the year boundary', async () => {
    const user = userEvent.setup();
    useRealDb();

    renderPage('2026-12');
    expect(await screen.findByText('2026年12月')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '下一月' }));

    expect(await screen.findByText('2027年1月')).toBeInTheDocument();
  });

  it('steps backward across the year boundary', async () => {
    const user = userEvent.setup();
    useRealDb();

    renderPage('2026-01');
    expect(await screen.findByText('2026年1月')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '上一月' }));

    expect(await screen.findByText('2025年12月')).toBeInTheDocument();
  });

  it('marks today only while the current month is on screen', async () => {
    const user = userEvent.setup();
    useRealDb();

    renderPage(monthOf(todayHK()));
    // The 今天 button plus the marker on today's cell.
    await waitFor(() => {
      expect(screen.getAllByText('今天')).toHaveLength(2);
    });

    // Two steps back, because a single step's six-week grid can still overlap today.
    await user.click(screen.getByRole('button', { name: '上一月' }));
    await user.click(screen.getByRole('button', { name: '上一月' }));

    await waitFor(() => {
      expect(screen.getAllByText('今天')).toHaveLength(1);
    });
  });

  it('does not offer drag-and-drop scheduling in the month view', async () => {
    useRealDb();

    renderPage('2026-07');

    expect(
      await screen.findByText('显示任务、会议与里程碑，不能拖动排期；周期会议可按次调整。'),
    ).toBeInTheDocument();
  });

  it('opens the daily task dialog from a date-cell context menu and never renders daily task buttons', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1' }));
    await repos.tasks.insert(
      makeTask({ id: 'today-task', project_id: 'p1', title: '当日跟进', due_date: '2026-07-20' }),
    );

    renderPage('2026-07');
    const day = await screen.findByRole('gridcell', { name: '2026-07-20 的日期菜单' });
    expect(screen.queryByRole('button', { name: '查看当日任务' })).toBeNull();

    fireEvent.contextMenu(day, { clientX: 30, clientY: 40 });
    await user.click(await screen.findByRole('menuitem', { name: '查看当日任务' }));

    expect(await screen.findByRole('dialog', { name: '当日任务' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '当日跟进' })).toBeInTheDocument();
  });

  it('opens and closes a date menu with keyboard and ignores event context clicks', async () => {
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1' }));
    await repos.meetings.insert(
      makeMeeting({ id: 'm1', project_id: 'p1', topic: '日期会议', date: '2026-07-20' }),
    );

    renderPage('2026-07');
    const day = await screen.findByRole('gridcell', { name: '2026-07-20 的日期菜单' });
    fireEvent.keyDown(day, { key: 'F10', shiftKey: true });
    expect(await screen.findByRole('menuitem', { name: '查看当日任务' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: '查看当日任务' })).toBeNull();
    });

    fireEvent.contextMenu(screen.getByRole('link', { name: /日期会议/ }), {
      clientX: 30,
      clientY: 40,
    });
    expect(screen.queryByRole('menuitem', { name: '查看当日任务' })).toBeNull();
  });

  it('changes or removes only the selected recurring meeting occurrence', async () => {
    const user = userEvent.setup();
    useRealDb();
    const service = await getRecurrenceService();
    const rule = await service.createRule({
      project_id: null,
      kind: 'meeting',
      title: '周会',
      byweekday: 2,
      interval: 1,
      start_date: '2026-07-01',
      end_date: '2026-07-31',
      time_of_day: null,
      duration_minutes: null,
      default_priority: null,
      note: '',
      is_active: 1,
    });

    renderPage('2026-07');
    await user.click((await screen.findAllByRole('button', { name: /周会/ }))[0] as HTMLElement);
    expect(await screen.findByText('周期会议操作')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('仅修改本次的新日期'), {
      target: { value: '2026-07-02' },
    });
    await user.click(screen.getByRole('button', { name: '仅修改本次' }));

    await waitFor(async () => {
      expect(await service.listExceptions(rule.id)).toMatchObject([
        { occurrence_date: '2026-07-01', action: 'rescheduled', replacement_date: '2026-07-02' },
      ]);
    });
    expect(
      await getRepositories().then(async (repos) =>
        (await repos.meetings.findAll()).filter(
          (meeting) => meeting.source_occurrence_date !== null,
        ),
      ),
    ).toHaveLength(0);
  });

  it('switches from the default month grid to the compact colour-bar month calendar', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1', name: '内网门户重构' }));
    await repos.tasks.insert(
      makeTask({
        id: 'span',
        project_id: 'p1',
        title: '连续排期任务',
        start_date: '2026-07-03',
        due_date: '2026-07-08',
        status: 'blocked',
      }),
    );

    renderPage('2026-07');

    expect(
      await screen.findByRole('tab', { name: '常规视图', selected: true }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '颜色条视图' }));

    expect(await screen.findByRole('region', { name: '颜色条视图' })).toBeInTheDocument();
    // The cross-week task renders as two segments that share one identity and target.
    const segments = screen.getAllByRole('link', {
      name: /任务：连续排期任务；内网门户重构；2026-07-03 至 2026-07-08；状态：受阻/,
    });
    expect(segments).toHaveLength(2);
    for (const segment of segments) {
      expect(segment).toHaveAttribute('href', '/tasks?taskId=span');
    }
    expect(screen.getByLabelText('颜色条月历')).toHaveClass('overflow-x-auto');
    expect(screen.getByLabelText('颜色条图例')).toHaveTextContent('任务：连续时间条');
    // Status is carried by text on the bar itself, never colour alone.
    expect(screen.getAllByText('[受阻]').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('tab', { name: '常规视图' }));
    expect(
      await screen.findByRole('gridcell', { name: '2026-07-03 的日期菜单' }),
    ).toBeInTheDocument();
  });

  it('shows a seven-column weekday header and plain day numbers in the colour-bar view', async () => {
    const user = userEvent.setup();
    useRealDb();

    renderPage('2026-07');
    await user.click(await screen.findByRole('tab', { name: '颜色条视图' }));

    const calendar = await screen.findByLabelText('颜色条月历');
    for (const label of ['周一', '周二', '周三', '周四', '周五', '周六', '周日']) {
      expect(within(calendar).getAllByText(label).length).toBeGreaterThan(0);
    }
    // Day cells carry a bare day number; the month appears only in the toolbar.
    expect(within(calendar).getByLabelText('2026-07-01')).toHaveTextContent('1');
    expect(within(calendar).queryByText('01' + '07')).toBeNull();
    // Adjacent-month days remain rendered but visually muted.
    expect(within(calendar).getByLabelText('2026-06-29')).toHaveClass('text-muted-foreground');
    // No separate oversized single-day-event canvas exists any more.
    expect(screen.queryByText('单日事件')).toBeNull();
  });

  it('packs meetings and milestones into the week rows of the colour-bar view', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1', name: '内网门户重构' }));
    await repos.meetings.insert(
      makeMeeting({ id: 'm1', project_id: 'p1', topic: '架构评审', date: '2026-07-07' }),
    );
    await repos.milestones.insert(
      makeMilestone({ id: 'ms1', project_id: 'p1', name: '一期验收', date: '2026-07-08' }),
    );

    renderPage('2026-07');
    await user.click(await screen.findByRole('tab', { name: '颜色条视图' }));

    const calendar = await screen.findByLabelText('颜色条月历');
    expect(within(calendar).getByRole('link', { name: /会议：架构评审/ })).toHaveAttribute(
      'href',
      '/meetings/m1',
    );
    expect(within(calendar).getByRole('link', { name: /里程碑：一期验收/ })).toHaveAttribute(
      'href',
      '/projects/p1#project-milestones',
    );
  });

  it('keeps recurring occurrences actionable inside the colour-bar month grid', async () => {
    const user = userEvent.setup();
    useRealDb();
    const service = await getRecurrenceService();
    await service.createRule({
      project_id: null,
      kind: 'meeting',
      title: '色条周会',
      byweekday: 2,
      interval: 1,
      start_date: '2026-07-01',
      end_date: '2026-07-31',
      time_of_day: null,
      duration_minutes: null,
      default_priority: null,
      note: '',
      is_active: 1,
    });

    renderPage('2026-07');
    await user.click(await screen.findByRole('tab', { name: '颜色条视图' }));

    const calendar = await screen.findByLabelText('颜色条月历');
    const occurrence = within(calendar).getAllByRole('button', {
      name: /周期会议：色条周会.*打开周期会议操作/,
    })[0] as HTMLElement;
    await user.click(occurrence);
    expect(await screen.findByText('周期会议操作')).toBeInTheDocument();
  });

  it('returns to the current month with a single 今天 click from another month', async () => {
    const user = userEvent.setup();
    useRealDb();
    const currentLabel = formatMonthLabel(`${monthOf(todayHK())}-01`);

    renderPage('2025-03');
    expect(await screen.findByText('2025年3月')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '今天' }));

    expect(await screen.findByText(currentLabel)).toBeInTheDocument();
    expect(useCalendarStore.getState().month).toBe(monthOf(todayHK()));
    expect(useCalendarStore.getState().data?.month).toBe(monthOf(todayHK()));
  });

  it('keeps 今天 working in the colour-bar view, after switching views, and on repeat clicks', async () => {
    const user = userEvent.setup();
    useRealDb();
    const currentMonth = monthOf(todayHK());
    const currentLabel = formatMonthLabel(`${currentMonth}-01`);

    renderPage('2026-07');
    await user.click(await screen.findByRole('tab', { name: '颜色条视图' }));
    await screen.findByLabelText('颜色条月历');

    await user.click(screen.getByRole('button', { name: '今天' }));
    expect(await screen.findByText(currentLabel)).toBeInTheDocument();

    const calendar = screen.getByLabelText('颜色条月历');
    expect(within(calendar).getByLabelText(`${todayHK()}，今天`)).toBeInTheDocument();

    // A second click must not break anything.
    await user.click(screen.getByRole('button', { name: '今天' }));
    expect(await screen.findByText(currentLabel)).toBeInTheDocument();

    // Switching back keeps the shared month state.
    await user.click(screen.getByRole('tab', { name: '常规视图' }));
    expect(await screen.findByText(currentLabel)).toBeInTheDocument();
    expect(useCalendarStore.getState().month).toBe(currentMonth);
  });

  it('shares the month between both views when navigating months', async () => {
    const user = userEvent.setup();
    useRealDb();

    renderPage('2026-07');
    await user.click(await screen.findByRole('tab', { name: '颜色条视图' }));
    await user.click(screen.getByRole('button', { name: '下一月' }));
    expect(await screen.findByText('2026年8月')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '常规视图' }));
    expect(await screen.findByText('2026年8月')).toBeInTheDocument();
    expect(
      await screen.findByRole('gridcell', { name: '2026-08-15 的日期菜单' }),
    ).toBeInTheDocument();
  });

  it('keeps unscheduled tasks reachable from the colour-bar view', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1' }));
    await repos.tasks.insert(makeTask({ id: 'undated', project_id: 'p1', title: '尚未排期' }));

    renderPage('2026-07');
    await user.click(await screen.findByRole('tab', { name: '颜色条视图' }));
    expect(await screen.findByText('未排期任务（1）')).toBeInTheDocument();
    await user.click(screen.getByText('未排期任务（1）'));
    expect(await screen.findByRole('link', { name: '尚未排期' })).toHaveAttribute(
      'href',
      '/tasks?taskId=undated',
    );
  });
});
