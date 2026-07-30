import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS } from '@/lib/labels';
import { ParticipantSelector } from '@/features/people/components/ParticipantSelector';
import type { TaskSort } from '@/repositories';
import type { Person, Project, TaskPriority, TaskStatus } from '@/types';

const SORT_OPTIONS: { value: TaskSort; label: string }[] = [
  { value: 'due_date', label: '截止日期' },
  { value: 'priority', label: '优先级' },
  { value: 'created_at', label: '创建时间' },
  { value: 'title', label: '标题' },
];

interface TaskFiltersProps {
  search: string;
  statuses: readonly TaskStatus[];
  priorities: readonly TaskPriority[];
  projectIds: readonly string[];
  dueFrom: string | null;
  dueTo: string | null;
  sortBy: TaskSort;
  people?: readonly Person[];
  participantIds?: readonly string[];
  /** Omitted on a project's own task list, where the project is already fixed. */
  projects?: readonly Project[];
  onSearchChange: (search: string) => void;
  onStatusesChange: (statuses: TaskStatus[]) => void;
  onPrioritiesChange: (priorities: TaskPriority[]) => void;
  onProjectIdsChange: (ids: string[]) => void;
  onDueRangeChange: (from: string | null, to: string | null) => void;
  onSortChange: (sort: TaskSort) => void;
  onParticipantIdsChange?: (ids: string[]) => void;
  onReset: () => void;
}

function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

/** Search / status / priority / project / due-range / sort controls for task lists. */
export function TaskFilters({
  search,
  statuses,
  priorities,
  projectIds,
  dueFrom,
  dueTo,
  sortBy,
  people = [],
  participantIds = [],
  projects,
  onSearchChange,
  onStatusesChange,
  onPrioritiesChange,
  onProjectIdsChange,
  onDueRangeChange,
  onSortChange,
  onParticipantIdsChange = () => undefined,
  onReset,
}: TaskFiltersProps) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="task-search">搜索</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="task-search"
              className="w-64 pl-9"
              placeholder="搜索任务标题或描述"
              value={search}
              onChange={(event) => {
                onSearchChange(event.target.value);
              }}
            />
          </div>
        </div>

        {projects !== undefined && (
          <div className="grid gap-1.5">
            <Label htmlFor="task-project-filter">项目</Label>
            <select
              id="task-project-filter"
              className="h-10 w-48 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={projectIds[0] ?? ''}
              onChange={(event) => {
                const next = event.target.value;
                onProjectIdsChange(next === '' ? [] : [next]);
              }}
            >
              <option value="">全部项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="task-due-from">截止起</Label>
          <Input
            id="task-due-from"
            type="date"
            value={dueFrom ?? ''}
            onChange={(event) => {
              onDueRangeChange(event.target.value === '' ? null : event.target.value, dueTo);
            }}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="task-due-to">截止止</Label>
          <Input
            id="task-due-to"
            type="date"
            value={dueTo ?? ''}
            onChange={(event) => {
              onDueRangeChange(dueFrom, event.target.value === '' ? null : event.target.value);
            }}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="task-sort">排序</Label>
          <select
            id="task-sort"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={sortBy}
            onChange={(event) => {
              onSortChange(event.target.value as TaskSort);
            }}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <Button variant="outline" onClick={onReset}>
          重置筛选
        </Button>
      </div>

      <div className="flex flex-wrap gap-6">
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">按状态筛选</legend>
          <span className="text-sm text-muted-foreground">状态</span>
          {TASK_STATUS_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={statuses.includes(option.value) ? 'default' : 'outline'}
              aria-pressed={statuses.includes(option.value)}
              onClick={() => {
                onStatusesChange(toggle(statuses, option.value));
              }}
            >
              {option.label}
            </Button>
          ))}
        </fieldset>

        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">按优先级筛选</legend>
          <span className="text-sm text-muted-foreground">优先级</span>
          {TASK_PRIORITY_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={priorities.includes(option.value) ? 'default' : 'outline'}
              aria-pressed={priorities.includes(option.value)}
              onClick={() => {
                onPrioritiesChange(toggle(priorities, option.value));
              }}
            >
              {option.label}
            </Button>
          ))}
        </fieldset>
      </div>
      <ParticipantSelector
        id="task-participant-filter"
        people={people}
        selectedIds={participantIds}
        onChange={onParticipantIdsChange}
        label="参与人筛选（任意匹配）"
      />
    </div>
  );
}
