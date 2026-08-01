import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Button } from '@/components/ui/button';
import { toAppError } from '@/lib/errors';
import { getPeopleService } from '@/services/people.service';
import { useProjectStore } from '@/stores/useProjectStore';
import type { Person, Project } from '@/types';
import { DeleteProjectDialog } from '../components/DeleteProjectDialog';
import { ProjectFilters } from '../components/ProjectFilters';
import { ProjectForm } from '../components/ProjectForm';
import { ProjectListItem } from '../components/ProjectListItem';
import { ReorderHandle } from '@/features/sorting/ReorderHandle';
import { SavedOrderControls } from '@/features/sorting/SavedOrderControls';
import { useSavedListOrder } from '@/features/sorting/useSavedListOrder';

/** Project list: search, filter, sort, create/edit, archive/restore, permanent delete. */
export function ProjectListPage() {
  const projects = useProjectStore((state) => state.projects);
  const progress = useProjectStore((state) => state.progress);
  const loading = useProjectStore((state) => state.loading);
  const error = useProjectStore((state) => state.error);
  const filters = useProjectStore((state) => state.filters);
  const setFilters = useProjectStore((state) => state.setFilters);
  const loadProjects = useProjectStore((state) => state.loadProjects);
  const createProject = useProjectStore((state) => state.createProject);
  const updateProject = useProjectStore((state) => state.updateProject);
  const archiveProject = useProjectStore((state) => state.archiveProject);
  const restoreProject = useProjectStore((state) => state.restoreProject);
  const countDeleteImpact = useProjectStore((state) => state.countDeleteImpact);
  const deleteProjectPermanently = useProjectStore((state) => state.deleteProjectPermanently);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [people, setPeople] = useState<readonly Person[]>([]);
  const [formParticipantIds, setFormParticipantIds] = useState<string[]>([]);
  const [participantsByProject, setParticipantsByProject] = useState<
    Readonly<Record<string, readonly string[]>>
  >({});
  const savedOrder = useSavedListOrder('projects', '', projects);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const reorderDisabled =
    filters.search.trim() !== '' ||
    filters.status !== null ||
    filters.participantIds.length > 0 ||
    filters.scope !== 'active';
  const reorderReason = reorderDisabled ? '清除搜索或筛选后可调整自定义顺序' : null;

  useEffect(() => {
    void loadProjects();
  }, [loadProjects, filters]);

  useEffect(() => {
    void getPeopleService()
      .then((service) => service.listPeople())
      .then(setPeople)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void getPeopleService()
      .then((service) => service.listProjectParticipants(projects.map((project) => project.id)))
      .then((participants) => {
        const grouped: Record<string, string[]> = {};
        for (const participant of participants) {
          (grouped[participant.project_id] ??= []).push(participant.person_name);
        }
        setParticipantsByProject(grouped);
      })
      .catch(() => undefined);
  }, [projects]);

  const openCreate = () => {
    setEditing(null);
    setFormParticipantIds([]);
    setFormOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditing(project);
    void getPeopleService()
      .then((service) => service.listProjectParticipants([project.id]))
      .then((participants) => {
        setFormParticipantIds(participants.map((participant) => participant.person_id));
      });
    setFormOpen(true);
  };

  const runAction = async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
    } catch (caught) {
      setActionError(toAppError(caught).message);
    }
  };

  const loadImpact = useCallback(async (id: string) => countDeleteImpact(id), [countDeleteImpact]);

  return (
    <div className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">项目</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            所有数据保存在本机，共 {String(projects.length)} 个项目符合当前筛选条件。
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden />
          新建项目
        </Button>
      </header>

      <div className="mb-6">
        <ProjectFilters
          search={filters.search}
          status={filters.status}
          scope={filters.scope}
          sort={filters.sort}
          people={people}
          participantIds={filters.participantIds}
          onSearchChange={(search) => {
            setFilters({ search });
          }}
          onStatusChange={(status) => {
            setFilters({ status });
          }}
          onScopeChange={(scope) => {
            setFilters({ scope });
          }}
          onSortChange={(sort) => {
            setFilters({ sort });
          }}
          onParticipantIdsChange={(participantIds) => {
            setFilters({ participantIds });
          }}
        />
        <div className="mt-3">
          <SavedOrderControls controller={savedOrder} disabledReason={reorderReason} />
        </div>
      </div>

      {actionError !== null && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

      {loading ? (
        <LoadingState label="正在加载项目…" />
      ) : error !== null ? (
        <ErrorState
          title="无法读取项目"
          message={error}
          onRetry={() => {
            void loadProjects();
          }}
        />
      ) : projects.length === 0 ? (
        <EmptyState
          title="还没有符合条件的项目"
          description="调整筛选条件，或新建一个项目开始跟踪工作。"
          action={<Button onClick={openCreate}>新建项目</Button>}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {savedOrder.displayedItems.map((project) => (
            <ProjectListItem
              key={project.id}
              project={project}
              progress={progress[project.id]}
              onEdit={openEdit}
              onArchive={setArchiveTarget}
              onRestore={(target) => {
                void runAction(async () => restoreProject(target.id));
              }}
              onDelete={setDeleteTarget}
              participantNames={participantsByProject[project.id] ?? []}
              draggable={savedOrder.mode !== 'dynamic' && !reorderDisabled}
              onDragStart={() => setDraggedId(project.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggedId !== null && draggedId !== project.id) {
                  savedOrder.moveBefore(draggedId, project.id);
                }
                setDraggedId(null);
              }}
              reorderHandle={
                savedOrder.mode === 'dynamic' ? undefined : (
                  <ReorderHandle
                    label={project.name}
                    disabled={reorderDisabled}
                    onMoveUp={() => savedOrder.move(project.id, -1)}
                    onMoveDown={() => savedOrder.move(project.id, 1)}
                  />
                )
              }
            />
          ))}
        </ul>
      )}

      <ProjectForm
        open={formOpen}
        project={editing}
        people={people}
        participantIds={formParticipantIds}
        onSubmit={async (input, participantIds) => {
          const service = await getPeopleService();
          if (editing === null) {
            const project = await createProject(input);
            await service.setProjectParticipants(project.id, participantIds);
          } else {
            await updateProject(editing.id, input);
            await service.setProjectParticipants(editing.id, participantIds);
          }
          setPeople(await service.listPeople());
          await loadProjects();
        }}
        onClose={() => {
          setFormOpen(false);
        }}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        title="归档项目"
        description={
          archiveTarget === null
            ? ''
            : `归档「${archiveTarget.name}」后将无法在该项目下新建任务，已有数据保留，可随时恢复。`
        }
        confirmLabel="归档"
        onCancel={() => {
          setArchiveTarget(null);
        }}
        onConfirm={() => {
          const target = archiveTarget;
          setArchiveTarget(null);
          if (target !== null) {
            void runAction(async () => archiveProject(target.id));
          }
        }}
      />

      <DeleteProjectDialog
        project={deleteTarget}
        loadImpact={loadImpact}
        onCancel={() => {
          setDeleteTarget(null);
        }}
        onConfirm={async (target) => {
          await deleteProjectPermanently(target.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
