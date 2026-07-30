import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getPeopleService } from '@/services/people.service';
import type { Person } from '@/types';

interface ParticipantSelectorProps {
  id: string;
  label?: string;
  people: readonly Person[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  allowCreate?: boolean;
  onPersonCreated?: (person: Person) => void;
}

export function ParticipantSelector({
  id,
  label = '参与人',
  people,
  selectedIds,
  onChange,
  allowCreate = false,
  onPersonCreated,
}: ParticipantSelectorProps) {
  const [name, setName] = useState('');

  return (
    <fieldset className="grid gap-2 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <p className="text-xs text-muted-foreground">可多选；筛选时语义为包含任意所选人员（OR）。</p>
      <div id={id} className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
        {people.length === 0 ? (
          <span className="text-sm text-muted-foreground">暂无人员</span>
        ) : (
          people.map((person) => {
            const selected = selectedIds.includes(person.id);
            return (
              <Button
                key={person.id}
                type="button"
                size="sm"
                variant={selected ? 'default' : 'outline'}
                aria-pressed={selected}
                onClick={() => {
                  onChange(
                    selected
                      ? selectedIds.filter((personId) => personId !== person.id)
                      : [...selectedIds, person.id],
                  );
                }}
              >
                {person.name}
              </Button>
            );
          })
        )}
      </div>
      {allowCreate && (
        <div className="flex gap-2">
          <div className="grid flex-1 gap-1">
            <Label htmlFor={`${id}-new-person`} className="sr-only">
              快捷新建人员姓名
            </Label>
            <Input
              id={`${id}-new-person`}
              placeholder="输入姓名快捷新建"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={name.trim() === ''}
            onClick={() => {
              void getPeopleService()
                .then((service) => service.createPerson({ name }))
                .then((person) => {
                  setName('');
                  onPersonCreated?.(person);
                  onChange([...selectedIds, person.id]);
                });
            }}
          >
            新建并选择
          </Button>
        </div>
      )}
    </fieldset>
  );
}
