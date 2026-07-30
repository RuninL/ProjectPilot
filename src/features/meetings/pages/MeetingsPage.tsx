import { CalendarDays, Clock, Pencil, Plus, Repeat2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { SampleBadge } from '@/components/common/SampleBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toAppError } from '@/lib/errors';
import { todayHK } from '@/lib/date';
import { expandRule } from '@/services/recurrence.service';
import { useMeetingStore } from '@/stores/useMeetingStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useRecurrenceStore } from '@/stores/useRecurrenceStore';
import type { Meeting, RecurrenceRule } from '@/types';
import { MeetingForm } from '../components/MeetingForm';
import { RecurrenceRuleForm } from '../components/RecurrenceRuleForm';

interface PendingDelete {
  meeting: Meeting;
  /** Real number of action items the cascade would remove, read from the database. */
  actionItemCount: number;
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

function recurrenceSummary(rule: RecurrenceRule): string {
  const weekday = WEEKDAY_LABELS[rule.byweekday] ?? '未知星期';
  return `每 ${String(rule.interval)} 周 ${weekday}，截止 ${rule.end_date ?? '未设置'}`;
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
  const materializedCounts = useRecurrenceStore((state) => state.materializedCounts);

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

  useEffect(() => {
    void loadMeetings();
    void loadOptions();
    void loadRules();
  }, [loadMeetings, loadOptions, loadRules]);

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
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">会议</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            记录会议纪要与决议，并把行动项转成任务。
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden />
          新建会议
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setEditingRule(null);
            setRuleFormOpen(true);
          }}
        >
          <Repeat2 className="h-4 w-4" aria-hidden />
          创建周期会议
        </Button>
      </header>

      {actionError !== null && <p className="mb-4 text-sm text-destructive">{actionError}</p>}
      {recurrenceError !== null && (
        <p className="mb-4 text-sm text-destructive">{recurrenceError}</p>
      )}

      <section className="mb-6 rounded-lg border bg-card p-4" aria-label="周期会议规则">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium">周期会议规则</h2>
            <p className="text-sm text-muted-foreground">
              预期项会显示在日历中，可按次物化为真实会议。
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditingRule(null);
              setRuleFormOpen(true);
            }}
          >
            创建周期会议
          </Button>
        </div>
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无周期会议规则。</p>
        ) : (
          <ul className="divide-y">
            {rules
              .filter((rule) => rule.kind === 'meeting')
              .map((rule) => (
                <li
                  key={rule.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="font-medium">{rule.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {recurrenceSummary(rule)} · 下次 {nextOccurrence(rule)} ·{' '}
                      {rule.project_id === null ? '独立会议' : projectName(rule.project_id)}
                      {' · '}
                      {materializedCounts[rule.id] === 0
                        ? '暂无已物化实例'
                        : `已物化 ${String(materializedCounts[rule.id])} 次`}
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
                      编辑规则
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDeletingRule(rule);
                      }}
                    >
                      删除规则
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>

      {meetings.length === 0 ? (
        <EmptyState
          title="还没有会议记录"
          description="新建会议后可以记录议程、纪要、决议与行动项。"
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
          {meetings.map((meeting) => (
            <li key={meeting.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/meetings/${meeting.id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {meeting.topic}
                  </Link>
                  <Badge variant="outline">{projectName(meeting.project_id)}</Badge>
                  {meeting.is_sample === 1 && <SampleBadge />}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                    {meeting.date}
                  </span>
                  {meeting.start_time !== null && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" aria-hidden />
                      {meeting.start_time}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/meetings/${meeting.id}`}>打开</Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`编辑会议：${meeting.topic}`}
                  onClick={() => {
                    setEditing(meeting);
                    setFormOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </Button>
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
              </div>
            </li>
          ))}
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

      <RecurrenceRuleForm
        open={ruleFormOpen}
        rule={editingRule}
        projects={projectOptions}
        onSubmit={async (input) => {
          if (editingRule === null) await createRule(input);
          else await updateRule(editingRule.id, input);
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
        open={deletingRule !== null}
        title="删除周期会议规则"
        description={
          deletingRule === null
            ? ''
            : `确定删除规则「${deletingRule.title}」吗？已物化的真实会议会保留，尚未物化的预期项和例外记录会删除。`
        }
        confirmLabel="删除规则"
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
