import type { Task, TaskDependency } from '@/types';

/**
 * Finish-to-start dependency graph, as pure data and pure functions.
 *
 * Edge direction is fixed application-wide:
 *
 *     predecessor -> successor
 *
 * meaning the successor may only start once the predecessor has finished, so a
 * predecessor's `due_date` should not fall after its successor's `start_date`.
 *
 * Nothing here touches React, Zustand, SQLite or the DOM: callers hand in plain
 * rows and get plain results back, which is what keeps cycle detection, blocked
 * derivation and conflict detection unit-testable and independent of the Gantt
 * renderer. Per architecture.md §4 the graph lives in frontend memory; SQLite
 * only persists the edges.
 */

/** The task fields the graph needs. `Task` satisfies this structurally. */
export type GraphTask = Pick<Task, 'id' | 'status' | 'archived_at' | 'start_date' | 'due_date'>;

/** The dependency fields the graph needs. `TaskDependency` satisfies this. */
export type GraphEdgeInput = Pick<TaskDependency, 'id' | 'predecessor_id' | 'successor_id'>;

export interface GraphEdge {
  id: string;
  predecessorId: string;
  successorId: string;
}

export interface DependencyGraph {
  /** Node ids in input order. That order is the tie-break for topological sort. */
  readonly nodeIds: readonly string[];
  readonly nodes: ReadonlyMap<string, GraphTask>;
  /** Edges whose endpoints are both present, in input order. */
  readonly edges: readonly GraphEdge[];
  readonly successors: ReadonlyMap<string, readonly string[]>;
  readonly predecessors: ReadonlyMap<string, readonly string[]>;
}

export interface TopologicalOrder {
  /** A legal execution order. Nodes inside or downstream of a cycle are absent. */
  readonly order: readonly string[];
  /** Nodes the sort could not place, i.e. the cyclic remainder. Empty when acyclic. */
  readonly cyclic: readonly string[];
  readonly hasCycle: boolean;
}

export interface ScheduleConflict {
  readonly edgeId: string;
  readonly predecessorId: string;
  readonly successorId: string;
  /** The predecessor due date that overruns the successor start date. */
  readonly predecessorDueDate: string;
  readonly successorStartDate: string;
}

export interface BlockedRisk {
  /** The unfinished successor that inherits the risk. */
  readonly taskId: string;
  /** Blocked upstream tasks it is reachable from, in input order. */
  readonly blockedBy: readonly string[];
}

const CLOSED_STATUSES: ReadonlySet<Task['status']> = new Set(['done', 'cancelled']);

function pushInto(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, [value]);
  } else {
    existing.push(value);
  }
}

/**
 * Build the adjacency structure. Edges pointing at a task outside `tasks` are
 * dropped rather than throwing: a project-scoped load legitimately sees only its
 * own tasks, and a half-visible edge must not corrupt traversal.
 */
export function buildDependencyGraph(
  tasks: readonly GraphTask[],
  dependencies: readonly GraphEdgeInput[],
): DependencyGraph {
  const nodes = new Map<string, GraphTask>();
  const nodeIds: string[] = [];
  for (const task of tasks) {
    if (!nodes.has(task.id)) {
      nodes.set(task.id, task);
      nodeIds.push(task.id);
    }
  }

  const edges: GraphEdge[] = [];
  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  for (const dep of dependencies) {
    if (!nodes.has(dep.predecessor_id) || !nodes.has(dep.successor_id)) {
      continue;
    }
    edges.push({
      id: dep.id,
      predecessorId: dep.predecessor_id,
      successorId: dep.successor_id,
    });
    pushInto(successors, dep.predecessor_id, dep.successor_id);
    pushInto(predecessors, dep.successor_id, dep.predecessor_id);
  }

  return { nodeIds, nodes, edges, successors, predecessors };
}

/** Direct successors of `taskId`, in edge input order. */
export function successorsOf(graph: DependencyGraph, taskId: string): readonly string[] {
  return graph.successors.get(taskId) ?? [];
}

/** Direct predecessors of `taskId`, in edge input order. */
export function predecessorsOf(graph: DependencyGraph, taskId: string): readonly string[] {
  return graph.predecessors.get(taskId) ?? [];
}

/**
 * Forward reachability: can `to` be reached from `from` by following edges in
 * the predecessor -> successor direction? A node is not considered to reach
 * itself unless a real path leads back to it. BFS, O(V + E).
 */
export function isReachable(graph: DependencyGraph, from: string, to: string): boolean {
  if (!graph.nodes.has(from) || !graph.nodes.has(to)) {
    return false;
  }
  const seen = new Set<string>();
  const queue: string[] = [from];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of successorsOf(graph, current)) {
      if (next === to) {
        return true;
      }
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/**
 * Would adding predecessor -> successor close a cycle?
 *
 * The new edge points forward, so the graph becomes cyclic exactly when the
 * predecessor is already reachable *from* the successor. Self edges are cycles
 * of length one and rejected outright.
 */
export function wouldCreateCycle(
  graph: DependencyGraph,
  predecessorId: string,
  successorId: string,
): boolean {
  if (predecessorId === successorId) {
    return true;
  }
  return isReachable(graph, successorId, predecessorId);
}

/**
 * Kahn topological sort, deterministic by construction: among nodes whose
 * in-degree has reached zero, the one appearing earliest in `graph.nodeIds`
 * always comes out first. The ready set is kept sorted by that index, so two
 * runs over the same input can never disagree, and equal-in-degree nodes keep
 * their input order instead of following hash iteration order.
 *
 * O(V log V + E) — the log factor is the sorted insert into the ready set.
 */
export function topologicalOrder(graph: DependencyGraph): TopologicalOrder {
  const indexOf = new Map<string, number>();
  graph.nodeIds.forEach((id, index) => {
    indexOf.set(id, index);
  });

  const inDegree = new Map<string, number>();
  for (const id of graph.nodeIds) {
    inDegree.set(id, predecessorsOf(graph, id).length);
  }

  // Ready nodes, ascending by input index.
  const ready: string[] = graph.nodeIds.filter((id) => inDegree.get(id) === 0);

  const insertReady = (id: string): void => {
    const index = indexOf.get(id) ?? 0;
    let low = 0;
    let high = ready.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const midIndex = indexOf.get(ready[mid] as string) ?? 0;
      if (midIndex < index) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    ready.splice(low, 0, id);
  };

  const order: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift() as string;
    order.push(current);
    for (const next of successorsOf(graph, current)) {
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) {
        insertReady(next);
      }
    }
  }

  const placed = new Set(order);
  const cyclic = graph.nodeIds.filter((id) => !placed.has(id));
  return { order, cyclic, hasCycle: cyclic.length > 0 };
}

/** True when the graph contains at least one cycle. */
export function hasCycle(graph: DependencyGraph): boolean {
  return topologicalOrder(graph).hasCycle;
}

function isOpen(task: GraphTask): boolean {
  return task.archived_at === null && !CLOSED_STATUSES.has(task.status);
}

/**
 * Derived "blocked risk", never a stored status.
 *
 * A task carries risk when it is reachable from an upstream task that is itself
 * `blocked`. Both ends must be live: an archived or cancelled blocker propagates
 * nothing, and a done, cancelled or archived downstream task inherits nothing.
 * Because the result is recomputed from the graph on every load, un-blocking the
 * upstream task makes the risk disappear on its own — no rows are rewritten, so
 * `tasks.status` is never mass-updated behind the user's back.
 *
 * O(B * (V + E)) for B blocked sources; B is tiny in practice and the per-source
 * walk is what lets each risk name the tasks it came from.
 */
export function deriveBlockedRisks(graph: DependencyGraph): readonly BlockedRisk[] {
  const blockedBy = new Map<string, string[]>();

  for (const sourceId of graph.nodeIds) {
    const source = graph.nodes.get(sourceId);
    if (source === undefined || source.status !== 'blocked' || source.archived_at !== null) {
      continue;
    }
    const seen = new Set<string>([sourceId]);
    const queue: string[] = [sourceId];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const next of successorsOf(graph, current)) {
        if (seen.has(next)) {
          continue;
        }
        seen.add(next);
        queue.push(next);
        const downstream = graph.nodes.get(next);
        if (downstream !== undefined && isOpen(downstream)) {
          pushInto(blockedBy, next, sourceId);
        }
      }
    }
  }

  return graph.nodeIds
    .filter((id) => blockedBy.has(id))
    .map((id) => ({ taskId: id, blockedBy: blockedBy.get(id) ?? [] }));
}

/**
 * Finish-to-start schedule conflicts: for edge A -> B, A must finish before B
 * starts, so `A.due_date > B.start_date` is a conflict.
 *
 * Only edges with both dates present are judged. A missing date means "not
 * scheduled yet", which must never be reported as a conflict — inventing one
 * would train the user to ignore the warning. O(E).
 */
export function findScheduleConflicts(graph: DependencyGraph): readonly ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  for (const edge of graph.edges) {
    const predecessor = graph.nodes.get(edge.predecessorId);
    const successor = graph.nodes.get(edge.successorId);
    if (predecessor === undefined || successor === undefined) {
      continue;
    }
    const due = predecessor.due_date;
    const start = successor.start_date;
    if (due === null || start === null || due <= start) {
      continue;
    }
    conflicts.push({
      edgeId: edge.id,
      predecessorId: edge.predecessorId,
      successorId: edge.successorId,
      predecessorDueDate: due,
      successorStartDate: start,
    });
  }
  return conflicts;
}
