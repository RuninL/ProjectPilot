import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PROJECT_STATUS_OPTIONS } from '@/lib/labels';
import type { ProjectScope, ProjectSort } from '@/repositories';
import type { ProjectStatus } from '@/types';

const SCOPE_OPTIONS: { value: ProjectScope; label: string }[] = [
  { value: 'active', label: '活动' },
  { value: 'archived', label: '已归档' },
  { value: 'all', label: '全部' },
];

const SORT_OPTIONS: { value: ProjectSort; label: string }[] = [
  { value: 'updated_at', label: '最近更新' },
  { value: 'name', label: '名称' },
  { value: 'target_end_date', label: '目标结束日期' },
];

function isScope(value: string): value is ProjectScope {
  return SCOPE_OPTIONS.some((option) => option.value === value);
}

interface ProjectFiltersProps {
  search: string;
  status: ProjectStatus | null;
  scope: ProjectScope;
  sort: ProjectSort;
  onSearchChange: (search: string) => void;
  onStatusChange: (status: ProjectStatus | null) => void;
  onScopeChange: (scope: ProjectScope) => void;
  onSortChange: (sort: ProjectSort) => void;
}

/** Search / status / archive-scope / sort controls for the project list. */
export function ProjectFilters({
  search,
  status,
  scope,
  sort,
  onSearchChange,
  onStatusChange,
  onScopeChange,
  onSortChange,
}: ProjectFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="project-search">搜索</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="project-search"
            className="w-64 pl-9"
            placeholder="搜索项目名称或描述"
            value={search}
            onChange={(event) => {
              onSearchChange(event.target.value);
            }}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="project-status-filter">状态</Label>
        <select
          id="project-status-filter"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={status ?? ''}
          onChange={(event) => {
            const next = event.target.value;
            onStatusChange(next === '' ? null : (next as ProjectStatus));
          }}
        >
          <option value="">全部状态</option>
          {PROJECT_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="project-sort">排序</Label>
        <select
          id="project-sort"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={sort}
          onChange={(event) => {
            onSortChange(event.target.value as ProjectSort);
          }}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <Tabs
        value={scope}
        onValueChange={(next) => {
          if (isScope(next)) {
            onScopeChange(next);
          }
        }}
      >
        <TabsList>
          {SCOPE_OPTIONS.map((option) => (
            <TabsTrigger key={option.value} value={option.value}>
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
