import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { toAppError } from '@/lib/errors';
import { getPeopleService } from '@/services/people.service';
import type { Person } from '@/types';
import { ParticipantSelector } from './ParticipantSelector';

interface PendingRemoval {
  person: Person;
  taskCount: number;
}

export function ProjectParticipantsSection({ projectId }: { projectId: string }) {
  const [people, setPeople] = useState<readonly Person[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const service = await getPeopleService();
    const [allPeople, participants] = await Promise.all([
      service.listPeople(),
      service.listProjectParticipants([projectId]),
    ]);
    setPeople(allPeople);
    setSelectedIds(participants.map((participant) => participant.person_id));
  }, [projectId]);

  useEffect(() => {
    void load().catch((caught: unknown) => {
      setError(toAppError(caught).message);
    });
  }, [load]);

  const change = (ids: string[]) => {
    const added = ids.find((id) => !selectedIds.includes(id));
    const removed = selectedIds.find((id) => !ids.includes(id));
    if (added !== undefined) {
      void getPeopleService()
        .then((service) =>
          service.addProjectParticipant(added, { project_id: projectId, role: '' }),
        )
        .then(load)
        .catch((caught: unknown) => {
          setError(toAppError(caught).message);
        });
      return;
    }
    if (removed !== undefined) {
      const person = people.find((candidate) => candidate.id === removed);
      if (person === undefined) return;
      void getPeopleService()
        .then(async (service) => ({
          person,
          taskCount: await service.countTaskAssignmentsInProject(projectId, removed),
        }))
        .then(setPendingRemoval);
    }
  };

  return (
    <div className="space-y-2">
      <ParticipantSelector
        id="project-detail-participants"
        people={people}
        selectedIds={selectedIds}
        onChange={change}
      />
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
      <ConfirmDialog
        open={pendingRemoval !== null}
        title="移除项目参与人"
        destructive
        confirmLabel="仅从项目移除"
        description={
          pendingRemoval === null
            ? ''
            : `${pendingRemoval.person.name} 仍分配到本项目的 ${String(pendingRemoval.taskCount)} 个任务。移除项目参与关系不会移除任何任务分配，请另行处理。`
        }
        onCancel={() => {
          setPendingRemoval(null);
        }}
        onConfirm={() => {
          const target = pendingRemoval;
          if (target === null) return;
          void getPeopleService()
            .then((service) => service.removeProjectParticipant(target.person.id, projectId))
            .then(async () => {
              setPendingRemoval(null);
              await load();
            });
        }}
      />
    </div>
  );
}
