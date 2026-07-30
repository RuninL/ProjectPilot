import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectParticipantsSection } from '@/features/people/components/ProjectParticipantsSection';
import { setDbForTesting } from '@/lib/db';
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
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb;

beforeEach(async () => {
  db = createTestDb();
  setDbForTesting(db.executor);
  const projects = createProjectRepository(db.executor);
  const tasks = createTaskRepository(db.executor);
  const people = createPeopleRepository(db.executor);
  await projects.insert(makeProject({ id: 'p1' }));
  await tasks.insert(makeTask({ id: 't1', project_id: 'p1' }));
  await people.insert(makePerson({ id: 'person-1', name: '张三' }));
  await people.insertProjectParticipant(
    makeProjectParticipant({ project_id: 'p1', person_id: 'person-1' }),
  );
  await people.insertTaskParticipant(makeTaskParticipant({ task_id: 't1', person_id: 'person-1' }));
});

afterEach(() => {
  setDbForTesting(null);
  db.close();
});

describe('ProjectParticipantsSection', () => {
  it('warns about affected tasks and removes only project participation after confirmation', async () => {
    const user = userEvent.setup();
    const people = createPeopleRepository(db.executor);
    render(<ProjectParticipantsSection projectId="p1" />);

    const personButton = await screen.findByRole('button', { name: '张三' });
    expect(personButton).toHaveAttribute('aria-pressed', 'true');
    await user.click(personButton);

    expect(
      await screen.findByText(
        '张三 仍分配到本项目的 1 个任务。移除项目参与关系不会移除任何任务分配，请另行处理。',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '仅从项目移除' }));

    await waitFor(async () => {
      expect(await people.findProjectParticipant('p1', 'person-1')).toBeNull();
    });
    expect(await people.findTaskParticipant('t1', 'person-1')).not.toBeNull();
  });
});
