import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applySavedOrder,
  getNamedListOrderService,
  type SavedListOrder,
} from '@/services/namedListOrder.service';
import type { NamedListOrderContext } from '@/types';

type OrderMode = 'dynamic' | 'custom' | `saved:${string}`;

function reconcileIds(items: readonly { id: string }[], orderedIds: readonly string[]): string[] {
  const seen = new Set<string>();
  return [
    ...orderedIds.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
    ...items
      .map((item) => item.id)
      .filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      }),
  ];
}

export function moveIdToTarget(
  orderedIds: readonly string[],
  sourceId: string,
  targetId: string,
): string[] {
  const next = [...orderedIds];
  const source = next.indexOf(sourceId);
  const target = next.indexOf(targetId);
  if (source < 0 || target < 0 || source === target) return next;
  next.splice(source, 1);
  next.splice(target, 0, sourceId);
  return next;
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
  const itemsRef = useRef(items);
  itemsRef.current = items;

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
        setOrderedIds(itemsRef.current.map((item) => item.id));
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
  const persistSelectedOrder = (next: string[]) => {
    if (selectedOrder === undefined) return;
    void getNamedListOrderService()
      .then((service) =>
        service.update(selectedOrder.id, {
          context,
          context_id: contextId,
          name: selectedOrder.name,
          ordered_ids: next,
          is_default: selectedOrder.is_default === 1,
        }),
      )
      .catch(() => {
        setError('无法保存排序');
      });
  };

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
      const current = reconcileIds(items, orderedIds);
      const index = current.indexOf(id);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= current.length) return;
      const next = moveIdToTarget(current, id, current[target] ?? id);
      setOrderedIds(next);
      persistSelectedOrder(next);
    },
    moveTo: (sourceId: string, targetId: string) => {
      const current = reconcileIds(items, orderedIds);
      const next = moveIdToTarget(current, sourceId, targetId);
      if (next.every((id, index) => id === current[index])) return;
      setOrderedIds(next);
      persistSelectedOrder(next);
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
