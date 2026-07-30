import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskDetailPage } from '@/features/tasks/pages/TaskDetailPage';
import { setDbForTesting } from '@/lib/db';
import {
  createPeopleRepository,
  createProjectRepository,
  createTaskRepository,
} from '@/repositories';
import { makePerson, makeProject, makeTask, makeTaskParticipant } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb;

beforeEach(async () => {
  db = createTestDb();
  setDbForTesting(db.executor);
  const projects = createProjectRepository(db.executor);
  const tasks = createTaskRepository(db.executor);
  const people = createPeopleRepository(db.executor);
  await projects.insert(makeProject({ id: 'p1', name: '独立参与项目' }));
  await tasks.insert(makeTask({ id: 't1', project_id: 'p1', title: '独立参与任务' }));
  await people.insert(makePerson({ id: 'person-1', name: '李四' }));
  await people.insertTaskParticipant(makeTaskParticipant({ task_id: 't1', person_id: 'person-1' }));
});

afterEach(() => {
  setDbForTesting(null);
  db.close();
});

describe('TaskDetailPage', () => {
  it('shows a non-blocking non-project warning and adds project participation only on request', async () => {
    const user = userEvent.setup();
    const people = createPeopleRepository(db.executor);
    render(
      <MemoryRouter initialEntries={['/tasks/t1']}>
        <Routes>
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('独立参与任务')).toBeInTheDocument();
    expect(screen.getByText('该成员不是本项目参与人')).toBeInTheDocument();
    expect(await people.findProjectParticipant('p1', 'person-1')).toBeNull();

    await user.click(screen.getByRole('button', { name: '加入项目参与人' }));
    await waitFor(async () => {
      expect(await people.findProjectParticipant('p1', 'person-1')).not.toBeNull();
    });
    expect(await people.findTaskParticipant('t1', 'person-1')).not.toBeNull();
    expect(screen.queryByText('该成员不是本项目参与人')).toBeNull();
  });
});
