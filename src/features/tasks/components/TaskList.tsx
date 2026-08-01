import { Fragment } from 'react';
import type { TaskWithProject } from '@/types';
import { TaskRow } from './TaskRow';
import { ReorderHandle } from '@/features/sorting/ReorderHandle';

interface TaskListProps {
  tasks: readonly TaskWithProject[];
  selectedIds: readonly string[];
  showProject?: boolean;
  onToggleSelect: (id: string) => void;
  onEdit: (task: TaskWithProject) => void;
  onDelete: (task: TaskWithProject) => void;
  participantsByTask?: Readonly<Record<string, readonly string[]>>;
  reorderEnabled?: boolean;
  reorderDisabled?: boolean;
  onMove?: (id: string, offset: -1 | 1) => void;
  onMoveBefore?: (sourceId: string, targetId: string) => void;
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
  reorderEnabled = false,
  reorderDisabled = false,
  onMove = () => undefined,
  onMoveBefore = () => undefined,
}: TaskListProps) {
  let draggedId: string | null = null;
  const reorderProps = (task: TaskWithProject) =>
    reorderEnabled
      ? {
          draggable: !reorderDisabled,
          onDragStart: () => {
            draggedId = task.id;
          },
          onDragOver: (event: React.DragEvent<HTMLLIElement>) => {
            event.preventDefault();
          },
          onDrop: () => {
            if (draggedId !== null && draggedId !== task.id) onMoveBefore(draggedId, task.id);
            draggedId = null;
          },
          reorderHandle: (
            <ReorderHandle
              label={task.title}
              disabled={reorderDisabled}
              onMoveUp={() => {
                onMove(task.id, -1);
              }}
              onMoveDown={() => {
                onMove(task.id, 1);
              }}
            />
          ),
        }
      : {};
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
            {...reorderProps(task)}
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
              {...reorderProps(child)}
            />
          ))}
        </Fragment>
      ))}
    </ul>
  );
}
