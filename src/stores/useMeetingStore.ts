import { create } from 'zustand';
import { toAppError } from '@/lib/errors';
import { getActionItemService, type ActionItemService } from '@/services/actionItem.service';
import { getMeetingService } from '@/services/meeting.service';
import type { ActionItemInput, ConvertActionItemInput, MeetingInput } from '@/services/schemas';
import type { ActionItem, Meeting } from '@/types';

interface MeetingState {
  meetings: Meeting[];
  /** Null until a meeting has been opened, so the page can tell "missing" from "not yet". */
  current: Meeting | null;
  actionItems: ActionItem[];
  /** Action items the current meeting would lose on delete, for the confirm dialog. */
  actionItemCount: number;
  loading: boolean;
  error: string | null;
  loadMeetings: () => Promise<void>;
  loadMeeting: (id: string) => Promise<void>;
  /** Read-only count for the delete confirmation on the list page. */
  countActionItems: (id: string) => Promise<number>;
  createMeeting: (input: MeetingInput, taskIds?: readonly string[]) => Promise<Meeting>;
  updateMeeting: (id: string, input: MeetingInput) => Promise<void>;
  deleteMeeting: (id: string) => Promise<void>;
  createActionItem: (meetingId: string, input: ActionItemInput) => Promise<void>;
  updateActionItem: (id: string, input: ActionItemInput, meetingId: string) => Promise<void>;
  deleteActionItem: (id: string, meetingId: string) => Promise<void>;
  convertActionItem: (
    id: string,
    meetingId: string,
    input: ConvertActionItemInput,
  ) => Promise<string>;
  reset: () => void;
}

/**
 * Meetings list plus the one open meeting and its action items.
 *
 * Errors from mutations are stored *and* rethrown — the page shows the message,
 * and the calling dialog needs to know not to close itself. Every mutation
 * reloads rather than patching locally: a conversion changes both the item and
 * the task list, so a local patch would be a second source of truth.
 */
export const useMeetingStore = create<MeetingState>((set, get) => {
  async function reloadMeeting(id: string): Promise<void> {
    const [meetingService, itemService] = await Promise.all([
      getMeetingService(),
      getActionItemService(),
    ]);
    const [meeting, actionItems, actionItemCount] = await Promise.all([
      meetingService.getMeeting(id),
      itemService.listByMeeting(id),
      meetingService.countActionItems(id),
    ]);
    set({ current: meeting, actionItems, actionItemCount });
  }

  async function mutateItems(
    meetingId: string,
    run: (service: ActionItemService) => Promise<unknown>,
  ): Promise<void> {
    try {
      await run(await getActionItemService());
    } catch (caught) {
      set({ error: toAppError(caught).message });
      throw caught;
    }
    set({ error: null });
    await reloadMeeting(meetingId);
  }

  return {
    meetings: [],
    current: null,
    actionItems: [],
    actionItemCount: 0,
    loading: false,
    error: null,

    loadMeetings: async () => {
      set({ loading: true, error: null });
      try {
        const service = await getMeetingService();
        set({ meetings: await service.listMeetings(), loading: false });
      } catch (caught) {
        set({ error: toAppError(caught).message, loading: false });
      }
    },

    loadMeeting: async (id) => {
      set({ loading: true, error: null });
      try {
        await reloadMeeting(id);
        set({ loading: false });
      } catch (caught) {
        set({ error: toAppError(caught).message, loading: false, current: null });
      }
    },

    countActionItems: async (id) => {
      const service = await getMeetingService();
      return service.countActionItems(id);
    },

    createMeeting: async (input, taskIds = []) => {
      try {
        const service = await getMeetingService();
        const meeting = await service.createMeeting(input, taskIds);
        set({ error: null });
        await get().loadMeetings();
        return meeting;
      } catch (caught) {
        set({ error: toAppError(caught).message });
        throw caught;
      }
    },

    updateMeeting: async (id, input) => {
      try {
        const service = await getMeetingService();
        await service.updateMeeting(id, input);
      } catch (caught) {
        set({ error: toAppError(caught).message });
        throw caught;
      }
      set({ error: null });
      await Promise.all([reloadMeeting(id), get().loadMeetings()]);
    },

    deleteMeeting: async (id) => {
      try {
        const service = await getMeetingService();
        await service.deleteMeeting(id);
      } catch (caught) {
        set({ error: toAppError(caught).message });
        throw caught;
      }
      set({ error: null, current: null, actionItems: [], actionItemCount: 0 });
      await get().loadMeetings();
    },

    createActionItem: async (meetingId, input) => {
      await mutateItems(meetingId, (service) => service.createActionItem(meetingId, input));
    },

    updateActionItem: async (id, input, meetingId) => {
      await mutateItems(meetingId, (service) => service.updateActionItem(id, input));
    },

    deleteActionItem: async (id, meetingId) => {
      await mutateItems(meetingId, (service) => service.deleteActionItem(id));
    },

    /** Resolves with the new task id so the caller can offer a link straight to it. */
    convertActionItem: async (id, meetingId, input) => {
      let taskId = '';
      await mutateItems(meetingId, async (service) => {
        taskId = (await service.convertToTask(id, input)).id;
      });
      return taskId;
    },

    reset: () => {
      set({
        meetings: [],
        current: null,
        actionItems: [],
        actionItemCount: 0,
        loading: false,
        error: null,
      });
    },
  };
});
