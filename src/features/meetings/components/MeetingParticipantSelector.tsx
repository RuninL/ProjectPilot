import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getPeopleService } from '@/services/people.service';
import type { Person } from '@/types';

interface Props {
  selectedNames: readonly string[];
  onChange: (names: string[]) => void;
}

export function MeetingParticipantSelector({ selectedNames, onChange }: Props) {
  const [people, setPeople] = useState<readonly Person[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    void getPeopleService()
      .then((service) => service.listPeople())
      .then(setPeople)
      .catch(() => {
        setPeople([]);
      });
  }, []);

  const matches = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN');
    return people.filter(
      (person) =>
        !selectedNames.includes(person.name) &&
        (query === '' || person.name.toLocaleLowerCase('zh-CN').includes(query)),
    );
  }, [people, search, selectedNames]);

  return (
    <div className="grid gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>已选 {String(selectedNames.length)} 人</span>
        {people.length === 0 && (
          <Button type="button" size="sm" variant="link" asChild>
            <a href="/people">前往人物页面</a>
          </Button>
        )}
      </div>
      {selectedNames.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedNames.map((name) => (
            <Button
              key={name}
              type="button"
              size="sm"
              variant="secondary"
              aria-label={`移除参与者 ${name}`}
              onClick={() => {
                onChange(selectedNames.filter((selected) => selected !== name));
              }}
            >
              {name}
              <X className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ))}
        </div>
      )}
      <Input
        aria-label="搜索参与者"
        placeholder="输入姓名搜索"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      {people.length > 0 && (
        <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
          {matches.length === 0 ? (
            <span className="text-sm text-muted-foreground">没有匹配的人物</span>
          ) : (
            matches.map((person) => (
              <Button
                key={person.id}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  onChange([...selectedNames, person.name]);
                  setSearch('');
                }}
              >
                {person.name}
              </Button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
