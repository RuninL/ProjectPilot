import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applySavedOrder,
  getNamedListOrderService,
  type SavedListOrder,
} from '@/services/namedListOrder.service';
import type { NamedListOrderContext } from '@/types';

type OrderMode = 'dynamic' | 'custom' | `saved:${string}`;

function reconcileIds<T extends { id: string }>(
  items: readonly T[],
  orderedIds: readonly string[],
): string[] {
  const available = new Set(items.map((item) => item.id));
  return [
    ...orderedIds.filter((id) => available.has(id)),
    ...items.map((item) => item.id).filter((id) => !orderedIds.includes(id)),
  ];
}

export function useSavedListOrder<T extends { id: string }>(
  context: NamedListOrderContext,
  contextId: string,
  items: readonly T[],
) {
  const [orders, setOrders] = useState<SavedListOrder[]>([]);
  const [mode, setMode] = useState<OrderMode>('dynamic');
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const initializedContext = useRef('');

  const reload = useCallback(async () => {
    const service = await getNamedListOrderService();
    const nextOrders = await service.list(context, contextId);
    setOrders(nextOrders);
    const key = `${context}\u0000${contextId}`;
    if (initializedContext.current !== key) {
      initializedContext.current = key;
      const preferred = await service.getLastMode(context, contextId);
      const preferredOrder = nextOrders.find((order) => `saved:${order.id}` === preferred);
      const defaultOrder = nextOrders.find((order) => order.is_default === 1);
      const initialOrder = preferredOrder ?? (preferred === null ? defaultOrder : undefined);
      if (initialOrder !== undefined) {
        setMode(`saved:${initialOrder.id}`);
        setOrderedIds(initialOrder.ordered_ids);
      } else if (preferred === 'custom') {
        setMode('custom');
        setOrderedIds(items.map((item) => item.id));
      }
    }
  }, [context, contextId]);

  useEffect(() => {
    void reload().catch(() => {
      setError('无法读取保存的排序');
    });
  }, [reload]);

  useEffect(() => {
    if (mode !== 'dynamic' && items.length > 0) {
      setOrderedIds((current) => reconcileIds(items, current));
    }
  }, [items, mode]);

  const displayedItems = useMemo(
    () => (mode === 'dynamic' ? [...items] : applySavedOrder(items, orderedIds)),
    [items, mode, orderedIds],
  );

  const selectedOrder = mode.startsWith('saved:')
    ? orders.find((order) => `saved:${order.id}` === mode)
    : undefined;

  return {
    orders,
    mode,
    displayedItems,
    orderedIds,
    selectedOrder,
    error,
    clearError: () => {
      setError(null);
    },
    selectMode: (next: OrderMode) => {
      setMode(next);
      void getNamedListOrderService().then((service) =>
        service.setLastMode(context, contextId, next),
      );
      if (next === 'custom') {
        setOrderedIds(items.map((item) => item.id));
      } else if (next.startsWith('saved:')) {
        const selected = orders.find((order) => `saved:${order.id}` === next);
        setOrderedIds(reconcileIds(items, selected?.ordered_ids ?? []));
      }
    },
    move: (id: string, offset: -1 | 1) => {
      setOrderedIds((current) => {
        const next = reconcileIds(items, current);
        const index = next.indexOf(id);
        const target = index + offset;
        if (index < 0 || target < 0 || target >= next.length) return next;
        [next[index], next[target]] = [next[target] ?? id, next[index] ?? id];
        return next;
      });
    },
    moveBefore: (sourceId: string, targetId: string) => {
      setOrderedIds((current) => {
        const next = reconcileIds(items, current).filter((id) => id !== sourceId);
        const target = next.indexOf(targetId);
        next.splice(target < 0 ? next.length : target, 0, sourceId);
        return next;
      });
    },
    save: async (name: string, isDefault: boolean) => {
      const service = await getNamedListOrderService();
      const created = await service.create({
        context,
        context_id: contextId,
        name,
        ordered_ids: reconcileIds(items, orderedIds),
        is_default: isDefault,
      });
      await reload();
      setMode(`saved:${created.id}`);
      await service.setLastMode(context, contextId, `saved:${created.id}`);
    },
    overwrite: async () => {
      if (selectedOrder === undefined) return;
      const service = await getNamedListOrderService();
      await service.update(selectedOrder.id, {
        context,
        context_id: contextId,
        name: selectedOrder.name,
        ordered_ids: reconcileIds(items, orderedIds),
        is_default: selectedOrder.is_default === 1,
      });
      await reload();
    },
    rename: async (name: string) => {
      if (selectedOrder === undefined) return;
      const service = await getNamedListOrderService();
      await service.update(selectedOrder.id, {
        context,
        context_id: contextId,
        name,
        ordered_ids: orderedIds,
        is_default: selectedOrder.is_default === 1,
      });
      await reload();
    },
    remove: async () => {
      if (selectedOrder === undefined) return;
      const service = await getNamedListOrderService();
      await service.delete(selectedOrder.id);
      setMode('dynamic');
      await service.setLastMode(context, contextId, 'dynamic');
      await reload();
    },
  };
}

export type SavedListOrderController<T extends { id: string }> = ReturnType<
  typeof useSavedListOrder<T>
>;
