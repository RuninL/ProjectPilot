import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { openTask, taskDetailPath } from '@/lib/taskNavigation';

interface DashboardTaskLinkProps {
  readonly taskId: string;
  readonly className?: string;
  readonly children: ReactNode;
  readonly onNavigationError: (error: unknown) => void;
}

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.currentTarget.target !== '_blank'
  );
}

/**
 * Accessible task link with native modified-click behaviour. Only a plain
 * activation is intercepted for validation/window restoration; modified
 * clicks keep React Router's normal link semantics and the same real task id.
 */
export function DashboardTaskLink({
  taskId,
  className,
  children,
  onNavigationError,
}: DashboardTaskLinkProps) {
  let target: string;
  try {
    target = taskDetailPath(taskId);
  } catch {
    // Keep the href on a detail route even for malformed data. A modified
    // click therefore reaches a readable not-found detail state, never /tasks.
    target = '/tasks/invalid-task-id';
  }

  return (
    <Link
      className={className}
      to={target}
      onClick={(event) => {
        if (!isPlainLeftClick(event)) return;
        event.preventDefault();
        void openTask(taskId).catch(onNavigationError);
      }}
    >
      {children}
    </Link>
  );
}
