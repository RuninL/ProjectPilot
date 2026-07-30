import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createPeopleRepository,
  createProjectRepository,
  createTaskRepository,
} from '@/repositories';
import type { SqlExecutor } from '@/lib/db';
import {
  makePerson,
  makeProject,
  makeProjectParticipant,
  makeTask,
  makeTaskParticipant,
} from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb;

beforeEach(async () => {
  db = createTestDb();
  const projects = createProjectRepository(db.executor);
  const tasks = createTaskRepository(db.executor);
  const people = createPeopleRepository(db.executor);
  await projects.insert(makeProject({ id: 'p1', name: '甲项目' }));
  await projects.insert(makeProject({ id: 'p2', name: '乙项目' }));
  await tasks.insert(makeTask({ id: 't1', project_id: 'p1', title: '甲任务' }));
  await tasks.insert(makeTask({ id: 't2', project_id: 'p2', title: '乙任务' }));
  await people.insert(makePerson({ id: 'a', name: '甲' }));
  await people.insert(makePerson({ id: 'b', name: '乙' }));
  await people.insertProjectParticipant(
    makeProjectParticipant({ project_id: 'p1', person_id: 'a' }),
  );
  await people.insertProjectParticipant(
    makeProjectParticipant({ project_id: 'p2', person_id: 'b' }),
  );
  await people.insertTaskParticipant(makeTaskParticipant({ task_id: 't1', person_id: 'b' }));
  await people.insertTaskParticipant(makeTaskParticipant({ task_id: 't2', person_id: 'a' }));
});

afterEach(() => {
  db.close();
});

describe('participant OR filters', () => {
  it('filters projects only from project_participants and combines with other conditions', async () => {
    const projects = createProjectRepository(db.executor);
    expect(
      (await projects.findByQuery({ participantIds: ['a', 'b'], sort: 'name' }))
        .map((row) => row.id)
        .sort(),
    ).toEqual(['p1', 'p2']);
    expect(
      (await projects.findByQuery({ participantIds: ['a'], search: '甲' })).map((row) => row.id),
    ).toEqual(['p1']);
    expect(await projects.findByQuery({ participantIds: ['a'], search: '乙' })).toEqual([]);
  });

  it('filters tasks only from task_participants and combines with project filters', async () => {
    const tasks = createTaskRepository(db.executor);
    expect(
      (await tasks.findByQuery({ participantIds: ['a', 'b'], sort: 'title' }))
        .map((row) => row.id)
        .sort(),
    ).toEqual(['t1', 't2']);
    expect(
      (await tasks.findByQuery({ participantIds: ['a'], projectIds: ['p2'] })).map((row) => row.id),
    ).toEqual(['t2']);
    expect(await tasks.findByQuery({ participantIds: ['a'], projectIds: ['p1'] })).toEqual([]);
  });

  it('batch-loads participants with one query per relationship type', async () => {
    let selectCalls = 0;
    const executor: SqlExecutor = {
      select: <T>(query: string, bindValues?: unknown[]) => {
        selectCalls += 1;
        return db.executor.select<T>(query, bindValues);
      },
      execute: (query, bindValues) => db.executor.execute(query, bindValues),
    };
    const people = createPeopleRepository(executor);

    await people.findProjectParticipantsByProjectIds(['p1', 'p2']);
    expect(selectCalls).toBe(1);
    await people.findTaskParticipantsByTaskIds(['t1', 't2']);
    expect(selectCalls).toBe(2);
  });
});
