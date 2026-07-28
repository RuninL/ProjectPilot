import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MilestoneSection } from '@/features/milestones/components/MilestoneSection';
import { addDays, todayHK } from '@/lib/date';
import { setDbForTesting, type SqlExecutor } from '@/lib/db';
import { getRepositories } from '@/repositories';
import { useMilestoneStore } from '@/stores/useMilestoneStore';
import { useTaskStore } from '@/stores/useTaskStore';
import { makeMilestone, makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb | null = null;

function renderSection(canEdit = true) {
  render(
    <MemoryRouter>
      <MilestoneSection projectId="p1" canEdit={canEdit} editHint={canEdit ? null : '项目已归档'} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useMilestoneStore.getState().reset();
  useTaskStore.setState({ tasks: [], loading: false, error: null });
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

describe('MilestoneSection', () => {
  it('shows the loading state while the first read is in flight', async () => {
    setDbForTesting({
      select: () => new Promise(() => undefined),
      execute: () => new Promise(() => undefined),
    });

    renderSection();

    expect(await screen.findByText('正在加载里程碑…')).toBeInTheDocument();
  });

  it('shows the database error state with a retry affordance', async () => {
    // Only the milestone read fails, so the section's own error path is what is asserted.
    const failing: SqlExecutor = {
      select: <T,>(query: string): Promise<T> =>
        query.toLowerCase().includes('from milestones')
          ? Promise.reject(new Error('database disk image is malformed'))
          : Promise.resolve([] as unknown as T),
      execute: () => Promise.resolve({ rowsAffected: 0 }),
    };
    setDbForTesting(failing);

    renderSection();

    expect(await screen.findByText('无法加载里程碑')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('shows the empty state when the project has no milestone', async () => {
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1' }));

    renderSection();

    expect(
      await screen.findByText('该项目暂无里程碑。新建里程碑后会显示倒计时与逾期提醒。'),
    ).toBeInTheDocument();
  });

  it('renders the Hong-Kong-time countdown and flags an overdue milestone', async () => {
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1' }));
    await repos.milestones.insert(
      makeMilestone({ id: 'ms1', project_id: 'p1', name: '内测上线', date: addDays(todayHK(), 5) }),
    );
    await repos.milestones.insert(
      makeMilestone({
        id: 'ms2',
        project_id: 'p1',
        name: '数据迁移',
        date: addDays(todayHK(), -3),
      }),
    );
    await repos.milestones.insert(
      makeMilestone({ id: 'ms3', project_id: 'p1', name: '当天到期', date: todayHK() }),
    );

    renderSection();

    expect(await screen.findByText('剩余 5 天')).toBeInTheDocument();
    expect(screen.getByText('已逾期 3 天')).toBeInTheDocument();
    expect(screen.getByText('今天到期')).toBeInTheDocument();
  });

  it('answering 否 to the achieve prompt writes nothing at all', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1' }));
    await repos.tasks.insert(
      makeTask({
        id: 't1',
        project_id: 'p1',
        title: '完成迁移脚本',
        status: 'done',
        progress: 100,
      }),
    );
    await repos.milestones.insert(
      makeMilestone({ id: 'ms1', project_id: 'p1', name: '数据迁移', linked_task_id: 't1' }),
    );

    renderSection();

    expect(
      await screen.findByText(
        '关联任务「完成迁移脚本」已完成，是否将里程碑「数据迁移」标记为已达成？',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '否，保持当前状态' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const after = await repos.milestones.findById('ms1');
    expect(after?.status).toBe('upcoming');
    expect(after?.achieved_at).toBeNull();
  });

  it('answering 是 to the achieve prompt marks the milestone achieved', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1' }));
    await repos.tasks.insert(
      makeTask({
        id: 't1',
        project_id: 'p1',
        title: '完成迁移脚本',
        status: 'done',
        progress: 100,
      }),
    );
    await repos.milestones.insert(
      makeMilestone({ id: 'ms1', project_id: 'p1', name: '数据迁移', linked_task_id: 't1' }),
    );

    renderSection();
    await screen.findByRole('button', { name: '是，标记为已达成' });

    await user.click(screen.getByRole('button', { name: '是，标记为已达成' }));

    await waitFor(async () => {
      const after = await repos.milestones.findById('ms1');
      expect(after?.status).toBe('achieved');
      expect(after?.achieved_at).not.toBeNull();
    });
  });

  it('cancelling the delete confirmation keeps the milestone', async () => {
    const user = userEvent.setup();
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1' }));
    await repos.milestones.insert(makeMilestone({ id: 'ms1', project_id: 'p1', name: '内测上线' }));

    renderSection();
    await screen.findByText('内测上线');

    await user.click(screen.getByRole('button', { name: '删除里程碑：内测上线' }));

    expect(
      await screen.findByText('确定删除里程碑「内测上线」吗？关联任务不会被删除。此操作不可撤销。'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(await repos.milestones.findById('ms1')).not.toBeNull();
  });

  it('blocks every edit affordance for an archived project', async () => {
    useRealDb();
    const repos = await getRepositories();
    await repos.projects.insert(
      makeProject({ id: 'p1', status: 'archived', archived_at: '2026-07-01T00:00:00Z' }),
    );
    await repos.milestones.insert(makeMilestone({ id: 'ms1', project_id: 'p1', name: '内测上线' }));

    renderSection(false);

    expect(await screen.findByText('项目已归档')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建里程碑' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除里程碑：内测上线' })).toBeDisabled();
  });
});
