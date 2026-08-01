import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMeetingRepository,
  createMilestoneRepository,
  createProjectLinkRepository,
  createProjectRepository,
  createTaskRepository,
} from '@/repositories';
import { createProjectService, type ProjectService } from '@/services/project.service';
import type { ProjectInput } from '@/services/schemas';
import {
  makeMeeting,
  makeMilestone,
  makeProject,
  makeProjectLink,
  makeTask,
} from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb;
let service: ProjectService;

function input(overrides: Partial<ProjectInput> = {}): ProjectInput {
  return {
    name: '新项目',
    description: '',
    status: 'active',
    color: '#2563EB',
    start_date: null,
    target_end_date: null,
    ...overrides,
  };
}

beforeEach(() => {
  db = createTestDb();
  service = createProjectService({
    projects: createProjectRepository(db.executor),
    tasks: createTaskRepository(db.executor),
    runBatch: (statements) => Promise.resolve(db.runBatch(statements)),
  });
});

afterEach(() => {
  db.close();
});

describe('createProject', () => {
  it('trims the name and stores an active, non-archived project', async () => {
    const project = await service.createProject(input({ name: '  官网改版  ' }));

    expect(project.name).toBe('官网改版');
    expect(project.archived_at).toBeNull();
    expect(project.is_sample).toBe(0);
  });

  it('rejects an empty name', async () => {
    await expect(service.createProject(input({ name: '  ' }))).rejects.toThrow('项目名称不能为空');
  });

  it('rejects a target end date before the start date', async () => {
    await expect(
      service.createProject(input({ start_date: '2026-08-01', target_end_date: '2026-07-01' })),
    ).rejects.toThrow('目标结束日期不能早于开始日期');
  });

  it('rejects a colour that is not #RRGGBB', async () => {
    await expect(service.createProject(input({ color: 'blue' }))).rejects.toThrow(
      '颜色必须是 #RRGGBB 格式',
    );
  });

  it('accepts equal start and target dates', async () => {
    const project = await service.createProject(
      input({ start_date: '2026-08-01', target_end_date: '2026-08-01' }),
    );

    expect(project.target_end_date).toBe('2026-08-01');
  });
});

describe('archive and restore', () => {
  it('writes archived_at and status together', async () => {
    const project = await service.createProject(input());

    await service.archiveProject(project.id);

    const archived = await service.getProject(project.id);
    expect(archived.archived_at).not.toBeNull();
    expect(archived.status).toBe('archived');
  });

  describe('postponed status', () => {
    it('allows postponed to and from every editable project status', async () => {
      const statuses = ['active', 'on_hold', 'completed'] as const;
      for (const status of statuses) {
        const project = await service.createProject(input({ name: status, status }));
        const postponed = await service.updateProject(
          project.id,
          input({ name: status, status: 'postponed' }),
        );
        expect(postponed.status).toBe('postponed');
        const restored = await service.updateProject(project.id, input({ name: status, status }));
        expect(restored.status).toBe(status);
      }
    });
  });

  it('restores both fields together', async () => {
    const project = await service.createProject(input());
    await service.archiveProject(project.id);

    await service.restoreProject(project.id);

    const restored = await service.getProject(project.id);
    expect(restored.archived_at).toBeNull();
    expect(restored.status).toBe('active');
  });

  it('is a no-op when archiving an already archived project', async () => {
    const project = await service.createProject(input());
    await service.archiveProject(project.id);
    const first = (await service.getProject(project.id)).archived_at;

    await service.archiveProject(project.id);

    expect((await service.getProject(project.id)).archived_at).toBe(first);
  });

  it('archives every live task with source project, keeping manual archives distinct', async () => {
    const tasks = createTaskRepository(db.executor);
    const project = await service.createProject(input());
    await tasks.insert(makeTask({ id: 'parent', project_id: project.id }));
    await tasks.insert(
      makeTask({ id: 'child', project_id: project.id, parent_task_id: 'parent' }),
    );
    await tasks.insert(
      makeTask({
        id: 'manual',
        project_id: project.id,
        archived_at: '2026-01-01T00:00:00.000Z',
        archived_source: 'manual',
      }),
    );

    await service.archiveProject(project.id);

    const parent = await tasks.findById('parent');
    const child = await tasks.findById('child');
    const manual = await tasks.findById('manual');
    expect(parent?.archived_at).not.toBeNull();
    expect(parent?.archived_source).toBe('project');
    expect(child?.archived_source).toBe('project');
    expect(manual?.archived_at).toBe('2026-01-01T00:00:00.000Z');
    expect(manual?.archived_source).toBe('manual');
    expect(await service.countProjectArchivedTasks(project.id)).toBe(2);
  });

  it('restore without tasks keeps auto-archived tasks archived', async () => {
    const tasks = createTaskRepository(db.executor);
    const project = await service.createProject(input());
    await tasks.insert(makeTask({ id: 't1', project_id: project.id }));
    await service.archiveProject(project.id);

    await service.restoreProject(project.id);

    expect((await service.getProject(project.id)).archived_at).toBeNull();
    const task = await tasks.findById('t1');
    expect(task?.archived_at).not.toBeNull();
    expect(task?.archived_source).toBe('project');
  });

  it('restore with tasks only restores project-archived tasks', async () => {
    const tasks = createTaskRepository(db.executor);
    const project = await service.createProject(input());
    await tasks.insert(makeTask({ id: 'auto', project_id: project.id }));
    await tasks.insert(
      makeTask({
        id: 'manual',
        project_id: project.id,
        archived_at: '2026-01-01T00:00:00.000Z',
        archived_source: 'manual',
      }),
    );
    await service.archiveProject(project.id);
    // The user explicitly restored one task afterwards; that decision holds.
    await tasks.update(
      'auto',
      { archived_at: null, archived_source: null },
      '2026-02-01T00:00:00.000Z',
    );
    await tasks.insert(
      makeTask({ id: 'auto2', project_id: project.id }),
    );
    await db.executor.execute(
      `UPDATE tasks SET archived_at = '2026-02-02T00:00:00.000Z', archived_source = 'project'
        WHERE id = 'auto2'`,
    );

    await service.restoreProject(project.id, true);

    expect((await tasks.findById('auto'))?.archived_at).toBeNull();
    expect((await tasks.findById('auto2'))?.archived_at).toBeNull();
    expect((await tasks.findById('auto2'))?.archived_source).toBeNull();
    expect((await tasks.findById('manual'))?.archived_at).toBe('2026-01-01T00:00:00.000Z');
    expect((await tasks.findById('manual'))?.archived_source).toBe('manual');
  });
});

describe('deleteProjectPermanently', () => {
  it('refuses to delete a project that is not archived', async () => {
    const project = await service.createProject(input());

    await expect(service.deleteProjectPermanently(project.id)).rejects.toThrow(
      '只能永久删除已归档的项目',
    );
    expect(await service.getProject(project.id)).not.toBeNull();
  });

  it('deletes an archived project and cascades every project-owned record', async () => {
    const project = await service.createProject(input());
    await createTaskRepository(db.executor).insert(makeTask({ id: 't1', project_id: project.id }));
    await createMeetingRepository(db.executor).insert(makeMeeting({ project_id: project.id }));
    await createMilestoneRepository(db.executor).insert(makeMilestone({ project_id: project.id }));
    await createProjectLinkRepository(db.executor).insert(
      makeProjectLink({ project_id: project.id }),
    );
    await service.archiveProject(project.id);

    await service.deleteProjectPermanently(project.id);

    await expect(service.getProject(project.id)).rejects.toThrow('项目不存在');
    expect(await createTaskRepository(db.executor).findById('t1')).toBeNull();
    expect(await createMeetingRepository(db.executor).findByProject(project.id)).toEqual([]);
    expect(await createMilestoneRepository(db.executor).findByProject(project.id)).toEqual([]);
    expect(await createProjectLinkRepository(db.executor).findByProject(project.id)).toEqual([]);
  });

  it('reports every cascade count before deleting, not an estimate', async () => {
    const project = await service.createProject(input());
    const tasks = createTaskRepository(db.executor);
    await tasks.insert(makeTask({ id: 't1', project_id: project.id }));
    await tasks.insert(makeTask({ id: 't2', project_id: project.id }));
    await tasks.insert(
      makeTask({ id: 't3', project_id: project.id, archived_at: '2026-07-01T00:00:00Z' }),
    );
    await createMeetingRepository(db.executor).insert(makeMeeting({ project_id: project.id }));
    await createMilestoneRepository(db.executor).insert(makeMilestone({ project_id: project.id }));
    await createProjectLinkRepository(db.executor).insert(
      makeProjectLink({ project_id: project.id }),
    );

    expect(await service.countDeleteImpact(project.id)).toEqual({
      taskCount: 3,
      meetingCount: 1,
      milestoneCount: 1,
      projectLinkCount: 1,
    });
  });

  it('reports zero impact for an empty project', async () => {
    const project = await service.createProject(input());

    expect(await service.countDeleteImpact(project.id)).toEqual({
      taskCount: 0,
      meetingCount: 0,
      milestoneCount: 0,
      projectLinkCount: 0,
    });
  });
});

describe('getProgress', () => {
  it('ignores archived tasks and cancelled tasks', async () => {
    const project = await service.createProject(input());
    const tasks = createTaskRepository(db.executor);
    await tasks.insert(makeTask({ id: 't1', project_id: project.id, status: 'done' }));
    await tasks.insert(makeTask({ id: 't2', project_id: project.id, status: 'todo' }));
    await tasks.insert(makeTask({ id: 't3', project_id: project.id, status: 'cancelled' }));
    await tasks.insert(
      makeTask({
        id: 't4',
        project_id: project.id,
        status: 'todo',
        archived_at: '2026-07-01T00:00:00Z',
      }),
    );

    expect(await service.getProgress(project.id)).toEqual({ total: 2, done: 1, percent: 50 });
  });

  it('returns zeros for a project without tasks', async () => {
    const project = await service.createProject(input());

    expect(await service.getProgress(project.id)).toEqual({ total: 0, done: 0, percent: 0 });
  });
});

describe('listProjects', () => {
  beforeEach(async () => {
    const repo = createProjectRepository(db.executor);
    await repo.insert(
      makeProject({ id: 'a', name: 'Alpha 网站', description: '前端', updated_at: '2026-07-01' }),
    );
    await repo.insert(
      makeProject({
        id: 'b',
        name: 'Beta 后台',
        description: '数据',
        status: 'on_hold',
        updated_at: '2026-07-03',
      }),
    );
    await repo.insert(
      makeProject({
        id: 'c',
        name: 'Gamma 归档项目',
        status: 'archived',
        archived_at: '2026-07-02T00:00:00Z',
        updated_at: '2026-07-02',
      }),
    );
  });

  it('hides archived projects by default', async () => {
    const ids = (await service.listProjects()).map((project) => project.id);

    expect(ids).toEqual(['b', 'a']);
  });

  it('can list only archived projects', async () => {
    const ids = (await service.listProjects({ scope: 'archived' })).map((project) => project.id);

    expect(ids).toEqual(['c']);
  });

  it('can list every project', async () => {
    expect(await service.listProjects({ scope: 'all' })).toHaveLength(3);
  });

  it('filters by status', async () => {
    const ids = (await service.listProjects({ status: 'on_hold' })).map((project) => project.id);

    expect(ids).toEqual(['b']);
  });

  it('searches name and description', async () => {
    expect((await service.listProjects({ search: 'Alpha' })).map((p) => p.id)).toEqual(['a']);
    expect((await service.listProjects({ search: '数据' })).map((p) => p.id)).toEqual(['b']);
  });

  it('treats % in a search term literally', async () => {
    expect(await service.listProjects({ search: '%' })).toHaveLength(0);
  });

  it('sorts by name', async () => {
    const ids = (await service.listProjects({ scope: 'all', sort: 'name' })).map(
      (project) => project.id,
    );

    expect(ids).toEqual(['a', 'b', 'c']);
  });
});
