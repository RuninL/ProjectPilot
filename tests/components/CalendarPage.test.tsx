import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CalendarPage } from '@/features/calendar/pages/CalendarPage';
import { monthOf } from '@/features/calendar/calendarModel';
import { todayHK } from '@/lib/date';
import { setDbForTesting, type SqlExecutor } from '@/lib/db';
import { getRepositories } from '@/repositories';
import { getRecurrenceService } from '@/services/recurrence.service';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { makeMeeting, makeMilestone, makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb | null = null;

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
    expect(await getRepositories().then((repos) => repos.meetings.findAll())).toHaveLength(0);
  });
});
