import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage';
import { AppError } from '@/lib/errors';
import type { DashboardData, DashboardTaskItem } from '@/services/dashboard.service';
import { makeMilestone } from '../helpers/fixtures';

const mocks = vi.hoisted(() => ({
  loadDashboard: vi.fn(),
  openTask: vi.fn(),
}));

vi.mock('@/services/dashboard.service', () => ({
  getDashboardService: vi.fn().mockResolvedValue({ load: mocks.loadDashboard }),
}));

vi.mock('@/lib/taskNavigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/taskNavigation')>();
  return { ...actual, openTask: mocks.openTask };
});

function task(taskId: string, title: string, projectName = '项目甲'): DashboardTaskItem {
  return {
    taskId,
    title,
    projectName,
    projectColor: '#2563EB',
    dueDate: '2026-08-19',
    progress: 20,
  };
}

const baseData = {
  today: '2026-08-19',
  projects: [],
  todayTasks: [task('today-id', '今日任务')],
  upcomingTasks: [task('upcoming-id', '即将到期任务')],
  overdueTasks: [task('overdue-id', '已逾期任务')],
  upcomingMeetings: [],
  todayMilestones: [],
  overdueMilestones: [],
  futureMilestones: [],
  overdueRisks: [task('overdue-risk-id', '逾期风险任务')],
  lowProgressRisks: [task('high-risk-id', '高风险任务')],
  blockedPropagationRisks: [
    {
      task: task('blocked-id', '受阻任务'),
      blockedBy: [task('blocker-id', '前置任务')],
    },
  ],
  milestonePredecessorRisks: [
    {
      milestone: makeMilestone({ id: 'milestone-risk', name: '发布里程碑' }),
      project: null,
      blockingTasks: [task('milestone-blocker-id', '里程碑前置任务')],
    },
  ],
  openRisks: [],
} satisfies DashboardData;

async function sectionForHeading(name: string): Promise<HTMLElement> {
  const headings = await screen.findAllByRole('heading', { name });
  const heading = headings.find((candidate) => candidate.tagName === 'H2') ?? headings[0];
  if (heading === undefined) {
    throw new Error(`未找到栏目标题：${name}`);
  }
  const section = heading.closest('section');
  if (section === null) {
    throw new Error(`未找到栏目：${name}`);
  }
  return section;
}

describe('DashboardPage task links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadDashboard.mockResolvedValue(baseData);
    mocks.openTask.mockResolvedValue(undefined);
  });

  it.each([
    ['今日到期', '今日任务', 'today-id'],
    ['即将到期（7 天内）', '即将到期任务', 'upcoming-id'],
    ['已逾期', '已逾期任务', 'overdue-id'],
    ['逾期未完成（1）', '逾期风险任务', 'overdue-risk-id'],
    ['临期低进度（1）', '高风险任务', 'high-risk-id'],
    ['受阻传导（1）', '受阻任务', 'blocked-id'],
    ['14 天内里程碑前置未完成（1）', '里程碑前置任务', 'milestone-blocker-id'],
  ])('opens the %s item directly by its taskId', async (heading, title, taskId) => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    const link = await within(await sectionForHeading(heading)).findByRole('link', {
      name: new RegExp(title),
    });
    expect(link).toHaveAttribute('href', `/tasks/${taskId}`);
    await user.click(link);

    expect(mocks.openTask).toHaveBeenCalledOnce();
    expect(mocks.openTask).toHaveBeenCalledWith(taskId);
  });

  it('keeps duplicate titles bound to their distinct persisted ids', async () => {
    const user = userEvent.setup();
    mocks.loadDashboard.mockResolvedValue({
      ...baseData,
      todayTasks: [task('duplicate-a', '同名任务', '项目甲')],
      upcomingTasks: [task('duplicate-b', '同名任务', '项目乙')],
    });
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    const todayLink = await within(await sectionForHeading('今日到期')).findByRole('link', {
      name: /同名任务.*项目甲/,
    });
    const upcomingLink = within(await sectionForHeading('即将到期（7 天内）')).getByRole('link', {
      name: /同名任务.*项目乙/,
    });
    await user.click(todayLink);
    await user.click(upcomingLink);

    expect(mocks.openTask).toHaveBeenNthCalledWith(1, 'duplicate-a');
    expect(mocks.openTask).toHaveBeenNthCalledWith(2, 'duplicate-b');
  });

  it('shows a readable error for an invalid taskId instead of opening the task list', async () => {
    const user = userEvent.setup();
    mocks.loadDashboard.mockResolvedValue({ ...baseData, todayTasks: [task('', '无效任务')] });
    mocks.openTask.mockRejectedValueOnce(new AppError('validation', '任务标识无效'));
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    await user.click(
      await within(await sectionForHeading('今日到期')).findByRole('link', {
        name: /无效任务/,
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('无法打开任务：任务标识无效');
    expect(screen.queryByText('任务列表')).not.toBeInTheDocument();
  });
});
