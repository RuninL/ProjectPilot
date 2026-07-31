import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GanttSection } from '@/features/gantt/components/GanttSection';
import { GanttChart } from '@/features/gantt/components/GanttChart';
import { buildGanttViewModel } from '@/features/gantt/ganttViewModel';
import { buildDependencyGraph } from '@/services/dependencyGraph';
import type { ProjectDependencyAnalysis } from '@/services/dependency.service';
import { useGanttStore } from '@/stores/useGanttStore';
import type { Task, TaskDependency } from '@/types';
import { makeTask } from '../helpers/fixtures';
import { NOW } from '../helpers/testDb';

function dependency(id: string, predecessorId: string, successorId: string): TaskDependency {
  return {
    id,
    predecessor_id: predecessorId,
    successor_id: successorId,
    dep_type: 'FS',
    lag_days: 0,
    created_at: NOW,
    updated_at: NOW,
  };
}

function analyze(
  tasks: readonly Task[],
  dependencies: readonly TaskDependency[] = [],
): ProjectDependencyAnalysis {
  const graph = buildDependencyGraph(tasks, dependencies);
  return {
    tasks,
    dependencies,
    graph,
    conflicts: [],
    blockedRisks: [],
    cyclicTaskIds: [],
  };
}

function setup(
  analysis: ProjectDependencyAnalysis | null,
  extra: Partial<{ loading: boolean; error: string | null }> = {},
) {
  const onRetry = vi.fn();
  render(
    <GanttSection
      analysis={analysis}
      loading={extra.loading ?? false}
      error={extra.error ?? null}
      onRetry={onRetry}
    />,
  );
  return { onRetry, user: userEvent.setup() };
}

beforeEach(() => {
  useGanttStore.setState({
    scale: 'month',
    selectedTaskId: null,
    showConflicts: true,
    showMilestones: true,
  });
});

describe('GanttSection', () => {
  it('shows a loading state before the first analysis arrives', () => {
    setup(null, { loading: true });

    expect(screen.getByText('正在加载甘特图…')).toBeInTheDocument();
  });

  it('shows an error state with a retry action', async () => {
    const { onRetry, user } = setup(null, { error: '数据库连接失败' });

    expect(screen.getByText('数据库连接失败')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('explains an empty project instead of drawing an empty chart', () => {
    setup(analyze([]));

    expect(screen.getByText(/该项目暂无可绘制的任务/)).toBeInTheDocument();
  });

  it('names the tasks it could not draw', () => {
    setup(analyze([makeTask({ id: 'a', title: '待排期任务' })]));

    expect(screen.getByText(/有 1 个任务未设置开始日期/)).toBeInTheDocument();
    expect(screen.getByText(/待排期任务/)).toBeInTheDocument();
  });

  it('draws a bar per task with its status and dates in the accessible name', () => {
    setup(
      analyze([
        makeTask({
          id: 'a',
          title: '设计',
          status: 'in_progress',
          start_date: '2026-08-03',
          due_date: '2026-08-06',
        }),
      ]),
    );

    expect(
      screen.getByRole('button', { name: '设计：进行中，2026-08-03 至 2026-08-06' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /甘特图时间轴/ })).toBeInTheDocument();
  });

  it('says in words why a bar is only one day long', () => {
    setup(analyze([makeTask({ id: 'a', title: '调研', start_date: '2026-08-03' })]));

    expect(screen.getByText(/未设置截止日期的任务按单日任务条显示/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: '调研：待办，2026-08-03（未设置截止日期，按单日显示）',
      }),
    ).toBeInTheDocument();
  });

  it('switches the scale and marks the active one', async () => {
    const { user } = setup(analyze([makeTask({ id: 'a', start_date: '2026-08-03' })]));

    const week = screen.getByRole('button', { name: '周' });
    expect(screen.getByRole('button', { name: '月' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(week);

    expect(week).toHaveAttribute('aria-pressed', 'true');
    expect(useGanttStore.getState().scale).toBe('week');
  });

  it('selects a task when its bar is clicked and deselects on a second click', async () => {
    const { user } = setup(
      analyze([makeTask({ id: 'a', title: '设计', start_date: '2026-08-03' })]),
    );

    const bar = screen.getByRole('button', { name: /^设计：/ });
    await user.click(bar);
    expect(useGanttStore.getState().selectedTaskId).toBe('a');

    await user.click(bar);
    expect(useGanttStore.getState().selectedTaskId).toBeNull();
  });

  it('lists schedule conflicts with both task names and a locate action', async () => {
    const tasks = [
      makeTask({ id: 'a', title: '设计', start_date: '2026-08-01', due_date: '2026-08-20' }),
      makeTask({ id: 'b', title: '开发', start_date: '2026-08-10', due_date: '2026-08-25' }),
    ];
    const dependencies = [dependency('e1', 'a', 'b')];
    const base = analyze(tasks, dependencies);
    const { user } = setup({
      ...base,
      conflicts: [
        {
          edgeId: 'e1',
          predecessorId: 'a',
          successorId: 'b',
          predecessorDueDate: '2026-08-20',
          successorStartDate: '2026-08-10',
        },
      ],
    });

    expect(screen.getByText('排期冲突（1）')).toBeInTheDocument();
    expect(
      screen.getByText(/「设计」截止 2026-08-20，晚于「开发」开始 2026-08-10/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '在图中定位' }));
    expect(useGanttStore.getState().selectedTaskId).toBe('b');
  });

  it('labels blocked risk on the bar and spells the legend out in text', () => {
    const tasks = [
      makeTask({ id: 'a', title: '设计', status: 'blocked', start_date: '2026-08-01' }),
      makeTask({ id: 'b', title: '开发', start_date: '2026-08-05' }),
    ];
    const base = analyze(tasks, [dependency('e1', 'a', 'b')]);
    setup({ ...base, blockedRisks: [{ taskId: 'b', blockedBy: ['a'] }] });

    expect(screen.getByText('受阻风险')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /受阻风险来自：设计/ })).toBeInTheDocument();
    for (const label of ['待办', '进行中', '受阻', '已完成', '已取消', '排期冲突', '今日线']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('offers a milestone visibility control', async () => {
    setup(analyze([]));

    const checkbox = screen.getByRole('checkbox', { name: '显示里程碑' });
    expect(checkbox).toBeChecked();
    await userEvent.setup().click(checkbox);
    expect(useGanttStore.getState().showMilestones).toBe(false);
  });

  it('renders an accessible milestone diamond and opens it with click or keyboard', async () => {
    const onSelectMilestone = vi.fn();
    const model = buildGanttViewModel({
      tasks: [],
      milestones: [
        {
          id: 'm1',
          name: '发布',
          date: '2026-08-16',
          status: 'achieved',
          linked_task_id: null,
        },
      ],
      dependencies: [],
      conflicts: [],
      blockedRisks: [],
      scale: 'month',
      today: '2026-08-12',
    });
    const { user } = setup(analyze([]));
    render(
      <GanttChart
        model={model}
        selectedTaskId={null}
        onSelectTask={vi.fn()}
        onSelectMilestone={onSelectMilestone}
      />,
    );

    const diamond = screen.getByRole('button', { name: /里程碑：发布，2026-08-16，已达成/ });
    expect(diamond.querySelector('polygon')).not.toBeNull();
    await user.click(diamond);
    await user.keyboard('{Enter}');
    expect(onSelectMilestone).toHaveBeenCalledTimes(2);
  });
});
