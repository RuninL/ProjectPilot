import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { SampleBadge } from '@/components/common/SampleBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/cn';
import { formatDisplay, isOverdue } from '@/lib/date';
import {
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_VARIANTS,
  TASK_STATUS_LABELS,
  TASK_STATUS_VARIANTS,
} from '@/lib/labels';
import type { DropTargetProps } from '@/features/sorting/useDragReorder';
import type { TaskWithProject } from '@/types';

interface TaskRowProps {
  task: TaskWithProject;
  selected: boolean;
  /** Child rows are indented one level; the schema allows no deeper nesting. */
  nested?: boolean;
  showProject?: boolean;
  onToggleSelect: (id: string) => void;
  onEdit: (task: TaskWithProject) => void;
  onDelete: (task: TaskWithProject) => void;
  onArchive?: (task: TaskWithProject) => void;
  onRestore?: (task: TaskWithProject) => void;
  participantNames?: readonly string[];
  reorderHandle?: ReactNode;
  dropTargetProps?: DropTargetProps;
  isDropTarget?: boolean;
  isDragSource?: boolean;
}

/** One task row: selection, identity, status/priority, due date and actions. */
export function TaskRow({
  task,
  selected,
  nested = false,
  showProject = false,
  onToggleSelect,
  onEdit,
  onDelete,
  onArchive,
  onRestore,
  participantNames = [],
  reorderHandle,
  dropTargetProps,
  isDropTarget = false,
  isDragSource = false,
}: TaskRowProps) {
  const overdue = isOverdue(task.due_date, task.status);

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-card px-4 py-3',
        nested && 'ml-8',
        isDropTarget && 'border-primary ring-1 ring-primary',
        isDragSource && 'opacity-60',
      )}
      {...dropTargetProps}
    >
      {reorderHandle}
      <Checkbox
        checked={selected}
        aria-label={`选择任务 ${task.title}`}
        onCheckedChange={() => {
          onToggleSelect(task.id);
        }}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            to={`/tasks/${task.id}`}
            className={cn(
              'truncate font-medium hover:underline',
              task.status === 'done' && 'line-through',
            )}
          >
            {task.title}
          </Link>
          <Badge variant={TASK_STATUS_VARIANTS[task.status]}>
            {TASK_STATUS_LABELS[task.status]}
          </Badge>
          <Badge variant={TASK_PRIORITY_VARIANTS[task.priority]}>
            {TASK_PRIORITY_LABELS[task.priority]}
          </Badge>
          {task.archived_at !== null && <Badge variant="outline">已归档</Badge>}
          {task.is_sample === 1 && <SampleBadge />}
        </div>
        <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          {showProject && (
            <span className="flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: task.project_color }}
                aria-hidden
              />
              {task.project_name}
            </span>
          )}
          <span className={cn(overdue && 'font-medium text-destructive')}>
            截止 {formatDisplay(task.due_date)}
            {overdue && '（已逾期）'}
          </span>
          <span>进度 {String(task.progress)}%</span>
          <span>
            参与人：{participantNames.length === 0 ? '未分配' : participantNames.join('、')}
          </span>
        </p>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${task.title} 的操作`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              onEdit(task);
            }}
          >
            <Pencil className="h-4 w-4" aria-hidden />
            编辑
          </DropdownMenuItem>
          {task.archived_at === null
            ? onArchive !== undefined && (
                <DropdownMenuItem
                  onSelect={() => {
                    onArchive(task);
                  }}
                >
                  <Archive className="h-4 w-4" aria-hidden />
                  归档任务
                </DropdownMenuItem>
              )
            : onRestore !== undefined && (
                <DropdownMenuItem
                  onSelect={() => {
                    onRestore(task);
                  }}
                >
                  <ArchiveRestore className="h-4 w-4" aria-hidden />
                  恢复任务
                </DropdownMenuItem>
              )}
          <DropdownMenuItem
            destructive
            onSelect={() => {
              onDelete(task);
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
