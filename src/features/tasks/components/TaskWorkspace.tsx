import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/stores/useProjectStore';
import { toTaskQuery, useTaskFilterStore } from '@/stores/useTaskFilterStore';
import { useTaskStore } from '@/stores/useTaskStore';
import type { TaskWithProject } from '@/types';
import { BulkEditBar } from './BulkEditBar';
import { BulkEditDialog } from './BulkEditDialog';
import { DeleteTaskDialog } from './DeleteTaskDialog';
import { TaskFilters } from './TaskFilters';
import { TaskForm } from './TaskForm';
import { TaskList } from './TaskList';

interface TaskWorkspaceProps {
  /** When set, the list is scoped to that project and the project filter is hidden. */
  projectId: string | null;
  /** False for an archived project — creating tasks there is forbidden. */
  canCreate: boolean;
  /** Explains why creation is unavailable, shown next to the disabled button. */
  createHint: string | null;
}

/**
 * The task list plus its filters, forms and confirmations. Shared by the
 * cross-project "my tasks" view and a single project's task section, so both
 * behave identically.
 */
export function TaskWorkspace({ projectId, canCreate, createHint }: TaskWorkspaceProps) {
  const tasks = useTaskStore((state) => state.tasks);
  const loading = useTaskStore((state) => state.loading);
  const error = useTaskStore((state) => state.error);
  const loadTasks = useTaskStore((state) => state.loadTasks);
  const listByProject = useTaskStore((state) => state.listByProject);
  const countChildren = useTaskStore((state) => state.countChildren);
  const createTask = useTaskStore((state) => state.createTask);
  const updateTask = useTaskStore((state) => state.updateTask);
  const deleteTask = useTaskStore((state) => state.deleteTask);
  const bulkUpdateTasks = useTaskStore((state) => state.bulkUpdateTasks);

  const projectOptions = useProjectStore((state) => state.options);
  const loadOptions = useProjectStore((state) => state.loadOptions);

  const search = useTaskFilterStore((state) => state.search);
  const statuses = useTaskFilterStore((state) => state.statuses);
  const priorities = useTaskFilterStore((state) => state.priorities);
  const projectIds = useTaskFilterStore((state) => state.projectIds);
  const dueFrom = useTaskFilterStore((state) => state.dueFrom);
  const dueTo = useTaskFilterStore((state) => state.dueTo);
  const sortBy = useTaskFilterStore((state) => state.sortBy);
  const selectedIds = useTaskFilterStore((state) => state.selectedIds);
  const setSearch = useTaskFilterStore((state) => state.setSearch);
  const setStatuses = useTaskFilterStore((state) => state.setStatuses);
  const setPriorities = useTaskFilterStore((state) => state.setPriorities);
  const setProjectIds = useTaskFilterStore((state) => state.setProjectIds);
  const setDueRange = useTaskFilterStore((state) => state.setDueRange);
  const setSortBy = useTaskFilterStore((state) => state.setSortBy);
  const toggleSelected = useTaskFilterStore((state) => state.toggleSelected);
  const clearSelection = useTaskFilterStore((state) => state.clearSelection);
  const resetFilters = useTaskFilterStore((state) => state.reset);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TaskWithProject | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskWithProject | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const query = useMemo(
    () =>
      toTaskQuery(
        { search, statuses, priorities, projectIds, dueFrom, dueTo, sortBy },
        projectId ?? undefined,
      ),
    [search, statuses, priorities, projectIds, dueFrom, dueTo, sortBy, projectId],
  );

  useEffect(() => {
    void loadTasks(query);
  }, [loadTasks, query]);

  // Switching between views must not carry a stale selection into the new list.
  useEffect(() => {
    clearSelection();
  }, [clearSelection, projectId]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  const loadProjectTasks = useCallback(async (id: string) => listByProject(id), [listByProject]);
  const loadChildCount = useCallback(async (id: string) => countChildren(id), [countChildren]);

  // Selecting a task and then filtering it away must not leave it in the patch.
  const visibleSelectedIds = selectedIds.filter((id) => tasks.some((task) => task.id === id));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="text-sm text-muted-foreground">
          共 {String(tasks.length)} 个任务符合当前筛选条件。
        </div>
        <div className="flex items-center gap-2">
          {!canCreate && createHint !== null && (
            <span className="text-sm text-muted-foreground">{createHint}</span>
          )}
          <Button
            disabled={!canCreate}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden />
            新建任务
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <TaskFilters
          search={search}
          statuses={statuses}
          priorities={priorities}
          projectIds={projectIds}
          dueFrom={dueFrom}
          dueTo={dueTo}
          sortBy={sortBy}
          {...(projectId === null ? { projects: projectOptions } : {})}
          onSearchChange={setSearch}
          onStatusesChange={setStatuses}
          onPrioritiesChange={setPriorities}
          onProjectIdsChange={setProjectIds}
          onDueRangeChange={setDueRange}
          onSortChange={setSortBy}
          onReset={resetFilters}
        />
      </div>

      <BulkEditBar
        count={visibleSelectedIds.length}
        onEdit={() => {
          setBulkOpen(true);
        }}
        onClear={clearSelection}
      />

      {loading ? (
        <LoadingState label="正在加载任务…" />
      ) : error !== null ? (
        <ErrorState
          title="无法读取任务"
          message={error}
          onRetry={() => {
            void loadTasks(query);
          }}
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          title="还没有符合条件的任务"
          description={
            canCreate ? '调整筛选条件，或新建一个任务。' : '调整筛选条件即可查看已有任务。'
          }
        />
      ) : (
        <TaskList
          tasks={tasks}
          selectedIds={visibleSelectedIds}
          showProject={projectId === null}
          onToggleSelect={toggleSelected}
          onEdit={(task) => {
            setEditing(task);
            setFormOpen(true);
          }}
          onDelete={setDeleteTarget}
        />
      )}

      <TaskForm
        open={formOpen}
        task={editing}
        projectId={projectId ?? ''}
        projects={projectOptions}
        loadProjectTasks={loadProjectTasks}
        onSubmit={async (input) => {
          if (editing === null) {
            await createTask(input, query);
          } else {
            await updateTask(editing.id, input, query);
          }
        }}
        onClose={() => {
          setFormOpen(false);
        }}
      />

      <DeleteTaskDialog
        task={deleteTarget}
        loadChildCount={loadChildCount}
        onCancel={() => {
          setDeleteTarget(null);
        }}
        onConfirm={async (target) => {
          await deleteTask(target.id, query);
          setDeleteTarget(null);
        }}
      />

      <BulkEditDialog
        open={bulkOpen}
        count={visibleSelectedIds.length}
        onSubmit={async (patch) => {
          await bulkUpdateTasks(visibleSelectedIds, patch, query);
          clearSelection();
        }}
        onClose={() => {
          setBulkOpen(false);
        }}
      />
    </div>
  );
}
