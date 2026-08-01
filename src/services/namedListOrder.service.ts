import type { BatchStatement } from '@/lib/commands';
import { executeBatch } from '@/lib/commands';
import { nowIso } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/uuid';
import {
  getRepositories,
  type AppSettingRepository,
  type NamedListOrderRepository,
} from '@/repositories';
import type { NamedListOrder, NamedListOrderContext } from '@/types';
import {
  namedListOrderInputSchema,
  orderSectionsSchema,
  orderedIdsSchema,
  type NamedListOrderInput,
} from './schemas';

export type OrderSections = Record<string, string[]>;

export interface SavedListOrder extends Omit<NamedListOrder, 'ordered_ids_json'> {
  /** Sub-orders keyed by section; the legacy single list lives in section ''. */
  sections: OrderSections;
  /** Legacy single-section view, kept for single-list contexts. */
  ordered_ids: string[];
}

export interface NamedListOrderServiceDeps {
  orders: NamedListOrderRepository;
  appSettings?: AppSettingRepository;
  runBatch: (statements: BatchStatement[]) => Promise<number>;
}

const SCOPED_CONTEXTS = new Set<NamedListOrderContext>([
  'project_tasks',
  'task_subtasks',
  'task_progress',
  'task_checklist',
  'task_resources',
]);

function parseOrder(row: NamedListOrder): SavedListOrder {
  let raw: unknown = [];
  try {
    raw = JSON.parse(row.ordered_ids_json) as unknown;
  } catch {
    raw = [];
  }
  let sections: OrderSections = {};
  const legacy = orderedIdsSchema.safeParse(raw);
  if (legacy.success) {
    sections = { '': legacy.data };
  } else if (typeof raw === 'object' && raw !== null && 'sections' in raw) {
    const parsed = orderSectionsSchema.safeParse(raw.sections);
    if (parsed.success) sections = parsed.data;
  }
  return {
    ...row,
    sections,
    ordered_ids: sections[''] ?? [],
  };
}

/** Resolve a section's ids, falling back to the legacy '' section. */
export function getSectionIds(sections: Readonly<OrderSections>, section: string): string[] {
  return sections[section] ?? sections[''] ?? [];
}

/**
 * Serialize sections. A payload that only uses the legacy '' section keeps the
 * plain-array format so older exports/backups stay round-trippable.
 */
function serializeSections(sections: Readonly<OrderSections>): string {
  const keys = Object.keys(sections);
  if (keys.every((key) => key === '')) {
    return JSON.stringify(sections[''] ?? []);
  }
  return JSON.stringify({ v: 2, sections });
}

function normalizeInputSections(parsed: NamedListOrderInput): OrderSections {
  return parsed.sections ?? { '': parsed.ordered_ids ?? [] };
}

function validateContextId(context: NamedListOrderContext, contextId: string): void {
  if (SCOPED_CONTEXTS.has(context) !== (contextId !== '')) {
    throw new AppError(
      'validation',
      SCOPED_CONTEXTS.has(context) ? '该排序列表缺少所属范围' : '该排序列表不接受所属范围',
    );
  }
}

export function applySavedOrder<T extends { id: string }>(
  items: readonly T[],
  orderedIds: readonly string[],
): T[] {
  const positions = new Map(orderedIds.map((id, index) => [id, index]));
  return [...items].sort((left, right) => {
    const leftIndex = positions.get(left.id);
    const rightIndex = positions.get(right.id);
    if (leftIndex === undefined && rightIndex === undefined) return 0;
    if (leftIndex === undefined) return 1;
    if (rightIndex === undefined) return -1;
    return leftIndex - rightIndex;
  });
}

export function createNamedListOrderService(deps: NamedListOrderServiceDeps) {
  const preferenceKey = (context: NamedListOrderContext, contextId: string) =>
    `list_order:${context}:${contextId}`;
  async function requireOrder(id: string): Promise<NamedListOrder> {
    const order = await deps.orders.findById(id);
    if (order === null) throw new AppError('not_found', '保存的排序不存在或已被删除');
    return order;
  }

  async function requireUniqueName(
    context: NamedListOrderContext,
    contextId: string,
    name: string,
    excludingId?: string,
  ): Promise<void> {
    const duplicate = (await deps.orders.findByContext(context, contextId)).some(
      (order) =>
        order.id !== excludingId &&
        order.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0,
    );
    if (duplicate) throw new AppError('conflict', '同一列表中已存在同名排序');
  }

  return {
    async getLastMode(context: NamedListOrderContext, contextId = ''): Promise<string | null> {
      return (await deps.appSettings?.get(preferenceKey(context, contextId)))?.value ?? null;
    },

    async setLastMode(
      context: NamedListOrderContext,
      contextId: string,
      mode: string,
    ): Promise<void> {
      await deps.appSettings?.set(preferenceKey(context, contextId), mode, nowIso());
    },

    async list(context: NamedListOrderContext, contextId = ''): Promise<SavedListOrder[]> {
      validateContextId(context, contextId);
      return (await deps.orders.findByContext(context, contextId)).map(parseOrder);
    },

    async create(input: NamedListOrderInput): Promise<SavedListOrder> {
      const parsed = namedListOrderInputSchema.parse(input);
      validateContextId(parsed.context, parsed.context_id);
      await requireUniqueName(parsed.context, parsed.context_id, parsed.name);
      const now = nowIso();
      const row: NamedListOrder = {
        id: newId(),
        context: parsed.context,
        context_id: parsed.context_id,
        name: parsed.name,
        ordered_ids_json: serializeSections(normalizeInputSections(parsed)),
        is_default: parsed.is_default ? 1 : 0,
        created_at: now,
        updated_at: now,
      };
      if (row.is_default === 1) {
        await deps.runBatch([
          deps.orders.buildClearDefault(row.context, row.context_id, now),
          deps.orders.buildInsert(row),
        ]);
      } else {
        await deps.orders.insert(row);
      }
      return parseOrder(await requireOrder(row.id));
    },

    async update(id: string, input: NamedListOrderInput): Promise<SavedListOrder> {
      const existing = await requireOrder(id);
      const parsed = namedListOrderInputSchema.parse(input);
      if (parsed.context !== existing.context || parsed.context_id !== existing.context_id) {
        throw new AppError('validation', '不能将保存的排序移动到其他列表');
      }
      await requireUniqueName(parsed.context, parsed.context_id, parsed.name, id);
      const now = nowIso();
      const fields = {
        name: parsed.name,
        ordered_ids_json: serializeSections(normalizeInputSections(parsed)),
        is_default: parsed.is_default ? (1 as const) : (0 as const),
      };
      const statements = parsed.is_default
        ? [
            deps.orders.buildClearDefault(parsed.context, parsed.context_id, now),
            deps.orders.buildUpdate(id, fields, now),
          ]
        : [deps.orders.buildUpdate(id, fields, now)];
      await deps.runBatch(statements);
      return parseOrder(await requireOrder(id));
    },

    async delete(id: string): Promise<void> {
      await requireOrder(id);
      await deps.orders.deleteById(id);
    },
  };
}

export type NamedListOrderService = ReturnType<typeof createNamedListOrderService>;

export async function getNamedListOrderService(): Promise<NamedListOrderService> {
  const repositories = await getRepositories();
  return createNamedListOrderService({
    orders: repositories.namedListOrders,
    appSettings: repositories.appSettings,
    runBatch: executeBatch,
  });
}
