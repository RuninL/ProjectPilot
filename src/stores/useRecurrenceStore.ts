import { create } from 'zustand';
import { toAppError } from '@/lib/errors';
import { getRecurrenceService } from '@/services/recurrence.service';
import type { RecurrenceRule } from '@/types';
import type { RecurrenceRuleInput } from '@/services/schemas';

interface RecurrenceState {
  rules: RecurrenceRule[];
  loading: boolean;
  error: string | null;
  loadRules: () => Promise<void>;
  createRule: (input: RecurrenceRuleInput, taskIds?: readonly string[]) => Promise<RecurrenceRule>;
  updateRule: (id: string, input: RecurrenceRuleInput) => Promise<RecurrenceRule>;
  deleteRule: (id: string) => Promise<void>;
  skip: (ruleId: string, date: string) => Promise<void>;
  reschedule: (ruleId: string, date: string, replacementDate: string) => Promise<void>;
  reset: () => void;
}

export const useRecurrenceStore = create<RecurrenceState>((set) => {
  async function reload(): Promise<void> {
    const service = await getRecurrenceService();
    const rules = await service.listRules();
    set({ rules, loading: false, error: null });
  }

  return {
    rules: [],
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
    createRule: async (input, taskIds = []) => {
      try {
        const service = await getRecurrenceService();
        const rule = await service.createRule(input, taskIds);
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
    skip: async (ruleId, date) => {
      try {
        await (await getRecurrenceService()).skipOccurrence(ruleId, date);
        await reload();
      } catch (caught) {
        set({ error: toAppError(caught).message });
        throw caught;
      }
    },
    reschedule: async (ruleId, date, replacementDate) => {
      try {
        await (await getRecurrenceService()).rescheduleOccurrence(ruleId, date, replacementDate);
        await reload();
      } catch (caught) {
        set({ error: toAppError(caught).message });
        throw caught;
      }
    },
    reset: () => {
      set({ rules: [], loading: false, error: null });
    },
  };
});
