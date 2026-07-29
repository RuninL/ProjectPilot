import type { DatabaseSnapshot } from '@/repositories/dataTransfer.repo';
import {
  createCompleteExport,
  createCompleteSnapshot,
  createTransferHarness,
  seedSnapshot,
} from '../helpers/dataTransferFixture';

type RawRow = Record<string, unknown>;
type RawData = Record<string, unknown>;
type RawExport = Record<string, unknown> & {
  data?: RawData;
  statistics?: Record<string, unknown>;
};

function rows(raw: RawExport, key: string): RawRow[] {
  const value = raw.data?.[key];
  if (!Array.isArray(value)) {
    throw new Error(`测试导出缺少 ${key} 数组`);
  }
  return value as RawRow[];
}

function rowAt(raw: RawExport, key: string, index: number): RawRow {
  const row = rows(raw, key)[index];
  if (row === undefined) {
    throw new Error(`测试导出缺少 ${key}[${String(index)}]`);
  }
  return row;
}

function addRow(raw: RawExport, key: string, row: RawRow): void {
  rows(raw, key).push(row);
  const count = raw.statistics?.[key];
  if (typeof count !== 'number') {
    throw new Error(`测试导出缺少 ${key} 统计`);
  }
  if (raw.statistics !== undefined) {
    raw.statistics[key] = count + 1;
  }
}

function cloneRow(row: RawRow): RawRow {
  return structuredClone(row);
}

describe('数据导入拒绝与零写入保证', () => {
  async function verifyRejected(
    change: (raw: RawExport) => void,
    expected: RegExp = /导入校验失败/,
  ): Promise<{ before: DatabaseSnapshot; after: DatabaseSnapshot; batchCalls: number }> {
    const harness = createTransferHarness();
    try {
      seedSnapshot(harness.db);
      const before = await harness.repository.readSnapshot();
      const exported = await createCompleteExport(harness.db);
      const raw = structuredClone(exported) as unknown as RawExport;
      change(raw);

      let caught: unknown;
      try {
        const parsed = harness.service.parseImport(JSON.stringify(raw));
        await harness.service.importData(parsed, 'replace');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toMatch(expected);
      const after = await harness.repository.readSnapshot();
      expect(after).toEqual(before);
      return { before, after, batchCalls: harness.runBatch.mock.calls.length };
    } finally {
      harness.db.close();
    }
  }

  async function verifyTextRejected(contents: string, expected: RegExp): Promise<void> {
    const harness = createTransferHarness();
    try {
      seedSnapshot(harness.db);
      const before = await harness.repository.readSnapshot();
      expect(() => harness.service.parseImport(contents)).toThrow(expected);
      expect(await harness.repository.readSnapshot()).toEqual(before);
      expect(harness.runBatch).not.toHaveBeenCalled();
    } finally {
      harness.db.close();
    }
  }

  it('拒绝不兼容的 schemaVersion', async () => {
    await verifyRejected((raw) => {
      raw.schemaVersion = 99;
    }, /不支持的数据版本/);
  });

  it('拒绝缺失的 schemaVersion', async () => {
    await verifyRejected((raw) => {
      delete raw.schemaVersion;
    }, /不支持的数据版本/);
  });

  it('数组中间任务枚举非法时，前置记录也绝不写入', async () => {
    const result = await verifyRejected((raw) => {
      rowAt(raw, 'tasks', 1).status = 'invalid-status';
    }, /导入校验失败/);

    expect(result.batchCalls).toBe(0);
    expect(result.after).toEqual(result.before);
  });

  it('拒绝不存在的日期', async () => {
    await verifyRejected((raw) => {
      rowAt(raw, 'tasks', 1).due_date = '2026-13-45';
    }, /日期必须为有效/);
  });

  it('拒绝任务缺少必填 title', async () => {
    await verifyRejected((raw) => {
      delete rowAt(raw, 'tasks', 1).title;
    });
  });

  it('拒绝数字类型的任务 title', async () => {
    await verifyRejected((raw) => {
      rowAt(raw, 'tasks', 1).title = 123;
    });
  });

  it('拒绝任务悬空 project_id', async () => {
    await verifyRejected((raw) => {
      rowAt(raw, 'tasks', 1).project_id = 'missing-project';
    }, /项目不存在/);
  });

  it('拒绝重复 task id', async () => {
    await verifyRejected((raw) => {
      const duplicate = cloneRow(rowAt(raw, 'tasks', 1));
      addRow(raw, 'tasks', duplicate);
    }, /任务 ID 存在重复/);
  });

  it('拒绝二元依赖环', async () => {
    await verifyRejected((raw) => {
      addRow(raw, 'taskDependencies', {
        ...cloneRow(rowAt(raw, 'taskDependencies', 0)),
        id: 'dependency-two-cycle',
        predecessor_id: 'task-child',
        successor_id: 'task-root',
      });
    }, /任务依赖存在环/);
  });

  it('拒绝三元依赖环', async () => {
    await verifyRejected((raw) => {
      addRow(raw, 'taskDependencies', {
        ...cloneRow(rowAt(raw, 'taskDependencies', 0)),
        id: 'dependency-three-cycle',
        predecessor_id: 'task-converted',
        successor_id: 'task-root',
      });
    }, /任务依赖存在环/);
  });

  it('拒绝任务自依赖', async () => {
    await verifyRejected((raw) => {
      addRow(raw, 'taskDependencies', {
        ...cloneRow(rowAt(raw, 'taskDependencies', 0)),
        id: 'dependency-self',
        predecessor_id: 'task-root',
        successor_id: 'task-root',
      });
    }, /任务依赖存在环/);
  });

  it('拒绝三层父子任务', async () => {
    await verifyRejected((raw) => {
      addRow(raw, 'tasks', {
        ...cloneRow(rowAt(raw, 'tasks', 1)),
        id: 'task-grandchild',
        parent_task_id: 'task-child',
      });
    }, /最多两层/);
  });

  it('拒绝两个行动项指向同一 converted_task_id', async () => {
    await verifyRejected((raw) => {
      addRow(raw, 'actionItems', {
        ...cloneRow(rowAt(raw, 'actionItems', 0)),
        id: 'action-duplicate-conversion',
      });
    }, /多个行动项/);
  });

  it('拒绝跨项目依赖', async () => {
    await verifyRejected((raw) => {
      addRow(raw, 'taskDependencies', {
        ...cloneRow(rowAt(raw, 'taskDependencies', 0)),
        id: 'dependency-cross-project',
        predecessor_id: 'task-root',
        successor_id: 'task-sample',
      });
    }, /跨越了不同项目/);
  });

  it('拒绝与可能性和影响不一致的风险等级', async () => {
    await verifyRejected((raw) => {
      const risk = rowAt(raw, 'risks', 0);
      risk.likelihood = 'low';
      risk.impact = 'low';
      risk.level = 'critical';
    }, /等级与可能性、影响不一致/);
  });

  it('拒绝非法风险状态枚举', async () => {
    await verifyRejected((raw) => {
      rowAt(raw, 'risks', 0).status = 'invalid-status';
    });
  });

  it('拒绝非对象 data 字段', async () => {
    await verifyRejected((raw) => {
      raw.data = 'not-an-object' as unknown as RawData;
    });
  });

  it('拒绝完全无效的 JSON 文本', async () => {
    await verifyTextRejected('{这不是 JSON', /JSON 文件格式无效/);
  });

  it('拒绝空字符串', async () => {
    await verifyTextRejected('', /JSON 文件格式无效/);
  });

  it('拒绝里程碑悬空 project_id', async () => {
    await verifyRejected((raw) => {
      rowAt(raw, 'milestones', 0).project_id = 'missing-project';
    }, /里程碑 .* 的项目不存在/);
  });

  it('拒绝行动项悬空 meeting_id', async () => {
    await verifyRejected((raw) => {
      rowAt(raw, 'actionItems', 0).meeting_id = 'missing-meeting';
    }, /行动项 .* 的会议不存在/);
  });

  it('完整夹具满足约定的多实体结构', () => {
    const snapshot = createCompleteSnapshot();
    expect(snapshot.projects).toHaveLength(2);
    expect(snapshot.tasks).toHaveLength(4);
    expect(snapshot.taskDependencies).toHaveLength(2);
    expect(snapshot.milestones).toHaveLength(2);
    expect(snapshot.meetings).toHaveLength(2);
    expect(snapshot.actionItems).toHaveLength(4);
    expect(snapshot.risks).toHaveLength(2);
    expect(snapshot.appSettings.length).toBeGreaterThan(1);
  });
});
