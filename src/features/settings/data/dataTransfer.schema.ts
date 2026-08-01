import { z } from 'zod';
import {
  actionItemRowSchema,
  appSettingRowSchema,
  meetingRowSchema,
  milestoneRowSchema,
  namedListOrderRowSchema,
  personRowSchema,
  recurrenceExceptionRowSchema,
  recurrenceRuleRowSchema,
  projectLinkRowSchema,
  projectParticipantRowSchema,
  projectRowSchema,
  riskRowSchema,
  taskDependencyRowSchema,
  taskChecklistItemRowSchema,
  taskProgressUpdateRowSchema,
  taskParticipantRowSchema,
  taskRowSchema,
} from '@/db/schemas';

export const DATA_SCHEMA_VERSION = 1 as const;

export const entityCountSchema = z
  .object({
    projects: z.number().int().nonnegative(),
    meetings: z.number().int().nonnegative(),
    tasks: z.number().int().nonnegative(),
    taskDependencies: z.number().int().nonnegative(),
    recurrenceRules: z.number().int().nonnegative().default(0),
    recurrenceExceptions: z.number().int().nonnegative().default(0),
    milestones: z.number().int().nonnegative(),
    actionItems: z.number().int().nonnegative(),
    projectLinks: z.number().int().nonnegative(),
    risks: z.number().int().nonnegative(),
    appSettings: z.number().int().nonnegative(),
    people: z.number().int().nonnegative().default(0),
    projectParticipants: z.number().int().nonnegative().default(0),
    taskParticipants: z.number().int().nonnegative().default(0),
    namedListOrders: z.number().int().nonnegative().default(0),
    taskProgressUpdates: z.number().int().nonnegative().default(0),
    taskChecklistItems: z.number().int().nonnegative().default(0),
  })
  .strict();

export const exportDataSchema = z
  .object({
    projects: z.array(projectRowSchema.strict()),
    meetings: z.array(meetingRowSchema.strict()),
    tasks: z.array(taskRowSchema.strict()),
    taskDependencies: z.array(taskDependencyRowSchema.strict()),
    recurrenceRules: z.array(recurrenceRuleRowSchema.strict()).default([]),
    recurrenceExceptions: z.array(recurrenceExceptionRowSchema.strict()).default([]),
    milestones: z.array(milestoneRowSchema.strict()),
    actionItems: z.array(actionItemRowSchema.strict()),
    projectLinks: z.array(projectLinkRowSchema.strict()),
    risks: z.array(riskRowSchema.strict()),
    appSettings: z.array(appSettingRowSchema.strict()),
    people: z.array(personRowSchema.strict()).default([]),
    projectParticipants: z.array(projectParticipantRowSchema.strict()).default([]),
    taskParticipants: z.array(taskParticipantRowSchema.strict()).default([]),
    namedListOrders: z.array(namedListOrderRowSchema.strict()).default([]),
    taskProgressUpdates: z.array(taskProgressUpdateRowSchema.strict()).default([]),
    taskChecklistItems: z.array(taskChecklistItemRowSchema.strict()).default([]),
  })
  .strict();

export const projectPilotExportSchema = z
  .object({
    schemaVersion: z.literal(DATA_SCHEMA_VERSION, {
      errorMap: () => ({ message: `不支持的数据版本，仅支持版本 ${String(DATA_SCHEMA_VERSION)}` }),
    }),
    exportedAt: z.string().datetime({ offset: true }),
    appVersion: z.string().min(1),
    statistics: entityCountSchema,
    data: exportDataSchema,
  })
  .strict();

export type EntityCounts = z.infer<typeof entityCountSchema>;
export type ProjectPilotExport = z.infer<typeof projectPilotExportSchema>;
export type ExportData = z.infer<typeof exportDataSchema>;
