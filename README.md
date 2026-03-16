# pg-pool-mcp

A single MCP server for all your Postgres databases.

Instead of configuring a separate MCP server entry for each database, pg-pool-mcp lets you define all your connections in one config file and query any of them by name. No restarts, no config juggling.

## Why?

The official Postgres MCP server binds to a single database via a CLI argument. If you work with multiple databases (dev, staging, prod, or just different projects), you either need multiple MCP server entries or you're editing config and restarting every time you switch.

pg-pool-mcp gives you:

- **One MCP server, many databases** -- configure once, query any database by name
- **Lazy connection pooling** -- connects on first use, not at startup
- **Read-only by default** -- queries are wrapped in read-only transactions unless you opt in to writes
- **Query timeouts** -- prevents runaway queries from hanging your session
- **Environment variable interpolation** -- keep secrets out of your config file

## Setup

```bash
git clone <repo-url>
cd pg-pool-mcp
npm install
```

## Configuration

Create a `databases.json` file (see `databases.example.json` for reference):

```json
{
  "databases": {
    "local": {
      "host": "localhost",
      "port": 5432,
      "database": "mydb",
      "user": "postgres",
      "password": "$PG_PASSWORD",
      "readOnly": false
    },
    "production": {
      "connectionString": "postgresql://$PROD_USER:$PROD_PASSWORD@prod-host:5432/prod_db",
      "readOnly": true
    }
  },
  "defaults": {
    "readOnly": true,
    "queryTimeout": 30000,
    "poolSize": 5
  }
}
```

Each database entry supports either a `connectionString` or individual fields (`host`, `port`, `database`, `user`, `password`).

### Per-database options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `readOnly` | boolean | `true` | Wrap queries in read-only transactions |
| `queryTimeout` | number | `30000` | Statement timeout in milliseconds |
| `poolSize` | number | `5` | Max connections in the pool |
| `ssl` | boolean/object | — | SSL configuration passed to `pg` |

### Environment variable interpolation

String values support `$VAR` and `${VAR}` syntax, resolved from your environment at startup. This keeps passwords out of the config file:

```json
{
  "password": "$PG_PASSWORD",
  "connectionString": "postgresql://${DB_USER}:${DB_PASS}@host/db"
}
```

## Register with Claude Code

Add to `~/.claude.json` (global) or `.mcp.json` (per-project):

```json
{
  "mcpServers": {
    "multi-pg": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "tsx",
        "/path/to/pg-pool-mcp/src/index.ts",
        "--config",
        "/path/to/databases.json"
      ]
    }
  }
}
```

You can also set the config path via environment variable:

```json
{
  "mcpServers": {
    "multi-pg": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "/path/to/pg-pool-mcp/src/index.ts"],
      "env": {
        "MULTI_PG_MCP_CONFIG": "/path/to/databases.json"
      }
    }
  }
}
```

Restart Claude Code after adding the config.

## Tools

### `list_databases`

Lists all configured databases with their connection status and read-only setting. Call this first to see available database names.

### `query`

Run a SQL query against a named database.

- **`database`** -- name from your config (e.g. `"local"`, `"production"`)
- **`sql`** -- the SQL to execute

If the database is configured as `readOnly: true`, queries are wrapped in `BEGIN TRANSACTION READ ONLY` and rolled back automatically. Write attempts will fail.

### `list_tables`

List all tables in a database with estimated row counts.

- **`database`** -- name from your config
- **`schema`** -- schema to list (default: `"public"`)

### `describe_table`

Get the full schema of a table: columns, types, nullability, defaults, primary keys, and foreign keys.

- **`database`** -- name from your config
- **`table`** -- table name
- **`schema`** -- schema name (default: `"public"`)

## Development

```bash
# Type-check
npx tsc --noEmit

# Run directly
npx tsx src/index.ts --config databases.json

# Build
npm run build
```

## License

ISC
