import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { filterMeetingTaskCandidates } from '@/features/meetings/components/MeetingTaskSelector';
import type { SqlExecutor } from '@/lib/db';
import {
  createDataTransferRepository,
  createMeetingRepository,
  createProjectRepository,
  createTaskMeetingRepository,
  createTaskRepository,
} from '@/repositories';
import type { TaskWithProject } from '@/types';
import { makeMeeting, makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb | null = null;

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

describe('task-meeting performance benchmark', () => {
  afterEach(() => {
    db?.close();
    db = null;
  });

  it('uses indexed single-query reads with 1000 tasks, 1000 meetings and 20000 links', async () => {
    db = createTestDb();
    const projects = createProjectRepository(db.executor);
    const tasks = createTaskRepository(db.executor);
    const meetings = createMeetingRepository(db.executor);
    await projects.insert(makeProject());
    for (let index = 0; index < 1_000; index += 1) {
      await tasks.insert(makeTask({ id: `t-${String(index)}`, title: `任务 ${String(index)}` }));
      await meetings.insert(
        makeMeeting({ id: `m-${String(index)}`, topic: `会议 ${String(index)}` }),
      );
    }
    const insertLink = db.raw.prepare(
      'INSERT INTO task_meetings (task_id, meeting_id, linked_at) VALUES (?, ?, ?)',
    );
    db.raw.transaction(() => {
      for (let taskIndex = 0; taskIndex < 1_000; taskIndex += 1) {
        for (let offset = 0; offset < 20; offset += 1) {
          insertLink.run(
            `t-${String(taskIndex)}`,
            `m-${String((taskIndex * 37 + offset) % 1_000)}`,
            '2026-08-01T00:00:00Z',
          );
        }
      }
    })();

    let selectCount = 0;
    const counted: SqlExecutor = {
      select: <T>(query: string, bindValues?: unknown[]) => {
        selectCount += 1;
        return db?.executor.select<T>(query, bindValues) ?? Promise.reject(new Error('closed'));
      },
      execute: (query, bindValues) =>
        db?.executor.execute(query, bindValues) ?? Promise.reject(new Error('closed')),
    };
    const repository = createTaskMeetingRepository(counted);
    const taskSamples: number[] = [];
    const meetingSamples: number[] = [];
    for (let index = 0; index < 50; index += 1) {
      let started = performance.now();
      expect(await repository.findMeetingsByTask('t-500')).toHaveLength(20);
      taskSamples.push(performance.now() - started);
      started = performance.now();
      expect((await repository.findTasksByMeeting('m-500')).length).toBeGreaterThan(0);
      meetingSamples.push(performance.now() - started);
    }
    expect(selectCount).toBe(100);

    const taskPlan = db.raw
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT m.* FROM task_meetings tm JOIN meetings m ON m.id = tm.meeting_id
         WHERE tm.task_id = ? ORDER BY tm.linked_at ASC, m.id ASC`,
      )
      .all('t-500') as { detail: string }[];
    const meetingPlan = db.raw
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT t.*, p.name AS project_name, p.color AS project_color, p.status AS project_status
         FROM task_meetings tm JOIN tasks t ON t.id = tm.task_id
         JOIN projects p ON p.id = t.project_id
         WHERE tm.meeting_id = ? ORDER BY tm.linked_at ASC, t.id ASC`,
      )
      .all('m-500') as { detail: string }[];
    expect(taskPlan.some((row) => row.detail.includes('idx_task_meetings_task'))).toBe(true);
    expect(meetingPlan.some((row) => row.detail.includes('idx_task_meetings_meeting'))).toBe(true);
    console.info(
      `task-meeting benchmark: links=20000 task-read-median=${median(taskSamples).toFixed(3)}ms meeting-read-median=${median(meetingSamples).toFixed(3)}ms`,
    );
    console.info('task plan:', taskPlan.map((row) => row.detail).join(' | '));
    console.info('meeting plan:', meetingPlan.map((row) => row.detail).join(' | '));
  });

  it.each([100, 500, 1_000])('measures local candidate search across %i tasks', (size) => {
    const candidates: TaskWithProject[] = Array.from({ length: size }, (_, index) => ({
      ...makeTask({ id: `t-${String(index)}`, title: `性能任务 ${String(index)}` }),
      project_name: `项目 ${String(index % 10)}`,
      project_color: '#123456',
      project_status: 'active',
    }));
    const samples: number[] = [];
    for (let index = 0; index < 100; index += 1) {
      const started = performance.now();
      filterMeetingTaskCandidates(candidates, ['t-1', 't-2'], 'active', '性能任务 9');
      samples.push(performance.now() - started);
    }
    console.info(`candidate search: size=${String(size)} median=${median(samples).toFixed(3)}ms`);
    expect(filterMeetingTaskCandidates(candidates, ['t-1', 't-2'], 'active', '')).toHaveLength(
      Math.min(100, size - Math.min(2, size)),
    );
  });

  it('starts all snapshot reads without serial IPC waits', async () => {
    let activeSelects = 0;
    let maxActiveSelects = 0;
    const delayed: SqlExecutor = {
      select: <T>() =>
        new Promise<T>((resolve) => {
          activeSelects += 1;
          maxActiveSelects = Math.max(maxActiveSelects, activeSelects);
          setTimeout(() => {
            activeSelects -= 1;
            resolve([] as T);
          }, 1);
        }),
      execute: () => Promise.resolve({ rowsAffected: 0 }),
    };
    await createDataTransferRepository(delayed).readSnapshot();
    expect(maxActiveSelects).toBe(18);
  });
});
