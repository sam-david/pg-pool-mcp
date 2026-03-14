import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { ConnectionManager } from './connections.js';

export function registerTools(server: McpServer, manager: ConnectionManager): void {
  // Tool 1: list_databases
  server.registerTool(
    'list_databases',
    {
      title: 'List databases',
      description:
        'List all configured PostgreSQL databases and their connection status. Call this first to see available database names.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async () => {
      const statuses = manager.getStatus();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(statuses, null, 2) }],
      };
    },
  );

  // Tool 2: query
  server.registerTool(
    'query',
    {
      title: 'Run SQL query',
      description:
        'Execute a SQL query against a specified database. Queries are read-only by default unless the database is configured to allow writes.',
      inputSchema: {
        database: z.string().describe('Name of the database (from list_databases)'),
        sql: z.string().describe('SQL query to execute'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ database, sql }) => {
      try {
        const result = await manager.executeQuery(database, sql);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.rows, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Query error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Tool 3: list_tables
  server.registerTool(
    'list_tables',
    {
      title: 'List tables',
      description:
        'List all tables in a database with schema name, table name, and estimated row count.',
      inputSchema: {
        database: z.string().describe('Name of the database (from list_databases)'),
        schema: z.string().default('public').describe('Schema to list tables from (default: public)'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ database, schema }) => {
      try {
        const sql = `
          SELECT
            schemaname AS schema,
            tablename AS table,
            COALESCE(n_live_tup, 0) AS estimated_row_count
          FROM pg_stat_user_tables
          WHERE schemaname = $1
          ORDER BY tablename
        `;
        const result = await manager.executeReadOnlyQuery(database, sql, [schema]);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.rows, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Tool 4: describe_table
  server.registerTool(
    'describe_table',
    {
      title: 'Describe table',
      description:
        'Get the schema of a table including columns, types, nullability, defaults, primary keys, and foreign keys.',
      inputSchema: {
        database: z.string().describe('Name of the database (from list_databases)'),
        table: z.string().describe('Table name to describe'),
        schema: z.string().default('public').describe('Schema name (default: public)'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ database, table, schema }) => {
      try {
        const columnsSql = `
          SELECT
            column_name,
            data_type,
            is_nullable,
            column_default,
            character_maximum_length
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position
        `;

        const pkSql = `
          SELECT kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = $1
            AND tc.table_name = $2
        `;

        const fkSql = `
          SELECT
            kcu.column_name,
            ccu.table_name AS foreign_table,
            ccu.column_name AS foreign_column
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = $1
            AND tc.table_name = $2
        `;

        const [columns, pks, fks] = await Promise.all([
          manager.executeReadOnlyQuery(database, columnsSql, [schema, table]),
          manager.executeReadOnlyQuery(database, pkSql, [schema, table]),
          manager.executeReadOnlyQuery(database, fkSql, [schema, table]),
        ]);

        const output = {
          table: `${schema}.${table}`,
          columns: columns.rows,
          primaryKeys: pks.rows.map((r: Record<string, unknown>) => r['column_name']),
          foreignKeys: fks.rows,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
