import { create } from 'zustand';
import { todayHK } from '@/lib/date';
import { toAppError } from '@/lib/errors';
import { monthOf, shiftMonth, type CalendarMonth } from '@/features/calendar/calendarModel';
import { getCalendarService } from '@/services/calendar.service';

interface CalendarState {
  /** 'YYYY-MM' — the month on screen, independent of what has finished loading. */
  month: string;
  data: CalendarMonth | null;
  loading: boolean;
  error: string | null;
  load: (month?: string) => Promise<void>;
  goToMonth: (month: string) => Promise<void>;
  step: (delta: number) => Promise<void>;
  goToToday: () => Promise<void>;
  reset: () => void;
}

/** Read-only month view. There is deliberately no mutation here at all. */
export const useCalendarStore = create<CalendarState>((set, get) => ({
  month: monthOf(todayHK()),
  data: null,
  loading: false,
  error: null,

  load: async (month) => {
    const target = month ?? get().month;
    set({ month: target, loading: true, error: null });
    try {
      const service = await getCalendarService();
      set({ data: await service.loadMonth(target), loading: false });
    } catch (caught) {
      set({ error: toAppError(caught).message, loading: false });
    }
  },

  goToMonth: async (month) => {
    await get().load(month);
  },

  step: async (delta) => {
    await get().load(shiftMonth(get().month, delta));
  },

  goToToday: async () => {
    await get().load(monthOf(todayHK()));
  },

  reset: () => {
    set({ month: monthOf(todayHK()), data: null, loading: false, error: null });
  },
}));
