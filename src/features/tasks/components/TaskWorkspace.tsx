import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getPeopleService } from '@/services/people.service';
import { useProjectStore } from '@/stores/useProjectStore';
import { toTaskQuery, useTaskFilterStore } from '@/stores/useTaskFilterStore';
import { useTaskStore } from '@/stores/useTaskStore';
import type { TaskScope } from '@/repositories';
import type { Person, TaskWithProject } from '@/types';
import { BulkEditBar } from './BulkEditBar';
import { BulkEditDialog } from './BulkEditDialog';
import { DeleteTaskDialog } from './DeleteTaskDialog';
import { TaskFilters } from './TaskFilters';
import { TaskForm } from './TaskForm';
import { TaskList } from './TaskList';
import { SavedOrderControls } from '@/features/sorting/SavedOrderControls';
import { useSectionedListOrder } from '@/features/sorting/useSavedListOrder';

interface TaskWorkspaceProps {
  /** When set, the list is scoped to that project and the project filter is hidden. */
  projectId: string | null;
  /** False for an archived project — creating tasks there is forbidden. */
  canCreate: boolean;
  /** Explains why creation is unavailable, shown next to the disabled button. */
  createHint: string | null;
}

const SCOPE_OPTIONS: { value: TaskScope; label: string }[] = [
  { value: 'active', label: '活动任务' },
  { value: 'archived', label: '已归档任务' },
  { value: 'all', label: '全部任务' },
];

function isTaskScope(value: string): value is TaskScope {
  return SCOPE_OPTIONS.some((option) => option.value === value);
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
  const archiveTask = useTaskStore((state) => state.archiveTask);
  const restoreTask = useTaskStore((state) => state.restoreTask);

  const projectOptions = useProjectStore((state) => state.options);
  const loadOptions = useProjectStore((state) => state.loadOptions);

  const search = useTaskFilterStore((state) => state.search);
  const statuses = useTaskFilterStore((state) => state.statuses);
  const priorities = useTaskFilterStore((state) => state.priorities);
  const projectIds = useTaskFilterStore((state) => state.projectIds);
  const participantIds = useTaskFilterStore((state) => state.participantIds);
  const dueFrom = useTaskFilterStore((state) => state.dueFrom);
  const dueTo = useTaskFilterStore((state) => state.dueTo);
  const sortBy = useTaskFilterStore((state) => state.sortBy);
  const scope = useTaskFilterStore((state) => state.scope);
  const selectedIds = useTaskFilterStore((state) => state.selectedIds);
  const setSearch = useTaskFilterStore((state) => state.setSearch);
  const setStatuses = useTaskFilterStore((state) => state.setStatuses);
  const setPriorities = useTaskFilterStore((state) => state.setPriorities);
  const setProjectIds = useTaskFilterStore((state) => state.setProjectIds);
  const setParticipantIds = useTaskFilterStore((state) => state.setParticipantIds);
  const setDueRange = useTaskFilterStore((state) => state.setDueRange);
  const setSortBy = useTaskFilterStore((state) => state.setSortBy);
  const setScope = useTaskFilterStore((state) => state.setScope);
  const toggleSelected = useTaskFilterStore((state) => state.toggleSelected);
  const clearSelection = useTaskFilterStore((state) => state.clearSelection);
  const resetFilters = useTaskFilterStore((state) => state.reset);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TaskWithProject | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskWithProject | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [people, setPeople] = useState<readonly Person[]>([]);
  const [formParticipantIds, setFormParticipantIds] = useState<string[]>([]);
  const [participantsByTask, setParticipantsByTask] = useState<
    Readonly<Record<string, readonly string[]>>
  >({});
  // One named order carries three sub-orders (active / archived / all); the
  // visible scope selects which sub-order is read and written. Search/filters
  // no longer disable reordering — dragging while filtered only rearranges the
  // visible rows inside the saved full order.
  const savedOrder = useSectionedListOrder(
    projectId === null ? 'tasks' : 'project_tasks',
    projectId ?? '',
    { [scope]: tasks },
  );
  const scopeSection = savedOrder.section(scope);

  const query = useMemo(
    () =>
      toTaskQuery(
        { search, statuses, priorities, projectIds, participantIds, dueFrom, dueTo, sortBy, scope },
        projectId ?? undefined,
      ),
    [
      search,
      statuses,
      priorities,
      projectIds,
      participantIds,
      dueFrom,
      dueTo,
      sortBy,
      scope,
      projectId,
    ],
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

  useEffect(() => {
    void getPeopleService()
      .then((service) => service.listPeople())
      .then(setPeople)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void getPeopleService()
      .then((service) => service.listTaskParticipants(tasks.map((task) => task.id)))
      .then((participants) => {
        const grouped: Record<string, string[]> = {};
        for (const participant of participants) {
          (grouped[participant.task_id] ??= []).push(participant.person_name);
        }
        setParticipantsByTask(grouped);
      })
      .catch(() => undefined);
  }, [tasks]);

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
              setFormParticipantIds([]);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden />
            新建任务
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <Tabs
          value={scope}
          onValueChange={(next) => {
            if (isTaskScope(next)) {
              setScope(next);
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

      <div className="mb-4">
        <TaskFilters
          search={search}
          statuses={statuses}
          priorities={priorities}
          projectIds={projectIds}
          dueFrom={dueFrom}
          dueTo={dueTo}
          sortBy={sortBy}
          people={people}
          participantIds={participantIds}
          {...(projectId === null ? { projects: projectOptions } : {})}
          onSearchChange={setSearch}
          onStatusesChange={setStatuses}
          onPrioritiesChange={setPriorities}
          onProjectIdsChange={setProjectIds}
          onDueRangeChange={setDueRange}
          onSortChange={setSortBy}
          onParticipantIdsChange={setParticipantIds}
          onReset={resetFilters}
        />
        <div className="mt-3">
          <SavedOrderControls controller={savedOrder} disabledReason={null} />
        </div>
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
          tasks={scopeSection.displayedItems}
          selectedIds={visibleSelectedIds}
          showProject={projectId === null}
          onToggleSelect={toggleSelected}
          onEdit={(task) => {
            setEditing(task);
            void getPeopleService()
              .then((service) => service.listTaskParticipants([task.id]))
              .then((participants) => {
                setFormParticipantIds(participants.map((participant) => participant.person_id));
              });
            setFormOpen(true);
          }}
          onDelete={setDeleteTarget}
          onArchive={(task) => {
            void archiveTask(task.id, query);
          }}
          onRestore={(task) => {
            void restoreTask(task.id, query);
          }}
          participantsByTask={participantsByTask}
          reorderEnabled={savedOrder.mode !== 'dynamic'}
          onMove={scopeSection.move}
          onMoveTo={scopeSection.moveTo}
        />
      )}

      <TaskForm
        open={formOpen}
        task={editing}
        projectId={projectId ?? ''}
        projects={projectOptions}
        people={people}
        participantIds={formParticipantIds}
        loadProjectTasks={loadProjectTasks}
        loadProjectParticipantIds={async (id) => {
          const service = await getPeopleService();
          const participants = await service.listProjectParticipants([id]);
          return participants.map((participant) => participant.person_id);
        }}
        onAddProjectParticipant={async (id, personId) => {
          const service = await getPeopleService();
          await service.addProjectParticipant(personId, { project_id: id, role: '' });
        }}
        onSubmit={async (input, selectedParticipantIds) => {
          const service = await getPeopleService();
          if (editing === null) {
            const task = await createTask(input, query);
            await service.setTaskParticipants(task.id, selectedParticipantIds);
          } else {
            await updateTask(editing.id, input, query);
            await service.setTaskParticipants(editing.id, selectedParticipantIds);
          }
          await loadTasks(query);
        }}
        onClose={() => {
          setFormOpen(false);
          setFormParticipantIds([]);
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
