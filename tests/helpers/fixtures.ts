import type { ActionItem, Meeting, Milestone, Project, Task } from '@/types';
import { NOW } from './testDb';

/** Row fixtures shared by the repository and service test suites. */

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: '示例项目',
    description: '',
    status: 'active',
    color: '#2563EB',
    start_date: null,
    target_end_date: null,
    archived_at: null,
    is_sample: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    project_id: 'p1',
    parent_task_id: null,
    title: '任务',
    description: '',
    status: 'todo',
    priority: 'medium',
    start_date: null,
    due_date: null,
    progress: 0,
    estimated_hours: null,
    actual_hours: null,
    completed_at: null,
    archived_at: null,
    source_meeting_id: null,
    is_sample: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    project_id: 'p1',
    topic: '周会',
    date: '2026-07-14',
    start_time: null,
    attendees: '[]',
    agenda: '',
    notes: '',
    decisions: '',
    risks: '',
    is_sample: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function makeActionItem(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: 'a1',
    meeting_id: 'm1',
    content: '跟进事项',
    owner: '',
    due_date: null,
    status: 'open',
    converted_task_id: null,
    converted_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'ms1',
    project_id: 'p1',
    linked_task_id: null,
    name: '里程碑',
    description: '',
    date: '2026-08-01',
    status: 'upcoming',
    achieved_at: null,
    is_sample: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}
