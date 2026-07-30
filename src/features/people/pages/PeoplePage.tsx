import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toAppError } from '@/lib/errors';
import { getPeopleService } from '@/services/people.service';
import type { Person, PersonWithCounts } from '@/types';
import { PersonForm } from '../components/PersonForm';

interface DeleteImpact {
  projectCount: number;
  taskCount: number;
}

export function PeoplePage() {
  const [people, setPeople] = useState<readonly PersonWithCounts[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [deleting, setDeleting] = useState<PersonWithCounts | null>(null);
  const [impact, setImpact] = useState<DeleteImpact | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const service = await getPeopleService();
      setPeople(await service.listPeopleWithCounts(search));
    } catch (caught) {
      setError(toAppError(caught).message);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (deleting === null) {
      setImpact(null);
      return;
    }
    void getPeopleService()
      .then((service) => service.countDeleteImpact(deleting.id))
      .then(setImpact)
      .catch((caught: unknown) => {
        setError(toAppError(caught).message);
        setDeleting(null);
      });
  }, [deleting]);

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">人物</h1>
          <p className="text-sm text-muted-foreground">管理人员资料及独立的项目、任务参与关系。</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden />
          新建人员
        </Button>
      </header>

      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          aria-label="搜索人物"
          className="pl-9"
          placeholder="按姓名、邮箱或角色搜索"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </div>

      {error !== null ? (
        <ErrorState title="无法读取人物" message={error} onRetry={() => void load()} />
      ) : people === null ? (
        <LoadingState label="正在加载人物…" />
      ) : people.length === 0 ? (
        <EmptyState
          title="还没有符合条件的人物"
          description={search === '' ? '新建人员后可分配项目和任务参与关系。' : '请调整搜索条件。'}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">姓名</th>
                <th className="px-4 py-3 font-medium">角色</th>
                <th className="px-4 py-3 font-medium">邮箱</th>
                <th className="px-4 py-3 font-medium">参与项目</th>
                <th className="px-4 py-3 font-medium">参与任务</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id} className="border-t">
                  <td className="px-4 py-3">
                    <Link className="font-medium text-primary hover:underline" to={`/people/${person.id}`}>
                      {person.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{person.role ?? '未设置'}</td>
                  <td className="px-4 py-3">{person.email ?? '未设置'}</td>
                  <td className="px-4 py-3">{String(person.project_count)}</td>
                  <td className="px-4 py-3">{String(person.task_count)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`编辑 ${person.name}`}
                        onClick={() => {
                          setEditing(person);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`删除 ${person.name}`}
                        onClick={() => {
                          setDeleting(person);
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PersonForm
        open={formOpen}
        person={editing}
        onSubmit={async (input) => {
          const service = await getPeopleService();
          if (editing === null) {
            await service.createPerson(input);
          } else {
            await service.updatePerson(editing.id, input);
          }
          await load();
        }}
        onClose={() => {
          setFormOpen(false);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="删除人员"
        destructive
        confirmLabel="确认删除"
        busy={impact === null}
        description={
          deleting === null
            ? ''
            : impact === null
              ? '正在统计将解除的参与关系…'
              : `删除「${deleting.name}」将解除 ${String(impact.projectCount)} 个项目参与关系和 ${String(impact.taskCount)} 个任务参与关系。项目和任务本身不会删除。`
        }
        onCancel={() => {
          setDeleting(null);
        }}
        onConfirm={() => {
          const target = deleting;
          if (target === null) return;
          void getPeopleService()
            .then((service) => service.deletePerson(target.id))
            .then(async () => {
              setDeleting(null);
              await load();
            })
            .catch((caught: unknown) => {
              setError(toAppError(caught).message);
            });
        }}
      />
    </div>
  );
}
