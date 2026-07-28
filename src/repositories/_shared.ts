import type { z } from 'zod';
import type { SqlExecutor } from '@/lib/db';

/**
 * Shared repository helpers. SQL text is confined to the repositories/ directory;
 * these helpers only assemble parameterized statements from fixed, in-code column
 * allowlists (never user-supplied identifiers), so there is no injection surface.
 */

/** Narrow an untyped `select` result array to a typed row array. */
export function parseRows<S extends z.ZodTypeAny>(schema: S, rows: unknown): z.infer<S>[] {
  const array = rows as unknown[];
  return array.map((row) => schema.parse(row) as z.infer<S>);
}

/** Narrow a single row, or `null` when the result set is empty. */
export function parseOptional<S extends z.ZodTypeAny>(schema: S, rows: unknown): z.infer<S> | null {
  const array = rows as unknown[];
  const first = array[0];
  return first === undefined ? null : (schema.parse(first) as z.infer<S>);
}

/**
 * Build a parameterized `UPDATE` for the columns present in `patch` that are in
 * `allowed`. `updated_at` is always set. Returns `null` when there is nothing to
 * update (no allowed columns supplied).
 */
export function buildUpdate(
  table: string,
  allowed: readonly string[],
  patch: Record<string, unknown>,
  id: string,
  now: string,
): { sql: string; params: unknown[] } | null {
  const allowSet = new Set(allowed);
  const assignments: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (allowSet.has(key)) {
      assignments.push(`${key} = ?`);
      params.push(value);
    }
  }
  if (assignments.length === 0) {
    return null;
  }
  assignments.push('updated_at = ?');
  params.push(now);
  params.push(id);
  return {
    sql: `UPDATE ${table} SET ${assignments.join(', ')} WHERE id = ?`,
    params,
  };
}

/** A parameterized SQL fragment: text from in-code constants, values always bound. */
export interface SqlFragment {
  sql: string;
  params: unknown[];
}

/** AND-join the non-empty fragments into a `WHERE` clause (empty string when none). */
export function composeWhere(conditions: readonly SqlFragment[]): SqlFragment {
  const active = conditions.filter((condition) => condition.sql !== '');
  if (active.length === 0) {
    return { sql: '', params: [] };
  }
  return {
    sql: ` WHERE ${active.map((condition) => condition.sql).join(' AND ')}`,
    params: active.flatMap((condition) => condition.params),
  };
}

/**
 * `column IN (?, ?, …)` with one placeholder per value. `column` must be an
 * in-code constant; an empty list yields an empty fragment (no filtering).
 */
export function inClause(column: string, values: readonly string[]): SqlFragment {
  if (values.length === 0) {
    return { sql: '', params: [] };
  }
  return {
    sql: `${column} IN (${values.map(() => '?').join(', ')})`,
    params: [...values],
  };
}

/**
 * Escape the LIKE wildcards in a user search term so `%` and `_` match
 * literally. Pair with `ESCAPE '\'` in the statement.
 */
export function likeParam(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}

/** Execute a whitelisted UPDATE, returning affected row count. */
export async function runUpdate(
  db: SqlExecutor,
  built: { sql: string; params: unknown[] } | null,
): Promise<number> {
  if (built === null) {
    return 0;
  }
  const result = await db.execute(built.sql, built.params);
  return result.rowsAffected;
}
