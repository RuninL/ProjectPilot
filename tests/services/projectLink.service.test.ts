import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProjectLinkRepository,
  createProjectRepository,
  createTaskRepository,
} from '@/repositories';
import {
  createProjectLinkService,
  type ProjectLinkService,
  type ProjectLinkServiceDeps,
} from '@/services/projectLink.service';
import type { ProjectLinkInput } from '@/services/schemas';
import { makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb;
let service: ProjectLinkService;
let openUrl: ProjectLinkServiceDeps['openUrl'];
let pathExists: ProjectLinkServiceDeps['pathExists'];
let openPath: ProjectLinkServiceDeps['openPath'];

function input(overrides: Partial<ProjectLinkInput> = {}): ProjectLinkInput {
  return {
    label: '需求文档',
    link_type: 'url',
    target: 'https://example.com/spec',
    description: '产品需求',
    ...overrides,
  };
}

beforeEach(async () => {
  db = createTestDb();
  const projects = createProjectRepository(db.executor);
  openUrl = vi.fn().mockResolvedValue(undefined);
  pathExists = vi.fn().mockResolvedValue(true);
  openPath = vi.fn().mockResolvedValue(undefined);
  service = createProjectLinkService({
    projectLinks: createProjectLinkRepository(db.executor),
    projects,
    openUrl,
    pathExists,
    openPath,
  });
  await projects.insert(makeProject({ id: 'p1', name: '主项目' }));
  await projects.insert(makeProject({ id: 'p2', name: '其他项目' }));
});

afterEach(() => {
  db.close();
});

describe('project link service CRUD and isolation', () => {
  it('creates, reads, updates, and deletes URL and file-path records', async () => {
    const url = await service.createProjectLink('p1', input());
    const file = await service.createProjectLink(
      'p1',
      input({
        label: '本地方案',
        link_type: 'file_path',
        target: 'C:\\项目\\方案.pdf',
        description: '',
      }),
    );

    expect(await service.listProjectLinks('p1')).toEqual([url, file]);
    const updated = await service.updateProjectLink(
      'p1',
      url.id,
      input({ label: '最新需求', target: 'https://example.com/latest' }),
    );
    expect(updated.label).toBe('最新需求');
    expect(updated.description).toBe('产品需求');

    await service.deleteProjectLink('p1', file.id);
    expect(await service.listProjectLinks('p1')).toEqual([updated]);
  });

  it('rejects blank names, blank targets, and relative paths while preserving schemeless URLs', async () => {
    await expect(service.createProjectLink('p1', input({ label: ' ' }))).rejects.toThrow(
      '资料名称不能为空',
    );
    await expect(service.createProjectLink('p1', input({ target: ' ' }))).rejects.toThrow(
      '目标地址或路径不能为空',
    );
    const schemeless = await service.createProjectLink(
      'p1',
      input({ target: ' example.com/path?query=1#result ' }),
    );
    expect(schemeless.target).toBe('example.com/path?query=1#result');
    await expect(
      service.createProjectLink('p1', input({ link_type: 'file_path', target: 'docs\\plan.pdf' })),
    ).rejects.toThrow('请输入 Windows 绝对路径');
  });

  it('isolates reads, edits, deletes, and opens by owning project', async () => {
    const link = await service.createProjectLink('p1', input());

    expect(await service.listProjectLinks('p2')).toEqual([]);
    await expect(service.updateProjectLink('p2', link.id, input())).rejects.toThrow(
      '不属于当前项目',
    );
    await expect(service.deleteProjectLink('p2', link.id)).rejects.toThrow('不属于当前项目');
    await expect(service.openProjectLink('p2', link.id)).rejects.toThrow('不属于当前项目');
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('cascades links when a project is deleted and leaves unrelated entities untouched', async () => {
    const projects = createProjectRepository(db.executor);
    const tasks = createTaskRepository(db.executor);
    const link = await service.createProjectLink('p1', input());
    await tasks.insert(makeTask({ id: 'task-p1', project_id: 'p1' }));
    await tasks.insert(makeTask({ id: 'task-p2', project_id: 'p2' }));

    await service.deleteProjectLink('p1', link.id);
    expect(await tasks.findById('task-p1')).not.toBeNull();
    expect(await tasks.findById('task-p2')).not.toBeNull();

    await service.createProjectLink('p1', input());
    await projects.deleteById('p1');
    expect(await createProjectLinkRepository(db.executor).findByProject('p1')).toEqual([]);
    expect(await tasks.findById('task-p2')).not.toBeNull();
  });
});

describe('project link safe opening', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\nscript:alert(1)',
    'data:text/plain,hello',
    'file:///C:/secret.txt',
    'vbscript:test',
    'shell:test',
    'powershell:test',
    'cmd:test',
  ])('rejects dangerous protocol %s before storage', async (target) => {
    await expect(service.createProjectLink('p1', input({ target }))).rejects.toThrow(
      '危险协议不受支持',
    );
    expect(openUrl).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
  });

  it.each(['ftp://example.com/file', 'mailto:test@example.com'])(
    'does not execute unsupported protocol %s',
    async (target) => {
      const link = await service.createProjectLink('p1', input({ target }));
      await expect(service.openProjectLink('p1', link.id)).rejects.toThrow('暂不支持该链接类型');
      expect(openUrl).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['http://example.com', 'http://example.com'],
    ['https://example.com', 'https://example.com'],
    ['www.example.com/path', 'https://www.example.com/path'],
    ['localhost:3000', 'http://localhost:3000'],
    ['127.0.0.1:5173', 'http://127.0.0.1:5173'],
    ['192.168.1.20:8080/dashboard', 'http://192.168.1.20:8080/dashboard'],
  ])('opens allow-listed URL %s with the official opener dependency', async (target, opened) => {
    const link = await service.createProjectLink('p1', input({ target }));

    await service.openProjectLink('p1', link.id);

    expect(openUrl).toHaveBeenCalledWith(opened);
    expect(link.target).toBe(target);
  });

  it('does not call the path opener when a local target does not exist', async () => {
    pathExists = vi.fn().mockResolvedValue(false);
    service = createProjectLinkService({
      projectLinks: createProjectLinkRepository(db.executor),
      projects: createProjectRepository(db.executor),
      openUrl,
      pathExists,
      openPath,
    });
    const link = await service.createProjectLink(
      'p1',
      input({ link_type: 'file_path', target: 'C:\\项目\\已删除.pdf' }),
    );

    await expect(service.openProjectLink('p1', link.id)).rejects.toThrow('文件或目录不存在');
    expect(openPath).not.toHaveBeenCalled();
  });

  it('opens a local target only after the existence check succeeds', async () => {
    const target = '\\\\server\\share\\资料';
    const link = await service.createProjectLink('p1', input({ link_type: 'file_path', target }));

    await service.openProjectLink('p1', link.id);

    expect(pathExists).toHaveBeenCalledWith(target);
    expect(openPath).toHaveBeenCalledWith(target);
  });
});
