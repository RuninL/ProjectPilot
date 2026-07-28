import { describe, expect, it } from 'vitest';
import {
  buildDependencyGraph,
  deriveBlockedRisks,
  findScheduleConflicts,
  hasCycle,
  isReachable,
  predecessorsOf,
  successorsOf,
  topologicalOrder,
  wouldCreateCycle,
  type GraphEdgeInput,
  type GraphTask,
} from '@/services/dependencyGraph';

/**
 * The graph module is pure, so these tests hand in plain rows — no database, no
 * React. Shapes covered: empty, isolated, chain, fork, join, diamond, multiple
 * predecessors/successors and every flavour of cycle.
 */

function task(id: string, overrides: Partial<GraphTask> = {}): GraphTask {
  return {
    id,
    status: 'todo',
    archived_at: null,
    start_date: null,
    due_date: null,
    ...overrides,
  };
}

function edge(predecessorId: string, successorId: string): GraphEdgeInput {
  return {
    id: `${predecessorId}->${successorId}`,
    predecessor_id: predecessorId,
    successor_id: successorId,
  };
}

function graphOf(ids: readonly string[], pairs: readonly [string, string][]) {
  return buildDependencyGraph(
    ids.map((id) => task(id)),
    pairs.map(([from, to]) => edge(from, to)),
  );
}

describe('buildDependencyGraph', () => {
  it('handles the empty graph', () => {
    const graph = buildDependencyGraph([], []);

    expect(graph.nodeIds).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(topologicalOrder(graph)).toEqual({ order: [], cyclic: [], hasCycle: false });
    expect(findScheduleConflicts(graph)).toEqual([]);
    expect(deriveBlockedRisks(graph)).toEqual([]);
  });

  it('keeps isolated nodes as nodes with no edges', () => {
    const graph = graphOf(['a', 'b', 'c'], []);

    expect(graph.nodeIds).toEqual(['a', 'b', 'c']);
    expect(successorsOf(graph, 'a')).toEqual([]);
    expect(predecessorsOf(graph, 'a')).toEqual([]);
    expect(topologicalOrder(graph).order).toEqual(['a', 'b', 'c']);
  });

  it('drops edges whose endpoints are outside the loaded task set', () => {
    const graph = buildDependencyGraph(
      [task('a'), task('b')],
      [edge('a', 'b'), edge('a', 'elsewhere'), edge('elsewhere', 'b')],
    );

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.id).toBe('a->b');
    expect(graph.nodes.has('elsewhere')).toBe(false);
  });

  it('ignores duplicate task rows and preserves first-seen order', () => {
    const graph = buildDependencyGraph([task('b'), task('a'), task('b')], []);

    expect(graph.nodeIds).toEqual(['b', 'a']);
    expect(graph.nodes.size).toBe(2);
  });

  it('records multiple predecessors and multiple successors in edge order', () => {
    const graph = graphOf(
      ['a', 'b', 'hub', 'x', 'y'],
      [
        ['a', 'hub'],
        ['b', 'hub'],
        ['hub', 'x'],
        ['hub', 'y'],
      ],
    );

    expect(predecessorsOf(graph, 'hub')).toEqual(['a', 'b']);
    expect(successorsOf(graph, 'hub')).toEqual(['x', 'y']);
  });
});

describe('isReachable', () => {
  it('follows a long chain', () => {
    const ids = ['n0', 'n1', 'n2', 'n3', 'n4', 'n5'];
    const graph = graphOf(ids, [
      ['n0', 'n1'],
      ['n1', 'n2'],
      ['n2', 'n3'],
      ['n3', 'n4'],
      ['n4', 'n5'],
    ]);

    expect(isReachable(graph, 'n0', 'n5')).toBe(true);
    expect(isReachable(graph, 'n5', 'n0')).toBe(false);
  });

  it('does not treat a node as reaching itself without a real path back', () => {
    const graph = graphOf(['a', 'b'], [['a', 'b']]);

    expect(isReachable(graph, 'a', 'a')).toBe(false);
  });

  it('reports a node as reaching itself when a cycle leads back', () => {
    const graph = graphOf(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'a'],
      ],
    );

    expect(isReachable(graph, 'a', 'a')).toBe(true);
  });

  it('returns false for unknown nodes instead of throwing', () => {
    const graph = graphOf(['a'], []);

    expect(isReachable(graph, 'a', 'ghost')).toBe(false);
    expect(isReachable(graph, 'ghost', 'a')).toBe(false);
  });

  it('terminates on a cyclic graph', () => {
    const graph = graphOf(
      ['a', 'b'],
      [
        ['a', 'b'],
        ['b', 'a'],
      ],
    );

    expect(isReachable(graph, 'a', 'b')).toBe(true);
  });
});

describe('wouldCreateCycle', () => {
  it('rejects a self edge', () => {
    const graph = graphOf(['a'], []);

    expect(wouldCreateCycle(graph, 'a', 'a')).toBe(true);
  });

  it('rejects the direct reverse of an existing edge', () => {
    const graph = graphOf(['a', 'b'], [['a', 'b']]);

    expect(wouldCreateCycle(graph, 'b', 'a')).toBe(true);
  });

  it('rejects closing a three-node chain: A -> B -> C then C -> A', () => {
    const graph = graphOf(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    );

    expect(wouldCreateCycle(graph, 'c', 'a')).toBe(true);
  });

  it('rejects closing a cycle through a fork and a join', () => {
    // a splits into b and c, both converge on d.
    const graph = graphOf(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b'],
        ['a', 'c'],
        ['b', 'd'],
        ['c', 'd'],
      ],
    );

    expect(wouldCreateCycle(graph, 'd', 'a')).toBe(true);
    expect(wouldCreateCycle(graph, 'd', 'b')).toBe(true);
  });

  it('rejects closing a long chain from the far end', () => {
    const ids = Array.from({ length: 12 }, (_, index) => `n${String(index)}`);
    const pairs = ids
      .slice(0, -1)
      .map((id, index) => [id, ids[index + 1] as string] as [string, string]);
    const graph = graphOf(ids, pairs);

    expect(wouldCreateCycle(graph, 'n11', 'n0')).toBe(true);
    expect(wouldCreateCycle(graph, 'n11', 'n5')).toBe(true);
  });

  it('allows an edge that only adds a new join', () => {
    const graph = graphOf(['a', 'b', 'c'], [['a', 'b']]);

    expect(wouldCreateCycle(graph, 'c', 'b')).toBe(false);
    expect(wouldCreateCycle(graph, 'a', 'c')).toBe(false);
  });

  it('allows a parallel path that shortcuts an existing chain', () => {
    const graph = graphOf(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    );

    expect(wouldCreateCycle(graph, 'a', 'c')).toBe(false);
  });
});

describe('topologicalOrder', () => {
  it('orders a chain', () => {
    const graph = graphOf(
      ['c', 'a', 'b'],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    );

    expect(topologicalOrder(graph).order).toEqual(['a', 'b', 'c']);
    expect(hasCycle(graph)).toBe(false);
  });

  it('breaks ties by input order, not by hash order', () => {
    const graph = graphOf(['z', 'y', 'x'], []);

    expect(topologicalOrder(graph).order).toEqual(['z', 'y', 'x']);
  });

  it('is stable across repeated runs and across edge insertion order', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const first = topologicalOrder(
      graphOf(ids, [
        ['a', 'c'],
        ['b', 'c'],
        ['c', 'd'],
        ['c', 'e'],
      ]),
    ).order;
    const second = topologicalOrder(
      graphOf(ids, [
        ['c', 'e'],
        ['b', 'c'],
        ['c', 'd'],
        ['a', 'c'],
      ]),
    ).order;

    expect(first).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(second).toEqual(first);
  });

  it('places every node of a diamond after its predecessors', () => {
    const graph = graphOf(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b'],
        ['a', 'c'],
        ['b', 'd'],
        ['c', 'd'],
      ],
    );
    const { order } = topologicalOrder(graph);

    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
  });

  it('reports the cyclic remainder and still orders the acyclic part', () => {
    const graph = graphOf(
      ['free', 'a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'a'],
      ],
    );
    const result = topologicalOrder(graph);

    expect(result.hasCycle).toBe(true);
    expect(result.order).toEqual(['free']);
    expect(result.cyclic).toEqual(['a', 'b', 'c']);
  });

  it('counts nodes downstream of a cycle as unplaceable', () => {
    const graph = graphOf(
      ['a', 'b', 'tail'],
      [
        ['a', 'b'],
        ['b', 'a'],
        ['b', 'tail'],
      ],
    );

    expect(topologicalOrder(graph).cyclic).toEqual(['a', 'b', 'tail']);
  });
});

describe('deriveBlockedRisks', () => {
  it('propagates risk from a blocked predecessor down the whole chain', () => {
    const graph = buildDependencyGraph(
      [task('a', { status: 'blocked' }), task('b'), task('c')],
      [edge('a', 'b'), edge('b', 'c')],
    );

    expect(deriveBlockedRisks(graph)).toEqual([
      { taskId: 'b', blockedBy: ['a'] },
      { taskId: 'c', blockedBy: ['a'] },
    ]);
  });

  it('does not mark the blocked task itself', () => {
    const graph = buildDependencyGraph(
      [task('a', { status: 'blocked' }), task('b')],
      [edge('a', 'b')],
    );
    const risks = deriveBlockedRisks(graph);

    expect(risks.map((risk) => risk.taskId)).toEqual(['b']);
  });

  it('names every blocked upstream task in node order', () => {
    const graph = buildDependencyGraph(
      [task('a', { status: 'blocked' }), task('b', { status: 'blocked' }), task('c')],
      [edge('a', 'c'), edge('b', 'c')],
    );

    expect(deriveBlockedRisks(graph)).toEqual([{ taskId: 'c', blockedBy: ['a', 'b'] }]);
  });

  it('disappears once the predecessor is un-blocked — nothing is stored', () => {
    const blocked = buildDependencyGraph(
      [task('a', { status: 'blocked' }), task('b')],
      [edge('a', 'b')],
    );
    const recovered = buildDependencyGraph(
      [task('a', { status: 'in_progress' }), task('b')],
      [edge('a', 'b')],
    );

    expect(deriveBlockedRisks(blocked)).toHaveLength(1);
    expect(deriveBlockedRisks(recovered)).toEqual([]);
  });

  it('propagates nothing from an archived blocked predecessor', () => {
    const graph = buildDependencyGraph(
      [task('a', { status: 'blocked', archived_at: '2026-07-01T00:00:00Z' }), task('b')],
      [edge('a', 'b')],
    );

    expect(deriveBlockedRisks(graph)).toEqual([]);
  });

  it('skips downstream tasks that are done, cancelled or archived', () => {
    const graph = buildDependencyGraph(
      [
        task('a', { status: 'blocked' }),
        task('done', { status: 'done' }),
        task('cancelled', { status: 'cancelled' }),
        task('archived', { archived_at: '2026-07-01T00:00:00Z' }),
        task('open'),
      ],
      [edge('a', 'done'), edge('a', 'cancelled'), edge('a', 'archived'), edge('a', 'open')],
    );

    expect(deriveBlockedRisks(graph).map((risk) => risk.taskId)).toEqual(['open']);
  });

  it('still reaches past a done intermediate task', () => {
    const graph = buildDependencyGraph(
      [task('a', { status: 'blocked' }), task('mid', { status: 'done' }), task('tail')],
      [edge('a', 'mid'), edge('mid', 'tail')],
    );

    expect(deriveBlockedRisks(graph).map((risk) => risk.taskId)).toEqual(['tail']);
  });

  it('terminates on a cyclic graph', () => {
    const graph = buildDependencyGraph(
      [task('a', { status: 'blocked' }), task('b')],
      [edge('a', 'b'), edge('b', 'a')],
    );

    expect(deriveBlockedRisks(graph).map((risk) => risk.taskId)).toEqual(['b']);
  });
});

describe('findScheduleConflicts', () => {
  it('reports a predecessor that finishes after its successor starts', () => {
    const graph = buildDependencyGraph(
      [task('a', { due_date: '2026-08-10' }), task('b', { start_date: '2026-08-05' })],
      [edge('a', 'b')],
    );

    expect(findScheduleConflicts(graph)).toEqual([
      {
        edgeId: 'a->b',
        predecessorId: 'a',
        successorId: 'b',
        predecessorDueDate: '2026-08-10',
        successorStartDate: '2026-08-05',
      },
    ]);
  });

  it('disappears when the dates are corrected', () => {
    const graph = buildDependencyGraph(
      [task('a', { due_date: '2026-08-01' }), task('b', { start_date: '2026-08-05' })],
      [edge('a', 'b')],
    );

    expect(findScheduleConflicts(graph)).toEqual([]);
  });

  it('treats finishing exactly on the start date as no conflict', () => {
    const graph = buildDependencyGraph(
      [task('a', { due_date: '2026-08-05' }), task('b', { start_date: '2026-08-05' })],
      [edge('a', 'b')],
    );

    expect(findScheduleConflicts(graph)).toEqual([]);
  });

  it('invents no conflict when either date is missing', () => {
    const noDue = buildDependencyGraph(
      [task('a'), task('b', { start_date: '2026-08-05' })],
      [edge('a', 'b')],
    );
    const noStart = buildDependencyGraph(
      [task('a', { due_date: '2026-08-10' }), task('b')],
      [edge('a', 'b')],
    );

    expect(findScheduleConflicts(noDue)).toEqual([]);
    expect(findScheduleConflicts(noStart)).toEqual([]);
  });

  it('reports each offending edge of a join separately', () => {
    const graph = buildDependencyGraph(
      [
        task('a', { due_date: '2026-08-20' }),
        task('b', { due_date: '2026-08-21' }),
        task('c', { start_date: '2026-08-01' }),
      ],
      [edge('a', 'c'), edge('b', 'c')],
    );

    expect(findScheduleConflicts(graph).map((conflict) => conflict.edgeId)).toEqual([
      'a->c',
      'b->c',
    ]);
  });
});

describe('performance on a large project graph', () => {
  it('builds, sorts, derives and checks a 1000-task chain-and-fork graph quickly', () => {
    const count = 1000;
    const tasks: GraphTask[] = Array.from({ length: count }, (_, index) =>
      task(`n${String(index)}`, {
        status: index === 0 ? 'blocked' : 'todo',
        // Every edge overruns: each task starts before its predecessor is due.
        start_date: '2026-08-01',
        due_date: '2026-08-05',
      }),
    );
    // A spine plus a fork off every tenth node: ~1100 edges.
    const edges: GraphEdgeInput[] = [];
    for (let index = 1; index < count; index += 1) {
      edges.push(edge(`n${String(index - 1)}`, `n${String(index)}`));
      if (index % 10 === 0 && index + 5 < count) {
        edges.push(edge(`n${String(index)}`, `n${String(index + 5)}`));
      }
    }

    const started = performance.now();
    const graph = buildDependencyGraph(tasks, edges);
    const order = topologicalOrder(graph);
    const risks = deriveBlockedRisks(graph);
    const conflicts = findScheduleConflicts(graph);
    const cycleCheck = wouldCreateCycle(graph, `n${String(count - 1)}`, 'n0');
    const elapsed = performance.now() - started;

    expect(graph.nodeIds).toHaveLength(count);
    expect(graph.edges.length).toBeGreaterThan(count);
    expect(order.hasCycle).toBe(false);
    expect(order.order).toHaveLength(count);
    expect(risks).toHaveLength(count - 1);
    expect(conflicts).toHaveLength(graph.edges.length);
    expect(cycleCheck).toBe(true);
    // Generous ceiling: the measured run is ~1-2 orders of magnitude below it.
    expect(elapsed).toBeLessThan(2000);
  });
});
