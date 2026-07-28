import { describe, expect, it } from 'vitest';
import {
  achievePromptMessage,
  milestoneView,
  shouldPromptAchieved,
} from '@/services/milestoneStatus';
import { makeMilestone, makeTask } from '../helpers/fixtures';

const TODAY = '2026-07-14';

describe('milestoneView countdown', () => {
  it('reports 0 — never -0 or 1 — on the day the milestone is due', () => {
    const view = milestoneView(makeMilestone({ date: TODAY }), TODAY);

    expect(view.state).toBe('today');
    expect(view.daysRemaining).toBe(0);
    expect(view.daysOverdue).toBe(0);
    expect(view.label).toBe('今天到期');
    // `Object.is` distinguishes -0 from 0, which `toBe` alone would not.
    expect(Object.is(view.daysRemaining, -0)).toBe(false);
    expect(Object.is(view.daysOverdue, -0)).toBe(false);
    expect(view.label).not.toContain('-0');
  });

  it('counts forward for a future date', () => {
    expect(milestoneView(makeMilestone({ date: '2026-07-15' }), TODAY)).toMatchObject({
      state: 'upcoming',
      daysRemaining: 1,
      daysOverdue: 0,
      label: '剩余 1 天',
    });
    expect(milestoneView(makeMilestone({ date: '2026-08-01' }), TODAY).daysRemaining).toBe(18);
  });

  it('counts overdue days as a positive number', () => {
    const view = milestoneView(makeMilestone({ date: '2026-07-12' }), TODAY);

    expect(view.state).toBe('overdue');
    expect(view.daysOverdue).toBe(2);
    expect(view.daysRemaining).toBe(-2);
    expect(view.label).toBe('已逾期 2 天');
  });

  it('crosses month and year boundaries by calendar day', () => {
    expect(milestoneView(makeMilestone({ date: '2026-08-14' }), TODAY).daysRemaining).toBe(31);
    expect(milestoneView(makeMilestone({ date: '2027-01-01' }), '2026-12-31').daysRemaining).toBe(
      1,
    );
    expect(milestoneView(makeMilestone({ date: '2026-12-31' }), '2027-01-01').daysOverdue).toBe(1);
    // 2028 is a leap year.
    expect(milestoneView(makeMilestone({ date: '2028-03-01' }), '2028-02-28').daysRemaining).toBe(
      2,
    );
  });

  it('flags an overdue upcoming milestone as needing attention', () => {
    expect(milestoneView(makeMilestone({ date: '2026-07-01' }), TODAY).needsAttention).toBe(true);
    expect(milestoneView(makeMilestone({ date: '2026-07-20' }), TODAY).needsAttention).toBe(false);
    expect(milestoneView(makeMilestone({ date: TODAY }), TODAY).needsAttention).toBe(false);
  });

  it('does not nag about a milestone the user already judged', () => {
    const missed = milestoneView(makeMilestone({ date: '2026-07-01', status: 'missed' }), TODAY);
    expect(missed.state).toBe('overdue');
    expect(missed.daysOverdue).toBe(13);
    expect(missed.needsAttention).toBe(false);
  });

  it('shows a terminal label instead of a countdown for achieved and cancelled', () => {
    expect(
      milestoneView(
        makeMilestone({ date: '2026-07-01', status: 'achieved', achieved_at: '2026-07-01' }),
        TODAY,
      ),
    ).toMatchObject({ state: 'closed', label: '已达成', needsAttention: false });
    expect(
      milestoneView(makeMilestone({ date: '2026-08-01', status: 'cancelled' }), TODAY),
    ).toMatchObject({ state: 'closed', label: '已取消' });
  });
});

describe('shouldPromptAchieved', () => {
  it('asks only when the linked task is done and the milestone is still upcoming', () => {
    const milestone = makeMilestone({ linked_task_id: 't1' });
    const done = makeTask({ id: 't1', status: 'done', progress: 100 });

    expect(shouldPromptAchieved(milestone, done)).toBe(true);
  });

  it('stays quiet while the linked task is unfinished', () => {
    const milestone = makeMilestone({ linked_task_id: 't1' });

    for (const status of ['todo', 'in_progress', 'blocked', 'cancelled'] as const) {
      expect(shouldPromptAchieved(milestone, makeTask({ id: 't1', status }))).toBe(false);
    }
  });

  it('stays quiet with no link, a missing task, or the wrong task', () => {
    expect(shouldPromptAchieved(makeMilestone({ linked_task_id: null }), null)).toBe(false);
    expect(shouldPromptAchieved(makeMilestone({ linked_task_id: 't1' }), null)).toBe(false);
    expect(
      shouldPromptAchieved(
        makeMilestone({ linked_task_id: 't1' }),
        makeTask({ id: 'other', status: 'done' }),
      ),
    ).toBe(false);
  });

  it('stays quiet once the milestone is no longer upcoming', () => {
    const done = makeTask({ id: 't1', status: 'done' });

    for (const status of ['achieved', 'missed', 'cancelled'] as const) {
      expect(shouldPromptAchieved(makeMilestone({ linked_task_id: 't1', status }), done)).toBe(
        false,
      );
    }
  });

  it('phrases the prompt as a question, not a statement', () => {
    const message = achievePromptMessage(
      makeMilestone({ name: '第一阶段' }),
      makeTask({ title: '收尾' }),
    );

    expect(message).toBe('关联任务「收尾」已完成，是否将里程碑「第一阶段」标记为已达成？');
  });
});
