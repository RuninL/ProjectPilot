import { create } from 'zustand';
import { toAppError } from '@/lib/errors';
import { getRecurrenceService } from '@/services/recurrence.service';
import type { RecurrenceRule } from '@/types';
import type { RecurrenceRuleInput } from '@/services/schemas';

interface RecurrenceState {
  rules: RecurrenceRule[];
  materializedCounts: Record<string, number>;
  loading: boolean;
  error: string | null;
  loadRules: () => Promise<void>;
  createRule: (input: RecurrenceRuleInput) => Promise<RecurrenceRule>;
  updateRule: (id: string, input: RecurrenceRuleInput) => Promise<RecurrenceRule>;
  deleteRule: (id: string) => Promise<void>;
  reset: () => void;
}

export const useRecurrenceStore = create<RecurrenceState>((set) => {
  async function reload(): Promise<void> {
    const service = await getRecurrenceService();
    const rules = await service.listRules();
    const counts: readonly (readonly [string, number])[] = await Promise.all(
      rules.map(async (rule): Promise<readonly [string, number]> => [
        rule.id,
        (await service.listExceptions(rule.id)).filter((item) => item.action === 'materialized')
          .length,
      ]),
    );
    set({ rules, materializedCounts: Object.fromEntries(counts), loading: false, error: null });
  }

  return {
    rules: [],
    materializedCounts: {},
    loading: false,
    error: null,
    loadRules: async () => {
      set({ loading: true, error: null });
      try {
        await reload();
      } catch (caught) {
        set({ loading: false, error: toAppError(caught).message });
      }
    },
    createRule: async (input) => {
      try {
        const rule = await (await getRecurrenceService()).createRule(input);
        await reload();
        return rule;
      } catch (caught) {
        set({ error: toAppError(caught).message });
        throw caught;
      }
    },
    updateRule: async (id, input) => {
      try {
        const rule = await (await getRecurrenceService()).updateRule(id, input);
        await reload();
        return rule;
      } catch (caught) {
        set({ error: toAppError(caught).message });
        throw caught;
      }
    },
    deleteRule: async (id) => {
      try {
        await (await getRecurrenceService()).deleteRule(id);
        await reload();
      } catch (caught) {
        set({ error: toAppError(caught).message });
        throw caught;
      }
    },
    reset: () => {
      set({ rules: [], materializedCounts: {}, loading: false, error: null });
    },
  };
});
