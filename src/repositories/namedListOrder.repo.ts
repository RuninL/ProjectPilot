import { namedListOrderRowSchema } from '@/db/schemas';
import type { BatchStatement } from '@/lib/commands';
import type { SqlExecutor } from '@/lib/db';
import type { NamedListOrder, NamedListOrderContext } from '@/types';
import { parseOptional, parseRows } from './_shared';

export function createNamedListOrderRepository(db: SqlExecutor) {
  return {
    async findByContext(
      context: NamedListOrderContext,
      contextId = '',
    ): Promise<NamedListOrder[]> {
      return parseRows(
        namedListOrderRowSchema,
        await db.select(
          `SELECT * FROM named_list_orders
            WHERE context = ? AND context_id = ?
            ORDER BY is_default DESC, name COLLATE NOCASE ASC`,
          [context, contextId],
        ),
      );
    },

    async findById(id: string): Promise<NamedListOrder | null> {
      return parseOptional(
        namedListOrderRowSchema,
        await db.select('SELECT * FROM named_list_orders WHERE id = ?', [id]),
      );
    },

    async insert(order: NamedListOrder): Promise<void> {
      const statement = this.buildInsert(order);
      await db.execute(statement.sql, statement.params);
    },

    buildInsert(order: NamedListOrder): BatchStatement {
      return {
        sql: `INSERT INTO named_list_orders
          (id, context, context_id, name, ordered_ids_json, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          order.id,
          order.context,
          order.context_id,
          order.name,
          order.ordered_ids_json,
          order.is_default,
          order.created_at,
          order.updated_at,
        ],
      };
    },

    buildClearDefault(
      context: NamedListOrderContext,
      contextId: string,
      now: string,
    ): BatchStatement {
      return {
        sql: `UPDATE named_list_orders
                 SET is_default = 0, updated_at = ?
               WHERE context = ? AND context_id = ? AND is_default = 1`,
        params: [now, context, contextId],
      };
    },

    buildUpdate(
      id: string,
      fields: Pick<NamedListOrder, 'name' | 'ordered_ids_json' | 'is_default'>,
      now: string,
    ): BatchStatement {
      return {
        sql: `UPDATE named_list_orders
                 SET name = ?, ordered_ids_json = ?, is_default = ?, updated_at = ?
               WHERE id = ?`,
        params: [fields.name, fields.ordered_ids_json, fields.is_default, now, id],
      };
    },

    async deleteById(id: string): Promise<number> {
      return (await db.execute('DELETE FROM named_list_orders WHERE id = ?', [id])).rowsAffected;
    },
  };
}

export type NamedListOrderRepository = ReturnType<typeof createNamedListOrderRepository>;
