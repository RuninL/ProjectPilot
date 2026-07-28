import { z } from 'zod';

/**
 * Driver-shape normalization for raw `select` rows, applied before Zod validation.
 *
 * The row schemas describe the canonical SQLite shape (TEXT columns as strings,
 * INTEGER/REAL columns as numbers). Drivers do not agree on that mapping:
 * better-sqlite3 (tests) hands back the storage value verbatim, while
 * tauri-plugin-sql goes through sqlx and maps each column by its runtime storage
 * class — so a value can reach JS as a number, a boolean or an array of bytes
 * where the schema declares TEXT. A single mismatched column made the whole page
 * fail with a ZodError (`meetings.attendees`: expected string, received array).
 *
 * The coercion is driven by the schema, never by guessing per value: a candidate
 * replacement is used only when that field's own schema accepts it. Numeric
 * columns (`progress`, `estimated_hours`, `lag_days`, `is_sample`) therefore keep
 * their numbers, and NULL is always left as NULL so nullable/NOT NULL semantics
 * stay exactly as the schema states them.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isObjectSchema(schema: z.ZodTypeAny): schema is z.ZodObject<z.ZodRawShape> {
  return schema instanceof z.ZodObject;
}

/** Canonical DB representations to try, in order, for a value the field rejected. */
function candidateValues(value: unknown): unknown[] {
  if (typeof value === 'number') {
    return [String(value)];
  }
  if (typeof value === 'boolean') {
    return [value ? 1 : 0, String(value)];
  }
  if (typeof value === 'object') {
    // Arrays and objects come from a JSON-typed decode of a TEXT column; their
    // canonical stored form is the JSON text itself.
    return [JSON.stringify(value)];
  }
  return [];
}

/**
 * Return `row` with any driver-mangled column coerced back to the shape
 * `schema` declares. The original object is returned untouched when nothing
 * needs coercion, so the better-sqlite3 path is byte-for-byte unchanged.
 */
export function normalizeRow(schema: z.ZodTypeAny, row: unknown): unknown {
  if (!isObjectSchema(schema) || !isRecord(row)) {
    return row;
  }
  let normalized: Record<string, unknown> | null = null;
  for (const [column, columnSchema] of Object.entries(schema.shape)) {
    const value = row[column];
    if (value === null || value === undefined || columnSchema.safeParse(value).success) {
      continue;
    }
    for (const candidate of candidateValues(value)) {
      if (columnSchema.safeParse(candidate).success) {
        normalized ??= { ...row };
        normalized[column] = candidate;
        break;
      }
    }
  }
  return normalized ?? row;
}
