import { CalendarDays, Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { SampleBadge } from '@/components/common/SampleBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/common/PageHeader';
import { ReorderHandle } from '@/features/sorting/ReorderHandle';
import { SavedOrderControls } from '@/features/sorting/SavedOrderControls';
import { useSavedListOrder } from '@/features/sorting/useSavedListOrder';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toAppError } from '@/lib/errors';
import { todayHK } from '@/lib/date';
import { getMeetingService } from '@/services/meeting.service';
import { expandRule, getRecurrenceService } from '@/services/recurrence.service';
import { useMeetingStore } from '@/stores/useMeetingStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useRecurrenceStore } from '@/stores/useRecurrenceStore';
import type { Meeting, RecurrenceException, RecurrenceRule } from '@/types';
import type { RecurrenceRuleInput } from '@/services/schemas';
import { MeetingForm } from '../components/MeetingForm';
import {
  buildMeetingOccurrences,
  filterAndSortMeetingOccurrences,
  type MeetingRange,
  type MeetingTimeSort,
} from '../meetingListModel';
import { RecurrenceRuleForm } from '../components/RecurrenceRuleForm';

interface PendingDelete {
  meeting: Meeting;
  /** Real number of action items the cascade would remove, read from the database. */
  actionItemCount: number;
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

function recurrenceSummary(rule: RecurrenceRule): string {
  const weekday = WEEKDAY_LABELS[rule.byweekday] ?? '未知星期';
  const frequency = rule.interval === 1 ? `每${weekday}` : `每${String(rule.interval)}周${weekday}`;
  return `${frequency}${rule.time_of_day === null ? '' : ` ${rule.time_of_day}`}，至 ${rule.end_date ?? '未设置'}`;
}

function nextOccurrence(rule: RecurrenceRule): string {
  return (
    expandRule(rule, todayHK(), rule.end_date ?? todayHK(), null, []).occurrences[0]?.date ??
    '已结束'
  );
}

export function MeetingsPage() {
  const meetings = useMeetingStore((state) => state.meetings);
  const loading = useMeetingStore((state) => state.loading);
  const error = useMeetingStore((state) => state.error);
  const loadMeetings = useMeetingStore((state) => state.loadMeetings);
  const createMeeting = useMeetingStore((state) => state.createMeeting);
  const updateMeeting = useMeetingStore((state) => state.updateMeeting);
  const deleteMeeting = useMeetingStore((state) => state.deleteMeeting);
  const countActionItems = useMeetingStore((state) => state.countActionItems);
  const rules = useRecurrenceStore((state) => state.rules);
  const recurrenceError = useRecurrenceStore((state) => state.error);
  const loadRules = useRecurrenceStore((state) => state.loadRules);
  const createRule = useRecurrenceStore((state) => state.createRule);
  const updateRule = useRecurrenceStore((state) => state.updateRule);
  const deleteRule = useRecurrenceStore((state) => state.deleteRule);

  const projectOptions = useProjectStore((state) => state.options);
  const loadOptions = useProjectStore((state) => state.loadOptions);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RecurrenceRule | null>(null);
  const [deletingRule, setDeletingRule] = useState<RecurrenceRule | null>(null);
  const [createChoiceOpen, setCreateChoiceOpen] = useState(false);
  const [pendingRuleUpdate, setPendingRuleUpdate] = useState<{
    rule: RecurrenceRule;
    input: RecurrenceRuleInput;
  } | null>(null);
  const [exceptionsByRule, setExceptionsByRule] = useState<
    ReadonlyMap<string, readonly RecurrenceException[]>
  >(new Map());
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('all');
  const [meetingKind, setMeetingKind] = useState<'all' | 'standalone' | 'recurring'>('all');
  const [linkFilter, setLinkFilter] = useState<'all' | 'with' | 'without'>('all');
  const [range, setRange] = useState<MeetingRange>('future');
  const [timeSort, setTimeSort] = useState<MeetingTimeSort>('time_asc');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    void loadMeetings();
    void loadOptions();
    void loadRules();
    void getMeetingService()
      .then((service) => service.getListPreferences())
      .then((preferences) => {
        setRange(preferences.range);
        setTimeSort(preferences.timeSort);
      })
      .catch(() => undefined);
  }, [loadMeetings, loadOptions, loadRules]);

  useEffect(() => {
    const series = searchParams.get('series');
    const rule = rules.find((item) => item.id === series);
    if (rule !== undefined) {
      setEditingRule(rule);
    }
  }, [rules, searchParams]);

  useEffect(() => {
    let active = true;
    void getRecurrenceService()
      .then(async (service) => {
        const entries = await Promise.all(
          rules.map(async (rule) => [rule.id, await service.listExceptions(rule.id)] as const),
        );
        if (active) setExceptionsByRule(new Map(entries));
      })
      .catch(() => {
        if (active) setExceptionsByRule(new Map());
      });
    return () => {
      active = false;
    };
  }, [rules]);

  const filteredOccurrences = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN');
    return filterAndSortMeetingOccurrences(
      buildMeetingOccurrences(meetings, rules, exceptionsByRule),
      range,
      timeSort,
    ).filter(
      (occurrence) =>
        (query === '' || occurrence.topic.toLocaleLowerCase('zh-CN').includes(query)) &&
        (projectId === 'all' || occurrence.project_id === projectId) &&
        (meetingKind === 'all' ||
          (meetingKind === 'recurring'
            ? occurrence.source_rule_id !== null
            : occurrence.source_rule_id === null)) &&
        (linkFilter === 'all' ||
          (linkFilter === 'with'
            ? occurrence.meeting_url !== null
            : occurrence.meeting_url === null)),
    );
  }, [
    exceptionsByRule,
    linkFilter,
    meetingKind,
    meetings,
    projectId,
    range,
    rules,
    search,
    timeSort,
  ]);
  const savedOrder = useSavedListOrder('meetings', '', filteredOccurrences);
  const reorderDisabled =
    search.trim() !== '' ||
    projectId !== 'all' ||
    meetingKind !== 'all' ||
    linkFilter !== 'all' ||
    range !== 'all';
  const reorderReason = reorderDisabled ? '清除搜索或筛选后可调整自定义顺序' : null;
  const rulesById = useMemo(() => new Map(rules.map((rule) => [rule.id, rule])), [rules]);

  const projectName = useMemo(() => {
    const byId = new Map(projectOptions.map((project) => [project.id, project.name]));
    return (id: string | null): string => (id === null ? '独立会议' : (byId.get(id) ?? '所属项目'));
  }, [projectOptions]);

  const askDelete = useCallback(
    (meeting: Meeting): void => {
      setActionError(null);
      void countActionItems(meeting.id)
        .then((actionItemCount) => {
          setPendingDelete({ meeting, actionItemCount });
        })
        .catch((caught: unknown) => {
          setActionError(toAppError(caught).message);
        });
    },
    [countActionItems],
  );

  const confirmDelete = (): void => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (target === null) {
      return;
    }
    setBusy(true);
    void deleteMeeting(target.meeting.id)
      .catch((caught: unknown) => {
        setActionError(toAppError(caught).message);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  if (loading && meetings.length === 0) {
    return (
      <div className="p-6">
        <LoadingState label="正在加载会议…" />
      </div>
    );
  }

  if (error !== null && meetings.length === 0) {
    return (
      <div className="p-6">
        <ErrorState
          title="无法加载会议"
          message={error}
          onRetry={() => {
            void loadMeetings();
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title="会议"
        description="记录会议纪要与决议，并把行动项转成任务。"
        action={
          <Button
            onClick={() => {
              setCreateChoiceOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden />
            创建会议
          </Button>
        }
      />

      {actionError !== null && <p className="mb-4 text-sm text-destructive">{actionError}</p>}
      {recurrenceError !== null && (
        <p className="mb-4 text-sm text-destructive">{recurrenceError}</p>
      )}

      <section className="mb-6 space-y-3 rounded-lg border bg-card p-4" aria-label="会议筛选">
        <div className="flex flex-wrap gap-2" aria-label="会议时间范围">
          {(
            [
              ['future', '未来'],
              ['today', '今天'],
              ['past', '过去'],
              ['all', '全部'],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={range === value ? 'default' : 'outline'}
              onClick={() => {
                setRange(value);
                void getMeetingService()
                  .then((service) => service.setListRange(value))
                  .catch(() => setActionError('无法保存会议列表偏好'));
                if (value === 'future' || value === 'today') {
                  setTimeSort('time_asc');
                  void getMeetingService()
                    .then((service) => service.setListTimeSort('time_asc'))
                    .catch(() => setActionError('无法保存会议列表偏好'));
                }
                if (value === 'past') {
                  setTimeSort('time_desc');
                  void getMeetingService()
                    .then((service) => service.setListTimeSort('time_desc'))
                    .catch(() => setActionError('无法保存会议列表偏好'));
                }
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <Input
            aria-label="搜索会议名称"
            placeholder="搜索会议名称"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            aria-label="所属项目"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="all">全部项目</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select
            aria-label="会议类型"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={meetingKind}
            onChange={(event) => setMeetingKind(event.target.value as typeof meetingKind)}
          >
            <option value="all">全部类型</option>
            <option value="standalone">独立会议</option>
            <option value="recurring">周期会议</option>
          </select>
          <select
            aria-label="会议链接"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={linkFilter}
            onChange={(event) => setLinkFilter(event.target.value as typeof linkFilter)}
          >
            <option value="all">全部链接</option>
            <option value="with">有会议链接</option>
            <option value="without">无会议链接</option>
          </select>
          <select
            aria-label="会议时间排序"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={timeSort}
            onChange={(event) => {
              const value = event.target.value as MeetingTimeSort;
              setTimeSort(value);
              void getMeetingService()
                .then((service) => service.setListTimeSort(value))
                .catch(() => setActionError('无法保存会议列表偏好'));
            }}
          >
            <option value="time_asc">实际会议时间正序</option>
            <option value="time_desc">实际会议时间倒序</option>
          </select>
        </div>
        <SavedOrderControls controller={savedOrder} disabledReason={reorderReason} />
      </section>

      <section className="mb-6 rounded-lg border bg-card p-4" aria-label="周期会议规则">
        <div className="mb-3">
          <div>
            <h2 className="text-lg font-medium">周期会议</h2>
            <p className="text-sm text-muted-foreground">日历会根据重复设置直接显示各次会议。</p>
          </div>
        </div>
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无周期会议规则。</p>
        ) : (
          <ul className="divide-y">
            {rules
              .filter((rule) => rule.kind === 'meeting')
              .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN', { sensitivity: 'base' }))
              .map((rule) => (
                <li
                  key={rule.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded bg-recurrence-background px-3 py-3"
                >
                  <div>
                    <p className="font-medium text-recurrence">{`${rule.title} [周期会议]`}</p>
                    <p className="text-sm text-muted-foreground">
                      {recurrenceSummary(rule)} · 下次 {nextOccurrence(rule)} ·{' '}
                      {rule.project_id === null ? '独立会议' : projectName(rule.project_id)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingRule(rule);
                        setRuleFormOpen(true);
                      }}
                    >
                      修改整个系列
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDeletingRule(rule);
                      }}
                    >
                      删除整个系列
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>

      {filteredOccurrences.length === 0 ? (
        <EmptyState
          title="没有符合条件的会议"
          description="调整时间范围或筛选条件，也可以创建新会议。"
          action={
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              新建会议
            </Button>
          }
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {savedOrder.displayedItems.map((occurrence) => {
            const meeting = occurrence.meeting;
            const rule =
              occurrence.source_rule_id === null
                ? undefined
                : rulesById.get(occurrence.source_rule_id);
            const manual = savedOrder.mode !== 'dynamic';
            return (
              <li
                key={occurrence.id}
                draggable={manual && !reorderDisabled}
                onDragStart={() => setDraggedId(occurrence.id)}
                onDragOver={(event) => {
                  if (manual && !reorderDisabled) event.preventDefault();
                }}
                onDrop={() => {
                  if (draggedId !== null && draggedId !== occurrence.id) {
                    savedOrder.moveBefore(draggedId, occurrence.id);
                  }
                  setDraggedId(null);
                }}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {meeting === null ? (
                      <span className="text-sm font-medium">{occurrence.topic}</span>
                    ) : (
                      <Link
                        to={`/meetings/${meeting.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {occurrence.topic}
                      </Link>
                    )}
                    <Badge variant="outline">{projectName(occurrence.project_id)}</Badge>
                    {occurrence.source_rule_id !== null && (
                      <Badge variant="secondary">周期会议</Badge>
                    )}
                    {meeting?.is_sample === 1 && <SampleBadge />}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                      {occurrence.date}
                    </span>
                    {occurrence.start_time !== null && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" aria-hidden />
                        {occurrence.start_time}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {manual && (
                    <ReorderHandle
                      label={occurrence.topic}
                      disabled={reorderDisabled}
                      onMoveUp={() => savedOrder.move(occurrence.id, -1)}
                      onMoveDown={() => savedOrder.move(occurrence.id, 1)}
                    />
                  )}
                  {meeting !== null && (
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/meetings/${meeting.id}`}>打开</Link>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`编辑会议：${occurrence.topic}`}
                    onClick={() => {
                      if (meeting !== null) {
                        setEditing(meeting);
                        setFormOpen(true);
                      } else if (rule !== undefined) {
                        setEditingRule(rule);
                        setRuleFormOpen(true);
                      }
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  {meeting !== null && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`删除会议：${meeting.topic}`}
                      disabled={busy}
                      onClick={() => {
                        askDelete(meeting);
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <MeetingForm
        open={formOpen}
        meeting={editing}
        projects={projectOptions}
        defaultProjectId={null}
        lockProject={false}
        onSubmit={async (input) => {
          if (editing === null) {
            await createMeeting(input);
          } else {
            await updateMeeting(editing.id, input);
          }
        }}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />

      <Dialog
        open={createChoiceOpen}
        onOpenChange={(open) => {
          if (!open) setCreateChoiceOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建会议</DialogTitle>
            <DialogDescription>
              请选择普通会议或周期会议。周期会议会按重复设置直接显示在日历中。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateChoiceOpen(false);
                setEditingRule(null);
                setRuleFormOpen(true);
              }}
            >
              周期会议
            </Button>
            <Button
              onClick={() => {
                setCreateChoiceOpen(false);
                setEditing(null);
                setFormOpen(true);
              }}
            >
              普通会议
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecurrenceRuleForm
        open={ruleFormOpen}
        rule={editingRule}
        projects={projectOptions}
        onSubmit={async (input) => {
          if (editingRule === null) {
            await createRule(input);
          } else {
            setPendingRuleUpdate({ rule: editingRule, input });
          }
        }}
        onClose={() => {
          setRuleFormOpen(false);
          setEditingRule(null);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除会议"
        description={
          pendingDelete === null
            ? ''
            : `确定删除会议「${pendingDelete.meeting.topic}」吗？该会议的 ${String(pendingDelete.actionItemCount)} 个行动项会一并删除，已转换出的任务会保留。此操作不可撤销。`
        }
        confirmLabel="删除"
        destructive
        busy={busy}
        onCancel={() => {
          setPendingDelete(null);
        }}
        onConfirm={confirmDelete}
      />
      <ConfirmDialog
        open={pendingRuleUpdate !== null}
        title="修改整个系列"
        description={
          pendingRuleUpdate === null
            ? ''
            : `确定修改整个周期会议「${pendingRuleUpdate.rule.title}」吗？新规则会立即重新展开；为避免旧日期被错误套用，历史单次调整将被清除。`
        }
        confirmLabel="修改整个系列"
        busy={busy}
        onCancel={() => {
          setPendingRuleUpdate(null);
        }}
        onConfirm={() => {
          const target = pendingRuleUpdate;
          setPendingRuleUpdate(null);
          if (target !== null) {
            setBusy(true);
            void updateRule(target.rule.id, target.input)
              .catch((caught: unknown) => {
                setActionError(toAppError(caught).message);
              })
              .finally(() => {
                setBusy(false);
              });
          }
        }}
      />
      <ConfirmDialog
        open={deletingRule !== null}
        title="删除周期会议规则"
        description={
          deletingRule === null
            ? ''
            : `确定删除整个周期会议「${deletingRule.title}」吗？这会删除全部未来重复会议设置；历史单次调整会一并清除，已保存的会议记录会保留。`
        }
        confirmLabel="删除整个系列"
        destructive
        onCancel={() => {
          setDeletingRule(null);
        }}
        onConfirm={() => {
          const rule = deletingRule;
          setDeletingRule(null);
          if (rule !== null) {
            void deleteRule(rule.id).catch((caught: unknown) => {
              setActionError(toAppError(caught).message);
            });
          }
        }}
      />
    </div>
  );
}
