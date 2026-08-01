import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchStatement } from '@/lib/commands';
import { MeetingSection } from '@/features/meetings/components/MeetingSection';
import { setDbForTesting, type SqlExecutor } from '@/lib/db';
import { getRepositories } from '@/repositories';
import { getRecurrenceService } from '@/services/recurrence.service';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { useMeetingStore } from '@/stores/useMeetingStore';
import { useRecurrenceStore } from '@/stores/useRecurrenceStore';
import { makeProject } from '../helpers/fixtures';
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
    expect(await screen.findByText('项目周会 [周期会议]')).toHaveClass('text-recurrence');
  });

  it('shows only project recurring series before meetings and orders each group', async () => {
    useRealDb();
    const project = makeProject({ id: 'p1', name: '内网门户重构' });
    const otherProject = makeProject({ id: 'p2', name: '其他项目' });
    const repos = await getRepositories();
    await repos.projects.insert(project);
    await repos.projects.insert(otherProject);
    await repos.meetings.insert(
      (await import('../helpers/fixtures')).makeMeeting({
        id: 'late',
        project_id: 'p1',
        topic: '下午会议',
        date: '2026-07-20',
        start_time: '14:00',
      }),
    );
    await repos.meetings.insert(
      (await import('../helpers/fixtures')).makeMeeting({
        id: 'early',
        project_id: 'p1',
        topic: '上午会议',
        date: '2026-07-20',
        start_time: '09:00',
      }),
    );
    const recurrence = await getRecurrenceService();
    await recurrence.createRule({
      project_id: 'p1',
      kind: 'meeting',
      title: '乙例会',
      byweekday: 2,
      interval: 1,
      start_date: '2026-07-01',
      end_date: '2026-12-31',
      time_of_day: '09:30',
      duration_minutes: null,
      default_priority: null,
      note: '',
      is_active: 1,
    });
    const alpha = await recurrence.createRule({
      project_id: 'p1',
      kind: 'meeting',
      title: '甲例会',
      byweekday: 1,
      interval: 1,
      start_date: '2026-07-01',
      end_date: '2026-12-31',
      time_of_day: null,
      duration_minutes: null,
      default_priority: null,
      note: '',
      is_active: 1,
    });
    await recurrence.createRule({
      project_id: 'p2',
      kind: 'meeting',
      title: '其他项目例会',
      byweekday: 1,
      interval: 1,
      start_date: '2026-07-01',
      end_date: '2026-12-31',
      time_of_day: null,
      duration_minutes: null,
      default_priority: null,
      note: '',
      is_active: 1,
    });
    await recurrence.createRule({
      project_id: null,
      kind: 'meeting',
      title: '独立例会',
      byweekday: 1,
      interval: 1,
      start_date: '2026-07-01',
      end_date: '2026-12-31',
      time_of_day: null,
      duration_minutes: null,
      default_priority: null,
      note: '',
      is_active: 1,
    });

    const { container } = render(
      <MemoryRouter>
        <MeetingSection project={project} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('甲例会 [周期会议]')).toBeInTheDocument();
    expect(screen.queryByText('其他项目例会 [周期会议]')).toBeNull();
    expect(screen.queryByText('独立例会 [周期会议]')).toBeNull();
    expect(screen.getByRole('link', { name: /甲例会/ })).toHaveAttribute(
      'href',
      `/meetings?series=${encodeURIComponent(alpha.id)}`,
    );
    const orderedTitles = [...container.querySelectorAll('li')]
      .map((item) => item.textContent)
      .filter((text) => /例会|会议/.test(text));
    expect(orderedTitles).toEqual(
      expect.arrayContaining([
        '甲例会 [周期会议]每周二，至 2026-12-31',
        '乙例会 [周期会议]每周三 09:30，至 2026-12-31',
      ]),
    );
    expect(orderedTitles.indexOf('上午会议2026-07-2009:00打开')).toBeLessThan(
      orderedTitles.indexOf('下午会议2026-07-2014:00打开'),
    );
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
