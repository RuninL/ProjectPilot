import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { PersonDetailPage } from '@/features/people/pages/PersonDetailPage';
import { setDbForTesting } from '@/lib/db';
import { getRepositories } from '@/repositories';
import {
  makePerson,
  makeProject,
  makeProjectParticipant,
  makeTask,
  makeTaskParticipant,
} from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb | null = null;

afterEach(() => {
  setDbForTesting(null);
  db?.close();
  db = null;
});

describe('PersonDetailPage', () => {
  it('renders two levels, source labels, and independently expanded projects', async () => {
    db = createTestDb();
    setDbForTesting(db.executor);
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'p1', name: '甲项目', status: 'active' }));
    await repos.projects.insert(makeProject({ id: 'p2', name: '乙项目', status: 'postponed' }));
    await repos.tasks.insert(
      makeTask({
        id: 'task-2',
        project_id: 'p2',
        title: '原型设计',
        status: 'in_progress',
        priority: 'high',
        due_date: '2026-08-01',
      }),
    );
    await repos.people.insert(makePerson({ id: 'person-1', name: '林然' }));
    await repos.people.insertProjectParticipant(makeProjectParticipant({ project_id: 'p1' }));
    await repos.people.insertTaskParticipant(makeTaskParticipant({ task_id: 'task-2' }));

    render(
      <MemoryRouter initialEntries={['/people/person-1']}>
        <Routes>
          <Route path="/people/:id" element={<PersonDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const user = userEvent.setup();

    expect(await screen.findByText('项目参与')).toBeInTheDocument();
    expect(screen.getByText('仅任务参与')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '展开 甲项目' }));
    await user.click(screen.getByRole('button', { name: '展开 乙项目' }));

    expect(screen.getByText('已参与项目，但尚未分配该项目下的任务。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '原型设计' })).toHaveAttribute('href', '/tasks/task-2');
    expect(screen.getByText('高')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起 甲项目' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起 乙项目' })).toBeInTheDocument();
  });
});
