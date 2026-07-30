import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createPeopleRepository,
  createProjectRepository,
  createTaskRepository,
} from '@/repositories';
import {
  createPeopleService,
  groupPersonParticipation,
  type PeopleService,
} from '@/services/people.service';
import type { PersonProjectParticipation, PersonTaskParticipation } from '@/types';
import { makeProject, makeTask } from '../helpers/fixtures';
import { NOW, createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb;
let service: PeopleService;

beforeEach(async () => {
  db = createTestDb();
  const projects = createProjectRepository(db.executor);
  const tasks = createTaskRepository(db.executor);
  service = createPeopleService({
    people: createPeopleRepository(db.executor),
    projects,
    tasks,
  });
  await projects.insert(makeProject({ id: 'project-a', name: '甲项目' }));
  await projects.insert(makeProject({ id: 'project-b', name: '乙项目' }));
  await tasks.insert(makeTask({ id: 'task-a', project_id: 'project-a', title: '设计' }));
  await tasks.insert(makeTask({ id: 'task-b', project_id: 'project-b', title: '开发' }));
});

afterEach(() => {
  db.close();
});

describe('people service CRUD and validation', () => {
  it('trims valid names and rejects blank or overlong names', async () => {
    const person = await service.createPerson({ name: ' 张三 ' });
    expect(person.name).toBe('张三');
    expect(person.email).toBeNull();

    await expect(service.createPerson({ name: '   ' })).rejects.toThrow('姓名不能为空');
    await expect(service.createPerson({ name: 'x'.repeat(121) })).rejects.toThrow(
      '姓名不能超过 120 个字符',
    );

    const updated = await service.updatePerson(person.id, {
      name: ' 李四 ',
      email: 'li@example.com',
      role: ' 开发 ',
      note: ' 备注 ',
    });
    expect(updated).toMatchObject({
      name: '李四',
      email: 'li@example.com',
      role: '开发',
      note: '备注',
    });
  });

  it('reports missing people, projects, and tasks with domain errors', async () => {
    await expect(service.getPerson('missing')).rejects.toThrow('人员不存在');
    const person = await service.createPerson({ name: '张三' });
    await expect(
      service.addProjectParticipant(person.id, { project_id: 'missing', role: '' }),
    ).rejects.toThrow('项目不存在');
    await expect(service.addTaskParticipant(person.id, { task_id: 'missing' })).rejects.toThrow(
      '任务不存在',
    );
  });

  it('rejects duplicate relationships while keeping project and task membership independent', async () => {
    const person = await service.createPerson({ name: '张三' });
    await service.addTaskParticipant(person.id, { task_id: 'task-a' });

    expect((await service.getPersonProjects(person.id))[0]).toMatchObject({
      projectId: 'project-a',
      source: 'task_only',
      projectRole: null,
    });
    await expect(service.addTaskParticipant(person.id, { task_id: 'task-a' })).rejects.toThrow(
      '已参与此任务',
    );

    await service.addProjectParticipant(person.id, {
      project_id: 'project-a',
      role: ' 开发 ',
    });
    expect((await service.getPersonProjects(person.id))[0]).toMatchObject({
      source: 'both',
      projectRole: '开发',
    });
    await expect(
      service.addProjectParticipant(person.id, { project_id: 'project-a', role: '' }),
    ).rejects.toThrow('已加入此项目');
  });

  it('removes each relationship independently and person deletion preserves projects and tasks', async () => {
    const person = await service.createPerson({ name: '张三' });
    await service.addProjectParticipant(person.id, {
      project_id: 'project-a',
      role: '开发',
    });

    await service.addTaskParticipant(person.id, { task_id: 'task-a' });

    await service.removeTaskParticipant(person.id, 'task-a');
    expect(await service.getPersonProjects(person.id)).toEqual([
      expect.objectContaining({ projectId: 'project-a', source: 'project_only', tasks: [] }),
    ]);
    await service.deletePerson(person.id);

    expect(await createProjectRepository(db.executor).findById('project-a')).not.toBeNull();
    expect(await createTaskRepository(db.executor).findById('task-a')).not.toBeNull();
  });

  it('sets task participants without creating project participation and removes project links only', async () => {
    const person = await service.createPerson({ name: '独立成员' });
    await service.setTaskParticipants('task-a', [person.id]);

    expect(await service.listTaskParticipants(['task-a'])).toEqual([
      expect.objectContaining({ person_id: person.id }),
    ]);
    expect(await service.listProjectParticipants(['project-a'])).toEqual([]);

    await service.addProjectParticipant(person.id, { project_id: 'project-a', role: '' });
    expect(await service.countTaskAssignmentsInProject('project-a', person.id)).toBe(1);
    await service.removeProjectParticipant(person.id, 'project-a');

    expect(await service.listProjectParticipants(['project-a'])).toEqual([]);
    expect(await service.listTaskParticipants(['task-a'])).toEqual([
      expect.objectContaining({ person_id: person.id }),
    ]);
  });
});

describe('people participation grouping', () => {
  it('returns project_only, task_only, and both sources grouped by project', () => {
    const projects: PersonProjectParticipation[] = [
      {
        project_id: 'project-a',
        project_name: '甲项目',
        person_id: 'person-1',
        role: '产品',
        joined_at: NOW,
        project_status: 'active',
      },
      {
        project_id: 'project-c',
        project_name: '丙项目',
        person_id: 'person-1',
        role: '顾问',
        joined_at: NOW,
        project_status: 'active',
      },
    ];
    const tasks: PersonTaskParticipation[] = [
      {
        task_id: 'task-a',
        task_title: '设计',
        person_id: 'person-1',
        assigned_at: NOW,
        project_id: 'project-a',
        project_name: '甲项目',
        project_status: 'active',
        task_status: 'todo',
        task_priority: 'medium',
        task_due_date: null,
      },
      {
        task_id: 'task-b',
        task_title: '开发',
        person_id: 'person-1',
        assigned_at: NOW,
        project_id: 'project-b',
        project_name: '乙项目',
        project_status: 'active',
        task_status: 'todo',
        task_priority: 'medium',
        task_due_date: null,
      },
    ];

    const groups = groupPersonParticipation(projects, tasks);
    expect(groups).toHaveLength(3);
    expect(groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ projectId: 'project-a', source: 'both' }),
        expect.objectContaining({ projectId: 'project-b', source: 'task_only' }),
        expect.objectContaining({ projectId: 'project-c', source: 'project_only' }),
      ]),
    );
  });

  it('groups tasks without a project under the explicit unassigned bucket', () => {
    const task: PersonTaskParticipation = {
      task_id: 'orphan-task',
      task_title: '待归类',
      person_id: 'person-1',
      assigned_at: NOW,
      project_id: null,
      project_name: null,
      project_status: null,
      task_status: 'todo',
      task_priority: 'medium',
      task_due_date: null,
    };

    expect(groupPersonParticipation([], [task])).toEqual([
      {
        projectId: null,
        projectName: '未归属',
        projectStatus: null,
        source: 'task_only',
        projectRole: null,
        joinedAt: null,
        tasks: [
          {
            taskId: 'orphan-task',
            taskTitle: '待归类',
            status: 'todo',
            priority: 'medium',
            dueDate: null,
            assignedAt: NOW,
          },
        ],
      },
    ]);
  });
});
