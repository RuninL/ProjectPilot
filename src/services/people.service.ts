import { nowIso } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/uuid';
import {
  getRepositories,
  type PeopleRepository,
  type ProjectRepository,
  type TaskRepository,
} from '@/repositories';
import type {
  Person,
  PersonProjectParticipation,
  PersonTaskParticipation,
  ProjectParticipant,
  ProjectStatus,
  TaskParticipant,
  TaskParticipantPerson,
  TaskPriority,
  TaskStatus,
  PersonWithCounts,
  ProjectParticipantPerson,
} from '@/types';
import {
  personInputSchema,
  projectParticipantInputSchema,
  taskParticipantInputSchema,
  type PersonInput,
  type ProjectParticipantInput,
  type TaskParticipantInput,
} from './schemas';

export interface PeopleServiceDeps {
  people: PeopleRepository;
  projects: ProjectRepository;
  tasks: TaskRepository;
}

export type ParticipationSource = 'project_only' | 'task_only' | 'both';

export interface ParticipationTask {
  taskId: string;
  taskTitle: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  assignedAt: string;
}

export interface PersonProjectGroup {
  projectId: string | null;
  projectName: string;
  projectStatus: ProjectStatus | null;
  source: ParticipationSource;
  projectRole: string | null;
  joinedAt: string | null;
  tasks: ParticipationTask[];
}

interface MutableProjectGroup extends PersonProjectGroup {
  hasProjectParticipation: boolean;
  hasTaskParticipation: boolean;
}

const UNASSIGNED_KEY = '\0unassigned';

/**
 * Merge direct project participation and task participation without inferring
 * either relationship from the other. Exported for deterministic unit testing.
 */
export function groupPersonParticipation(
  projectParticipations: readonly PersonProjectParticipation[],
  taskParticipations: readonly PersonTaskParticipation[],
): PersonProjectGroup[] {
  const groups = new Map<string, MutableProjectGroup>();

  for (const participation of projectParticipations) {
    groups.set(participation.project_id, {
      projectId: participation.project_id,
      projectName: participation.project_name,
      projectStatus: participation.project_status,
      source: 'project_only',
      projectRole: participation.role,
      joinedAt: participation.joined_at,
      tasks: [],
      hasProjectParticipation: true,
      hasTaskParticipation: false,
    });
  }

  for (const participation of taskParticipations) {
    const key = participation.project_id ?? UNASSIGNED_KEY;
    const current = groups.get(key) ?? {
      projectId: participation.project_id,
      projectName: participation.project_name ?? '未归属',
      projectStatus: participation.project_status,
      source: 'task_only' as const,
      projectRole: null,
      joinedAt: null,
      tasks: [],
      hasProjectParticipation: false,
      hasTaskParticipation: false,
    };
    current.tasks.push({
      taskId: participation.task_id,
      taskTitle: participation.task_title,
      status: participation.task_status,
      priority: participation.task_priority,
      dueDate: participation.task_due_date,
      assignedAt: participation.assigned_at,
    });
    current.hasTaskParticipation = true;
    groups.set(key, current);
  }

  return [...groups.values()]
    .map(({ hasProjectParticipation, hasTaskParticipation, ...group }) => ({
      ...group,
      source:
        hasProjectParticipation && hasTaskParticipation
          ? ('both' as const)
          : hasProjectParticipation
            ? ('project_only' as const)
            : ('task_only' as const),
    }))
    .sort((left, right) => {
      if (left.projectId === null) return 1;
      if (right.projectId === null) return -1;
      return left.projectName.localeCompare(right.projectName, 'zh-CN');
    });
}

export function createPeopleService(deps: PeopleServiceDeps) {
  async function requirePerson(id: string): Promise<Person> {
    const person = await deps.people.findById(id);
    if (person === null) {
      throw new AppError('not_found', '人员不存在或已被删除');
    }
    return person;
  }

  return {
    async listPeople(): Promise<Person[]> {
      return deps.people.findAll();
    },

    async listPeopleWithCounts(search = ''): Promise<PersonWithCounts[]> {
      return deps.people.findAllWithCounts(search);
    },

    async getPerson(id: string): Promise<Person> {
      return requirePerson(id);
    },

    async createPerson(input: PersonInput): Promise<Person> {
      const parsed = personInputSchema.parse(input);
      const now = nowIso();
      const person: Person = {
        id: newId(),
        name: parsed.name,
        email: parsed.email,
        role: parsed.role,
        note: parsed.note,
        created_at: now,
        updated_at: now,
      };
      await deps.people.insert(person);
      return person;
    },

    async updatePerson(id: string, input: PersonInput): Promise<Person> {
      await requirePerson(id);
      const parsed = personInputSchema.parse(input);
      await deps.people.update(
        id,
        { name: parsed.name, email: parsed.email, role: parsed.role, note: parsed.note },
        nowIso(),
      );
      return requirePerson(id);
    },

    async deletePerson(id: string): Promise<void> {
      await requirePerson(id);
      await deps.people.deleteById(id);
    },

    async countDeleteImpact(id: string): Promise<{ projectCount: number; taskCount: number }> {
      await requirePerson(id);
      return deps.people.countDeleteImpact(id);
    },

    async listProjectParticipants(
      projectIds: readonly string[],
    ): Promise<ProjectParticipantPerson[]> {
      return deps.people.findProjectParticipantsByProjectIds(projectIds);
    },

    async listTaskParticipants(taskIds: readonly string[]): Promise<TaskParticipantPerson[]> {
      return deps.people.findTaskParticipantsByTaskIds(taskIds);
    },

    async countTaskAssignmentsInProject(projectId: string, personId: string): Promise<number> {
      return deps.people.countTaskAssignmentsInProject(projectId, personId);
    },

    async setProjectParticipants(projectId: string, personIds: readonly string[]): Promise<void> {
      if ((await deps.projects.findById(projectId)) === null) {
        throw new AppError('not_found', '项目不存在或已被删除');
      }
      const wanted = new Set(personIds);
      const current = await deps.people.findProjectParticipantsByProjectIds([projectId]);
      for (const participant of current) {
        if (!wanted.has(participant.person_id)) {
          await deps.people.deleteProjectParticipant(projectId, participant.person_id);
        }
      }
      const currentIds = new Set(current.map((participant) => participant.person_id));
      for (const personId of wanted) {
        if (!currentIds.has(personId)) {
          await this.addProjectParticipant(personId, { project_id: projectId, role: '' });
        }
      }
    },

    async setTaskParticipants(taskId: string, personIds: readonly string[]): Promise<void> {
      if ((await deps.tasks.findById(taskId)) === null) {
        throw new AppError('not_found', '任务不存在或已被删除');
      }
      const wanted = new Set(personIds);
      const current = await deps.people.findTaskParticipantsByTaskIds([taskId]);
      for (const participant of current) {
        if (!wanted.has(participant.person_id)) {
          await deps.people.deleteTaskParticipant(taskId, participant.person_id);
        }
      }
      const currentIds = new Set(current.map((participant) => participant.person_id));
      for (const personId of wanted) {
        if (!currentIds.has(personId)) {
          await this.addTaskParticipant(personId, { task_id: taskId });
        }
      }
    },

    async addProjectParticipant(
      personId: string,
      input: ProjectParticipantInput,
    ): Promise<ProjectParticipant> {
      await requirePerson(personId);
      const parsed = projectParticipantInputSchema.parse(input);
      if ((await deps.projects.findById(parsed.project_id)) === null) {
        throw new AppError('not_found', '项目不存在或已被删除');
      }
      if ((await deps.people.findProjectParticipant(parsed.project_id, personId)) !== null) {
        throw new AppError('conflict', '该人员已加入此项目');
      }
      const participant: ProjectParticipant = {
        project_id: parsed.project_id,
        person_id: personId,
        role: parsed.role,
        joined_at: nowIso(),
      };
      await deps.people.insertProjectParticipant(participant);
      return participant;
    },

    async removeProjectParticipant(personId: string, projectId: string): Promise<void> {
      await requirePerson(personId);
      if ((await deps.people.findProjectParticipant(projectId, personId)) === null) {
        throw new AppError('not_found', '该人员未加入此项目');
      }
      await deps.people.deleteProjectParticipant(projectId, personId);
    },

    async addTaskParticipant(
      personId: string,
      input: TaskParticipantInput,
    ): Promise<TaskParticipant> {
      await requirePerson(personId);
      const parsed = taskParticipantInputSchema.parse(input);
      if ((await deps.tasks.findById(parsed.task_id)) === null) {
        throw new AppError('not_found', '任务不存在或已被删除');
      }
      if ((await deps.people.findTaskParticipant(parsed.task_id, personId)) !== null) {
        throw new AppError('conflict', '该人员已参与此任务');
      }
      const participant: TaskParticipant = {
        task_id: parsed.task_id,
        person_id: personId,
        assigned_at: nowIso(),
      };
      await deps.people.insertTaskParticipant(participant);
      return participant;
    },

    async removeTaskParticipant(personId: string, taskId: string): Promise<void> {
      await requirePerson(personId);
      if ((await deps.people.findTaskParticipant(taskId, personId)) === null) {
        throw new AppError('not_found', '该人员未参与此任务');
      }
      await deps.people.deleteTaskParticipant(taskId, personId);
    },

    async getPersonProjects(personId: string): Promise<PersonProjectGroup[]> {
      await requirePerson(personId);
      const [projects, tasks] = await Promise.all([
        deps.people.findProjectParticipantsByPerson(personId),
        deps.people.findTaskParticipantsByPerson(personId),
      ]);
      return groupPersonParticipation(projects, tasks);
    },
  };
}

export type PeopleService = ReturnType<typeof createPeopleService>;

export async function getPeopleService(): Promise<PeopleService> {
  const repositories = await getRepositories();
  return createPeopleService({
    people: repositories.people,
    projects: repositories.projects,
    tasks: repositories.tasks,
  });
}
