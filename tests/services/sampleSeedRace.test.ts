import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchStatement } from '@/lib/commands';
import { setDbForTesting } from '@/lib/db';
import {
  createAppSettingRepository,
  createProjectRepository,
  createSampleDataRepository,
  createTaskRepository,
} from '@/repositories';
import {
  createSampleDataService,
  ensureSampleDataSeeded,
  resetSampleSeedGuardForTesting,
  SAMPLE_PROJECT_ID,
  SAMPLE_SEEDED_KEY,
  type SampleDataService,
} from '@/services/sampleData.service';
import { createTestDb, type TestDb } from '../helpers/testDb';

/**
 * Regression cover for duplicate sample seeding: StrictMode double-mounts the
 * bootstrap effect, so two seed calls overlap and both read `sample_seeded` as
 * absent. Both defences are exercised here — the shared bootstrap promise, and
 * the fixed primary keys that make a duplicate impossible to commit.
 */

let db: TestDb | null = null;

// `ensureSampleDataSeeded` goes through the real `executeBatch` wrapper, so the
// Tauri command underneath is what gets replaced. The batch lands in the test's
// in-memory SQLite with the same single-transaction semantics as the Rust side.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: { statements?: BatchStatement[] }) => {
    if (command !== 'execute_batch') {
      return Promise.reject(new Error(`unexpected command: ${command}`));
    }
    if (db === null || args?.statements === undefined) {
      return Promise.reject(new Error('test database not installed'));
    }
    return Promise.resolve(db.runBatch(args.statements));
  },
}));

function currentDb(): TestDb {
  if (db === null) throw new Error('test database not installed');
  return db;
}

beforeEach(() => {
  db = createTestDb();
  setDbForTesting(db.executor);
  resetSampleSeedGuardForTesting();
});

afterEach(() => {
  setDbForTesting(null);
  db?.close();
  db = null;
});

function countRows(table: string, where = '1 = 1'): number {
  const row = currentDb().raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get();
  return (row as { n: number }).n;
}

/**
 * A service whose `sample_seeded` lookup always comes back empty — the exact
 * state a racing second caller observes before the first caller's transaction
 * commits. Modelling the race this way keeps the test deterministic instead of
 * depending on microtask ordering.
 */
function createRacingService(): SampleDataService {
  const executor = currentDb().executor;
  return createSampleDataService({
    projects: createProjectRepository(executor),
    tasks: createTaskRepository(executor),
    appSettings: { ...createAppSettingRepository(executor), get: () => Promise.resolve(null) },
    sample: createSampleDataRepository(executor),
    runBatch: (statements) => Promise.resolve(currentDb().runBatch(statements)),
  });
}

describe('ensureSampleDataSeeded', () => {
  it('hands a concurrent second caller the very same in-flight promise', async () => {
    const first = ensureSampleDataSeeded();
    const second = ensureSampleDataSeeded();

    expect(second).toBe(first);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it('seeds exactly one project when the bootstrap effect runs twice', async () => {
    await Promise.all([ensureSampleDataSeeded(), ensureSampleDataSeeded()]);

    expect(countRows('projects', 'is_sample = 1')).toBe(1);
    expect(countRows('tasks', 'is_sample = 1')).toBe(3);
  });

  it('reports no seeding on a later call once the flag is stored', async () => {
    await ensureSampleDataSeeded();
    resetSampleSeedGuardForTesting();

    expect(await ensureSampleDataSeeded()).toBe(false);
    expect(countRows('projects', 'is_sample = 1')).toBe(1);
  });
});

describe('fixed sample ids as the database-level backstop', () => {
  it('gives the sample project its fixed id rather than a random one', async () => {
    await ensureSampleDataSeeded();

    expect(countRows('projects', `id = '${SAMPLE_PROJECT_ID}'`)).toBe(1);
  });

  it('rejects a second concurrent seed on the primary key and rolls it back whole', async () => {
    const first = createRacingService();
    const second = createRacingService();

    expect(await first.seedSampleData()).toBe(true);
    await expect(second.seedSampleData()).rejects.toThrow(/UNIQUE constraint failed: projects\.id/);

    expect(countRows('projects', 'is_sample = 1')).toBe(1);
    expect(countRows('tasks', 'is_sample = 1')).toBe(3);
  });

  it('leaves the seeded flag intact after the losing batch rolls back', async () => {
    await createRacingService().seedSampleData();
    await expect(createRacingService().seedSampleData()).rejects.toThrow();

    const flag = await createAppSettingRepository(currentDb().executor).get(SAMPLE_SEEDED_KEY);
    expect(flag?.value).toBe('1');
  });

  it('still clears every sample row, fixed ids included', async () => {
    const service = createRacingService();
    await service.seedSampleData();

    await service.clearSampleData();

    expect(countRows('projects', 'is_sample = 1')).toBe(0);
    expect(countRows('tasks', 'is_sample = 1')).toBe(0);
  });

  it('does not resurrect the sample project after a clear, even with stable ids', async () => {
    await ensureSampleDataSeeded();
    await createRacingService().clearSampleData();
    resetSampleSeedGuardForTesting();

    expect(await ensureSampleDataSeeded()).toBe(false);
    expect(countRows('projects')).toBe(0);
  });
});
