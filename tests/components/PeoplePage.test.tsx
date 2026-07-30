import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { PeoplePage } from '@/features/people/pages/PeoplePage';
import { setDbForTesting } from '@/lib/db';
import { getRepositories } from '@/repositories';
import { makePerson, makeProject, makeProjectParticipant, makeTask, makeTaskParticipant } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb | null = null;

afterEach(() => {
  setDbForTesting(null);
  db?.close();
  db = null;
});

function renderWithDb() {
  db = createTestDb();
  setDbForTesting(db.executor);
  render(
    <MemoryRouter>
      <PeoplePage />
    </MemoryRouter>,
  );
}

describe('PeoplePage', () => {
  it('searches, creates, edits, and confirms deletion with relationship counts', async () => {
    renderWithDb();
    const user = userEvent.setup();
    const repos = await getRepositories();
    await repos.projects.insert(makeProject({ id: 'project-1' }));
    await repos.tasks.insert(makeTask({ id: 'task-1', project_id: 'project-1' }));
    await repos.people.insert(
      makePerson({ id: 'person-1', name: '林然', email: 'lin@example.com', role: '设计师' }),
    );
    await repos.people.insertProjectParticipant(makeProjectParticipant({ project_id: 'project-1' }));
    await repos.people.insertTaskParticipant(makeTaskParticipant({ task_id: 'task-1' }));

    await user.type(screen.getByLabelText('搜索人物'), '设计');
    expect(await screen.findByText('林然')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('搜索人物'));

    await user.click(screen.getByRole('button', { name: '新建人员' }));
    await user.type(screen.getByLabelText('姓名'), '周敏');
    await user.type(screen.getByLabelText('角色'), '产品');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('周敏')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '编辑 周敏' }));
    await user.clear(screen.getByLabelText('角色'));
    await user.type(screen.getByLabelText('角色'), '负责人');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('负责人')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删除 林然' }));
    expect(
      await screen.findByText(/将解除 1 个项目参与关系和 1 个任务参与关系/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => {
      expect(screen.queryByText('林然')).not.toBeInTheDocument();
    });
  });
});
