import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applySavedOrder,
  getNamedListOrderService,
  getSectionIds,
  type OrderSections,
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

/**
 * Reorder within the full list while only the `visibleIds` subset is shown
 * (search or filters active). Visible entries are re-arranged inside the slots
 * they already occupy, so hidden entries keep their positions exactly:
 * full A,B,C,D,E with visible B,D — dragging D before B yields A,D,C,B,E.
 */
export function moveVisibleIdToTarget(
  fullOrder: readonly string[],
  visibleIds: readonly string[],
  sourceId: string,
  targetId: string,
): string[] {
  const visible = new Set(visibleIds);
  if (!visible.has(sourceId) || !visible.has(targetId) || sourceId === targetId) {
    return [...fullOrder];
  }
  const slots: number[] = [];
  const sequence: string[] = [];
  fullOrder.forEach((id, index) => {
    if (visible.has(id)) {
      slots.push(index);
      sequence.push(id);
    }
  });
  const reordered = moveIdToTarget(sequence, sourceId, targetId);
  const result = [...fullOrder];
  slots.forEach((slot, index) => {
    const id = reordered[index];
    if (id !== undefined) result[slot] = id;
  });
  return result;
}

export interface SectionOrderController<T extends { id: string }> {
  displayedItems: T[];
  orderedIds: string[];
  move: (id: string, offset: -1 | 1) => void;
  moveTo: (sourceId: string, targetId: string) => void;
}

/**
 * One named order per context stores several sub-orders keyed by section
 * (for example projects: active / archived / all, or meetings:
 * recurringSeries / standalone.future / …). Saving, loading, renaming and
 * deleting always act on the whole record, so the user manages a single name
 * while every section keeps its own custom sequence.
 */
export function useSectionedListOrder<M extends Record<string, readonly { id: string }[]>>(
  context: NamedListOrderContext,
  contextId: string,
  sectionItems: M,
) {
  const [orders, setOrders] = useState<SavedListOrder[]>([]);
  const [mode, setMode] = useState<OrderMode>('dynamic');
  const [sections, setSections] = useState<OrderSections>({});
  const [error, setError] = useState<string | null>(null);
  const initializedContext = useRef('');
  const sectionItemsRef = useRef(sectionItems);
  sectionItemsRef.current = sectionItems;
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  const snapshotFromItems = (): OrderSections =>
    Object.fromEntries(
      Object.entries(sectionItemsRef.current).map(([key, items]) => [
        key,
        items.map((item) => item.id),
      ]),
    );

  /** Current sections merged with the visible items of every provided section. */
  const reconciledSections = (base: Readonly<OrderSections>): OrderSections => {
    const next: OrderSections = { ...base };
    for (const [key, items] of Object.entries(sectionItemsRef.current)) {
      next[key] = reconcileIds(items, getSectionIds(base, key));
    }
    return next;
  };

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
        setSections({ ...initialOrder.sections });
      } else if (preferred === 'custom') {
        setMode('custom');
        setSections({});
      }
    }
  }, [context, contextId]);

  useEffect(() => {
    void reload().catch(() => {
      setError('无法读取保存的排序');
    });
  }, [reload]);

  const selectedOrder = mode.startsWith('saved:')
    ? orders.find((order) => `saved:${order.id}` === mode)
    : undefined;

  const persistSelectedOrder = (nextSections: OrderSections) => {
    if (selectedOrder === undefined) return;
    void getNamedListOrderService()
      .then((service) =>
        service.update(selectedOrder.id, {
          context,
          context_id: contextId,
          name: selectedOrder.name,
          sections: nextSections,
          is_default: selectedOrder.is_default === 1,
        }),
      )
      .catch(() => {
        setError('无法保存排序');
      });
  };

  const displayedBySection = useMemo(() => {
    const result: Record<string, { id: string }[]> = {};
    for (const [key, items] of Object.entries(sectionItems)) {
      result[key] =
        mode === 'dynamic'
          ? [...items]
          : applySavedOrder(items, reconcileIds(items, getSectionIds(sections, key)));
    }
    return result;
  }, [sectionItems, mode, sections]);

  const applyMove = (
    key: string,
    mutate: (fullOrder: string[], visibleIds: string[]) => string[],
  ) => {
    const items = sectionItemsRef.current[key] ?? [];
    const fullOrder = reconcileIds(items, getSectionIds(sectionsRef.current, key));
    const visibleIds = items.map((item) => item.id);
    const next = mutate(fullOrder, visibleIds);
    if (next.every((id, index) => id === fullOrder[index]) && next.length === fullOrder.length) {
      return;
    }
    const nextSections = { ...sectionsRef.current, [key]: next };
    setSections(nextSections);
    persistSelectedOrder(nextSections);
  };

  return {
    orders,
    mode,
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
        setSections(snapshotFromItems());
      } else if (next.startsWith('saved:')) {
        const selected = orders.find((order) => `saved:${order.id}` === next);
        setSections({ ...(selected?.sections ?? {}) });
      }
    },
    section<K extends keyof M & string>(key: K): SectionOrderController<M[K][number]> {
      const items = sectionItems[key] ?? [];
      const displayed = (displayedBySection[key] ?? [...items]) as M[K][number][];
      return {
        displayedItems: displayed,
        orderedIds: reconcileIds(items, getSectionIds(sections, key)),
        move: (id, offset) => {
          applyMove(key, (fullOrder, visibleIds) => {
            const visibleSequence = fullOrder.filter((entry) => visibleIds.includes(entry));
            const index = visibleSequence.indexOf(id);
            const target = visibleSequence[index + offset];
            if (index < 0 || target === undefined) return [...fullOrder];
            return moveVisibleIdToTarget(fullOrder, visibleIds, id, target);
          });
        },
        moveTo: (sourceId, targetId) => {
          applyMove(key, (fullOrder, visibleIds) =>
            moveVisibleIdToTarget(fullOrder, visibleIds, sourceId, targetId),
          );
        },
      };
    },
    save: async (name: string, isDefault: boolean) => {
      const service = await getNamedListOrderService();
      const created = await service.create({
        context,
        context_id: contextId,
        name,
        sections: reconciledSections(sectionsRef.current),
        is_default: isDefault,
      });
      await reload();
      setMode(`saved:${created.id}`);
      setSections({ ...created.sections });
      await service.setLastMode(context, contextId, `saved:${created.id}`);
    },
    overwrite: async () => {
      if (selectedOrder === undefined) return;
      const service = await getNamedListOrderService();
      await service.update(selectedOrder.id, {
        context,
        context_id: contextId,
        name: selectedOrder.name,
        sections: reconciledSections(sectionsRef.current),
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
        sections: sectionsRef.current,
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

export type SectionedListOrderController<M extends Record<string, readonly { id: string }[]>> =
  ReturnType<typeof useSectionedListOrder<M>>;

/** The mode/save/load surface shared by every list, regardless of sections. */
export type SavedOrderBaseController = Pick<
  SectionedListOrderController<Record<string, readonly { id: string }[]>>,
  | 'orders'
  | 'mode'
  | 'selectedOrder'
  | 'error'
  | 'clearError'
  | 'selectMode'
  | 'save'
  | 'overwrite'
  | 'rename'
  | 'remove'
>;

/**
 * Single-section wrapper kept for lists without scopes; the whole list lives
 * in the legacy '' section.
 */
export function useSavedListOrder<T extends { id: string }>(
  context: NamedListOrderContext,
  contextId: string,
  items: readonly T[],
) {
  const controller = useSectionedListOrder(context, contextId, { '': items });
  const section = controller.section('');
  return {
    orders: controller.orders,
    mode: controller.mode,
    selectedOrder: controller.selectedOrder,
    error: controller.error,
    clearError: controller.clearError,
    selectMode: controller.selectMode,
    save: controller.save,
    overwrite: controller.overwrite,
    rename: controller.rename,
    remove: controller.remove,
    displayedItems: section.displayedItems,
    orderedIds: section.orderedIds,
    move: section.move,
    moveTo: section.moveTo,
  };
}

export type SavedListOrderController<T extends { id: string }> = ReturnType<
  typeof useSavedListOrder<T>
>;
