import { ArchiveRestore, Archive, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SampleBadge } from '@/components/common/SampleBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDisplay } from '@/lib/date';
import { PROJECT_STATUS_LABELS } from '@/lib/labels';
import { formatProgress, type ProjectProgress } from '@/services/projectProgress';
import type { Project } from '@/types';

interface ProjectListItemProps {
  project: Project;
  progress: ProjectProgress | undefined;
  onEdit: (project: Project) => void;
  onArchive: (project: Project) => void;
  onRestore: (project: Project) => void;
  onDelete: (project: Project) => void;
}

/** One row of the project list: identity, dates, completion rate and actions. */
export function ProjectListItem({
  project,
  progress,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: ProjectListItemProps) {
  const archived = project.archived_at !== null;
  const rate = progress ?? { total: 0, done: 0, percent: 0 };

  return (
    <li className="flex items-center gap-4 rounded-lg border bg-card p-4">
      <span
        className="h-10 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: project.color }}
        aria-hidden
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            to={`/projects/${project.id}`}
            className="truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {project.name}
          </Link>
          <Badge variant={archived ? 'outline' : 'default'}>
            {PROJECT_STATUS_LABELS[project.status]}
          </Badge>
          {project.is_sample === 1 && <SampleBadge />}
        </div>
        {project.description !== '' && (
          <p className="mt-1 truncate text-sm text-muted-foreground">{project.description}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          开始 {formatDisplay(project.start_date)} · 目标结束{' '}
          {formatDisplay(project.target_end_date)}
        </p>
      </div>

      <div className="w-32 shrink-0 text-right">
        <p className="text-sm font-medium">{formatProgress(rate)}</p>
        <p className="text-xs text-muted-foreground">
          {rate.total === 0 ? '无任务' : `${String(rate.done)} / ${String(rate.total)} 已完成`}
        </p>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${project.name} 的操作`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              onEdit(project);
            }}
          >
            <Pencil className="h-4 w-4" aria-hidden />
            编辑
          </DropdownMenuItem>
          {archived ? (
            <DropdownMenuItem
              onSelect={() => {
                onRestore(project);
              }}
            >
              <ArchiveRestore className="h-4 w-4" aria-hidden />
              恢复项目
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={() => {
                onArchive(project);
              }}
            >
              <Archive className="h-4 w-4" aria-hidden />
              归档项目
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            disabled={!archived}
            onSelect={() => {
              onDelete(project);
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            {archived ? '永久删除' : '永久删除（需先归档）'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
