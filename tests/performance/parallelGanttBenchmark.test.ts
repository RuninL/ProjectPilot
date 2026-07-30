import { expect, it } from 'vitest';
import { buildParallelGanttViewModel } from '@/features/gantt/parallelGanttViewModel';
import { makeProject, makeTask } from '../helpers/fixtures';

it('builds a 30-project / 1000-task parallel gantt model under 100ms', () => {
  const projects = Array.from({ length: 30 }, (_, index) =>
    makeProject({
      id: `p${String(index)}`,
      start_date: '2026-01-01',
      target_end_date: '2027-12-31',
    }),
  );
  const tasks = Array.from({ length: 1000 }, (_, index) =>
    makeTask({
      id: `t${String(index)}`,
      project_id: `p${String(index % projects.length)}`,
      start_date: '2026-02-01',
      due_date: '2027-11-30',
      status: index % 8 === 0 ? 'done' : 'in_progress',
    }),
  );

  const started = performance.now();
  const model = buildParallelGanttViewModel({
    projects,
    tasks,
    today: '2026-07-30',
    filters: { statuses: [], hideCompleted: false, hidePostponed: false },
  });
  const elapsed = performance.now() - started;

  expect(model.rows).toHaveLength(30);
  expect(elapsed).toBeLessThan(100);
});
