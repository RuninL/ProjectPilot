import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectLinkRepository, createProjectRepository } from '@/repositories';
import { makeProject, makeProjectLink } from '../helpers/fixtures';
import { createTestDb, NOW, type TestDb } from '../helpers/testDb';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

describe('project_links repository and migration 0006', () => {
  it('round-trips URL and file-path rows including the optional description', async () => {
    const projects = createProjectRepository(db.executor);
    const links = createProjectLinkRepository(db.executor);
    await projects.insert(makeProject());
    await links.insert(makeProjectLink({ id: 'url', description: '在线文档' }));
    await links.insert(
      makeProjectLink({
        id: 'file',
        link_type: 'file_path',
        target: 'C:\\项目\\资料',
        description: '本机副本',
      }),
    );

    expect(await links.findByProject('p1')).toMatchObject([
      { id: 'url', description: '在线文档' },
      { id: 'file', description: '本机副本' },
    ]);
  });

  it('updates only the supported fields and deletes only the selected link', async () => {
    const projects = createProjectRepository(db.executor);
    const links = createProjectLinkRepository(db.executor);
    await projects.insert(makeProject());
    await links.insert(makeProjectLink({ id: 'one' }));
    await links.insert(makeProjectLink({ id: 'two' }));

    await links.update('one', { label: '新名称', description: '新备注' }, NOW);
    await links.deleteById('one');

    expect(await links.findById('one')).toBeNull();
    expect(await links.findById('two')).not.toBeNull();
  });

  it('cascades project deletion without leaving orphan links', async () => {
    const projects = createProjectRepository(db.executor);
    const links = createProjectLinkRepository(db.executor);
    await projects.insert(makeProject());
    await links.insert(makeProjectLink());

    await projects.deleteById('p1');

    expect(await links.findByProject('p1')).toEqual([]);
  });

  it('joins owning projects and composes search, project, and type filters', async () => {
    const projects = createProjectRepository(db.executor);
    const links = createProjectLinkRepository(db.executor);
    await projects.insert(makeProject({ id: 'p1', name: '甲项目' }));
    await projects.insert(makeProject({ id: 'p2', name: '乙项目' }));
    await links.insert(makeProjectLink({ id: 'spec', project_id: 'p1', description: '产品需求' }));
    await links.insert(
      makeProjectLink({
        id: 'local',
        project_id: 'p2',
        label: '设计稿',
        link_type: 'file_path',
        target: 'C:\\设计\\稿件',
      }),
    );

    expect(await links.findAllWithProject({ search: '需求' })).toEqual([
      expect.objectContaining({ id: 'spec', project_name: '甲项目' }),
    ]);
    expect(await links.findAllWithProject({ projectId: 'p2', linkType: 'file_path' })).toEqual([
      expect.objectContaining({ id: 'local', project_name: '乙项目' }),
    ]);
    expect(await links.findAllWithProject({ projectId: 'p1', linkType: 'file_path' })).toEqual([]);
  });
});
