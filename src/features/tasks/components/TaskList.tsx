import { Fragment } from 'react';
import type { TaskWithProject } from '@/types';
import { TaskRow } from './TaskRow';

interface TaskListProps {
  tasks: readonly TaskWithProject[];
  selectedIds: readonly string[];
  showProject?: boolean;
  onToggleSelect: (id: string) => void;
  onEdit: (task: TaskWithProject) => void;
  onDelete: (task: TaskWithProject) => void;
  participantsByTask?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Two-level rendering: children are nested under a parent when that parent is
 * also in the current result set. A child whose parent was filtered out stays
 * visible at the top level rather than disappearing from the list.
 */
export function TaskList({
  tasks,
  selectedIds,
  showProject = false,
  onToggleSelect,
  onEdit,
  onDelete,
  participantsByTask = {},
}: TaskListProps) {
  const present = new Set(tasks.map((task) => task.id));
  const childrenByParent = new Map<string, TaskWithProject[]>();
  const roots: TaskWithProject[] = [];

  for (const task of tasks) {
    const parentId = task.parent_task_id;
    if (parentId !== null && present.has(parentId)) {
      const siblings = childrenByParent.get(parentId) ?? [];
      siblings.push(task);
      childrenByParent.set(parentId, siblings);
    } else {
      roots.push(task);
    }
  }

  return (
    <ul className="flex flex-col gap-2">
      {roots.map((task) => (
        <Fragment key={task.id}>
          <TaskRow
            task={task}
            selected={selectedIds.includes(task.id)}
            showProject={showProject}
            onToggleSelect={onToggleSelect}
            onEdit={onEdit}
            onDelete={onDelete}
            participantNames={participantsByTask[task.id] ?? []}
          />
          {(childrenByParent.get(task.id) ?? []).map((child) => (
            <TaskRow
              key={child.id}
              task={child}
              nested
              selected={selectedIds.includes(child.id)}
              showProject={showProject}
              onToggleSelect={onToggleSelect}
              onEdit={onEdit}
              onDelete={onDelete}
              participantNames={participantsByTask[child.id] ?? []}
            />
          ))}
        </Fragment>
      ))}
    </ul>
  );
}
