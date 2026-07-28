import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createActionItemRepository,
  createAppSettingRepository,
  createMeetingRepository,
  createMilestoneRepository,
  createProjectRepository,
  createTaskRepository,
} from '@/repositories';
import type { ActionItem, Meeting, Milestone } from '@/types';
import { makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, NOW, type TestDb } from '../helpers/testDb';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    project_id: 'p1',
    topic: '周会',
    date: '2026-07-14',
    attendees: '[]',
    agenda: '',
    notes: '',
    decisions: '',
    risks: '',
    is_sample: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeActionItem(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: 'a1',
    meeting_id: 'm1',
    content: '跟进事项',
    owner: '',
    due_date: null,
    status: 'open',
    converted_task_id: null,
    converted_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'ms1',
    project_id: 'p1',
    linked_task_id: null,
    name: '里程碑',
    description: '',
    date: '2026-08-01',
    status: 'upcoming',
    achieved_at: null,
    is_sample: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe('migration 0001 schema', () => {
  it('creates all 8 tables', () => {
    const names = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(names).toEqual([
      'action_items',
      'app_settings',
      'meetings',
      'milestones',
      'project_links',
      'projects',
      'task_dependencies',
      'tasks',
    ]);
  });

  it('creates the two-level and cascade triggers', () => {
    const triggers = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(triggers).toContain('trg_tasks_max_two_levels_insert');
    expect(triggers).toContain('trg_tasks_max_two_levels_update');
    expect(triggers).toContain('trg_tasks_no_parent_if_has_children');
  });

  it('creates the dashboard and dependency indexes', () => {
    const indexes = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(indexes).toContain('idx_tasks_dashboard');
    expect(indexes).toContain('idx_deps_successor');
  });
});

describe('projects repository', () => {
  it('round-trips a project through Zod narrowing', async () => {
    const repo = createProjectRepository(db.executor);
    await repo.insert(makeProject({ start_date: '2026-07-01', target_end_date: '2026-09-01' }));

    const found = await repo.findById('p1');
    expect(found?.name).toBe('示例项目');
    expect(found?.is_sample).toBe(0);
    expect(found?.start_date).toBe('2026-07-01');
    expect(await repo.findAll()).toHaveLength(1);
  });

  it('rejects an invalid color via CHECK constraint', async () => {
    const repo = createProjectRepository(db.executor);
    await expect(repo.insert(makeProject({ color: 'blue' }))).rejects.toThrow();
  });
});

describe('cascade + trigger rules', () => {
  it('cascades project delete to its tasks (no orphans)', async () => {
    const projects = createProjectRepository(db.executor);
    const tasks = createTaskRepository(db.executor);
    await projects.insert(makeProject());
    await tasks.insert(makeTask());

    await projects.deleteById('p1');
    expect(await tasks.findByProject('p1')).toHaveLength(0);
  });

  it('cascades a parent task delete to its children', async () => {
    const projects = createProjectRepository(db.executor);
    const tasks = createTaskRepository(db.executor);
    await projects.insert(makeProject());
    await tasks.insert(makeTask({ id: 'parent' }));
    await tasks.insert(makeTask({ id: 'child', parent_task_id: 'parent' }));

    await tasks.deleteById('parent');
    expect(await tasks.findById('child')).toBeNull();
  });

  it('aborts a third nesting level with MAX_TWO_LEVELS', async () => {
    const projects = createProjectRepository(db.executor);
    const tasks = createTaskRepository(db.executor);
    await projects.insert(makeProject());
    await tasks.insert(makeTask({ id: 'lvl1' }));
    await tasks.insert(makeTask({ id: 'lvl2', parent_task_id: 'lvl1' }));

    await expect(tasks.insert(makeTask({ id: 'lvl3', parent_task_id: 'lvl2' }))).rejects.toThrow(
      /MAX_TWO_LEVELS/,
    );
  });
});

describe('action item conversion invariants', () => {
  it('enforces UNIQUE(converted_task_id) — a task backs at most one action item', async () => {
    const projects = createProjectRepository(db.executor);
    const tasks = createTaskRepository(db.executor);
    const meetings = createMeetingRepository(db.executor);
    const items = createActionItemRepository(db.executor);
    await projects.insert(makeProject());
    await tasks.insert(makeTask({ id: 'task-x' }));
    await meetings.insert(makeMeeting());
    await items.insert(
      makeActionItem({ id: 'a1', converted_task_id: 'task-x', converted_at: NOW }),
    );

    await expect(
      items.insert(makeActionItem({ id: 'a2', converted_task_id: 'task-x', converted_at: NOW })),
    ).rejects.toThrow();
  });

  it('SET NULL on task delete keeps converted_at ("已转换" is sticky)', async () => {
    const projects = createProjectRepository(db.executor);
    const tasks = createTaskRepository(db.executor);
    const meetings = createMeetingRepository(db.executor);
    const items = createActionItemRepository(db.executor);
    await projects.insert(makeProject());
    await tasks.insert(makeTask({ id: 'task-x' }));
    await meetings.insert(makeMeeting());
    await items.insert(
      makeActionItem({ id: 'a1', converted_task_id: 'task-x', converted_at: NOW }),
    );

    await tasks.deleteById('task-x');
    const item = await items.findById('a1');
    expect(item?.converted_task_id).toBeNull();
    expect(item?.converted_at).toBe(NOW);
  });
});

describe('milestone linked_task_id SET NULL', () => {
  it('nulls the link when the task is deleted without deleting the milestone', async () => {
    const projects = createProjectRepository(db.executor);
    const tasks = createTaskRepository(db.executor);
    const milestones = createMilestoneRepository(db.executor);
    await projects.insert(makeProject());
    await tasks.insert(makeTask({ id: 'task-x' }));
    await milestones.insert(makeMilestone({ linked_task_id: 'task-x' }));

    await tasks.deleteById('task-x');
    const found = await milestones.findById('ms1');
    expect(found).not.toBeNull();
    expect(found?.linked_task_id).toBeNull();
  });
});

describe('execute_batch atomicity (Rust command contract)', () => {
  it('rolls the whole batch back when a later statement fails', async () => {
    const projects = createProjectRepository(db.executor);
    await projects.insert(makeProject({ id: 'keep' }));

    expect(() =>
      db.runBatch([
        {
          sql: 'INSERT INTO projects (id, name, description, status, color, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          params: ['batch-1', '批量一', '', 'active', '#2563EB', 0, NOW, NOW],
        },
        {
          // Violates FK: project_id does not exist -> whole transaction rolls back.
          sql: 'INSERT INTO tasks (id, project_id, title, status, priority, progress, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          params: ['t-bad', 'no-such-project', '孤儿任务', 'todo', 'medium', 0, 0, NOW, NOW],
        },
      ]),
    ).toThrow();

    // The first insert must not survive the rollback.
    expect(await projects.findById('batch-1')).toBeNull();
    expect(await projects.findById('keep')).not.toBeNull();
  });

  it('commits every statement on success', async () => {
    const projects = createProjectRepository(db.executor);
    const affected = db.runBatch([
      {
        sql: 'INSERT INTO projects (id, name, description, status, color, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        params: ['ok-1', '批量', '', 'active', '#2563EB', 0, NOW, NOW],
      },
      {
        sql: 'UPDATE projects SET status = ? WHERE id = ?',
        params: ['on_hold', 'ok-1'],
      },
    ]);
    expect(affected).toBe(2);
    expect((await projects.findById('ok-1'))?.status).toBe('on_hold');
  });
});

describe('app_settings upsert', () => {
  it('inserts then updates on key conflict', async () => {
    const settings = createAppSettingRepository(db.executor);
    await settings.set('theme', 'dark', NOW);
    await settings.set('theme', 'light', '2026-07-15T00:00:00Z');

    const row = await settings.get('theme');
    expect(row?.value).toBe('light');
    expect(await settings.findAll()).toHaveLength(1);
  });
});
