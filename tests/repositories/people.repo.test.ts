import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createPeopleRepository,
  createProjectRepository,
  createTaskRepository,
} from '@/repositories';
import {
  makePerson,
  makeProject,
  makeProjectParticipant,
  makeTask,
  makeTaskParticipant,
} from '../helpers/fixtures';
import { NOW, createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

describe('people repository', () => {
  it('creates, reads, updates, lists, and deletes people', async () => {
    const people = createPeopleRepository(db.executor);
    await people.insert(makePerson({ id: 'p-b', name: '李四' }));
    await people.insert(makePerson({ id: 'p-a', name: '阿明' }));

    expect((await people.findAll()).map((person) => person.name)).toEqual(['阿明', '李四']);
    await people.update('p-b', { name: '王五' }, '2026-07-15T00:00:00Z');
    expect(await people.findById('p-b')).toMatchObject({
      name: '王五',
      updated_at: '2026-07-15T00:00:00Z',
    });

    await people.deleteById('p-a');
    expect(await people.findById('p-a')).toBeNull();
  });

  it('round-trips independent project and task relationships with joined details', async () => {
    const projects = createProjectRepository(db.executor);
    const tasks = createTaskRepository(db.executor);
    const people = createPeopleRepository(db.executor);
    await projects.insert(makeProject({ id: 'project-1', name: '甲项目' }));
    await projects.insert(makeProject({ id: 'project-2', name: '乙项目' }));
    await tasks.insert(makeTask({ id: 'task-1', project_id: 'project-2', title: '联调' }));
    await people.insert(makePerson());
    await people.insertProjectParticipant(
      makeProjectParticipant({
        project_id: 'project-1',
        role: '产品',
        joined_at: NOW,
      }),
    );
    await people.insertTaskParticipant(
      makeTaskParticipant({ task_id: 'task-1', assigned_at: NOW }),
    );

    expect(await people.findProjectParticipantsByPerson('person-1')).toEqual([
      expect.objectContaining({
        project_id: 'project-1',
        project_name: '甲项目',
        role: '产品',
      }),
    ]);
    expect(await people.findTaskParticipantsByPerson('person-1')).toEqual([
      expect.objectContaining({
        task_id: 'task-1',
        task_title: '联调',
        project_id: 'project-2',
        project_name: '乙项目',
      }),
    ]);
    expect(await people.findProjectParticipant('project-2', 'person-1')).toBeNull();

    await people.deleteTaskParticipant('task-1', 'person-1');
    expect(await people.findTaskParticipantsByPerson('person-1')).toEqual([]);
    expect(await people.findProjectParticipantsByPerson('person-1')).toHaveLength(1);
  });
});
