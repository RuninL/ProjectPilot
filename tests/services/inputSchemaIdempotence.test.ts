import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  actionItemInputSchema,
  meetingInputSchema,
  milestoneInputSchema,
  personInputSchema,
  projectParticipantInputSchema,
  projectLinkInputSchema,
  projectInputSchema,
  riskInputSchema,
  taskInputSchema,
  taskParticipantInputSchema,
} from '@/services/schemas';

/**
 * Every form parses with the input schema before handing the result to the store,
 * and every service re-parses what it is handed, so that a caller bypassing the
 * form still cannot write an invalid row. That double validation is only sound
 * while parsing is idempotent — a schema must accept its own output.
 *
 * `meetings.attendees` broke the rule: free text is normalized to string[], and
 * re-parsing that array threw
 * `[{"code":"invalid_type","expected":"string","received":"array","path":["attendees"]}]`,
 * so every save failed, the table stayed empty, and the list page fell back to
 * 「无法加载会议」 with the ZodError as its message.
 */

interface SchemaCase {
  name: string;
  schema: z.ZodTypeAny;
  raw: unknown;
}

const cases: SchemaCase[] = [
  {
    name: 'projectInputSchema',
    schema: projectInputSchema,
    raw: { name: '内网门户重构', color: '#2563EB', start_date: '', target_end_date: '2026-09-30' },
  },
  {
    name: 'taskInputSchema',
    schema: taskInputSchema,
    raw: {
      project_id: 'p1',
      parent_task_id: '',
      title: '接口联调',
      progress: '40',
      start_date: '',
      due_date: '2026-08-10',
      estimated_hours: '',
      actual_hours: '3',
    },
  },
  {
    name: 'meetingInputSchema',
    schema: meetingInputSchema,
    raw: {
      project_id: '',
      topic: '双周评审',
      date: '2026-07-20',
      start_time: '14:00',
      attendees: '张三\n李四，王五',
    },
  },
  {
    name: 'actionItemInputSchema',
    schema: actionItemInputSchema,
    raw: { content: '补充压测报告', owner: '张三', due_date: '' },
  },
  {
    name: 'milestoneInputSchema',
    schema: milestoneInputSchema,
    raw: { project_id: 'p1', linked_task_id: '', name: '一期上线', date: '2026-08-01' },
  },
  {
    name: 'riskInputSchema',
    schema: riskInputSchema,
    raw: {
      project_id: 'p1',
      title: '第三方接口延迟',
      likelihood: 'high',
      impact: 'medium',
      due_date: '',
    },
  },
  {
    name: 'personInputSchema',
    schema: personInputSchema,
    raw: { name: ' 张三 ' },
  },
  {
    name: 'projectParticipantInputSchema',
    schema: projectParticipantInputSchema,
    raw: { project_id: 'p1', role: ' 开发 ' },
  },
  {
    name: 'taskParticipantInputSchema',
    schema: taskParticipantInputSchema,
    raw: { task_id: 't1' },
  },
  {
    name: 'projectLinkInputSchema',
    schema: projectLinkInputSchema,
    raw: {
      label: '需求文档',
      link_type: 'url',
      target: 'https://example.com/spec',
      description: ' 产品资料 ',
    },
  },
];

describe('input schemas accept their own output', () => {
  for (const { name, schema, raw } of cases) {
    it(`${name} parses idempotently`, () => {
      const once: unknown = schema.parse(raw);

      expect(schema.parse(once)).toEqual(once);
    });
  }

  it('re-parses the attendees list the form already normalized', () => {
    const fromForm = {
      project_id: null,
      topic: '双周评审',
      date: '2026-07-20',
      start_time: null,
      attendees: ['张三', '李四', '王五'],
      agenda: '',
      notes: '',
      decisions: '',
      risks: '',
    };

    expect(meetingInputSchema.parse(fromForm).attendees).toEqual(['张三', '李四', '王五']);
  });

  it('still normalizes and still rejects over-long free text', () => {
    const base = { project_id: '', topic: '会', date: '2026-07-20', start_time: '' };

    expect(meetingInputSchema.parse({ ...base, attendees: ' 张三 , ,李四 ' })).toHaveProperty(
      'attendees',
      ['张三', '李四'],
    );

    const tooLong = meetingInputSchema.safeParse({ ...base, attendees: 'x'.repeat(2001) });

    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.message).toBe('参与者不能超过 2000 个字符');
  });
});
