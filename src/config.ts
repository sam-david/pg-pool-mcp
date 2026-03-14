import * as z from 'zod/v4';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DatabaseConfigSchema = z.object({
  connectionString: z.string().optional(),
  host: z.string().optional(),
  port: z.number().int().optional(),
  database: z.string().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  ssl: z.union([z.boolean(), z.record(z.string(), z.unknown())]).optional(),
  readOnly: z.boolean().optional(),
  queryTimeout: z.number().int().min(0).optional(),
  poolSize: z.number().int().min(1).max(100).optional(),
});

const ConfigSchema = z.object({
  databases: z.record(z.string(), DatabaseConfigSchema),
  defaults: z.object({
    readOnly: z.boolean().optional(),
    queryTimeout: z.number().int().min(0).optional(),
    poolSize: z.number().int().min(1).max(100).optional(),
  }).optional(),
});

export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export interface ResolvedDatabaseConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | Record<string, unknown>;
  readOnly: boolean;
  queryTimeout: number;
  poolSize: number;
}

/** Replace $VAR and ${VAR} with environment variable values */
function interpolateEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, braced, bare) => {
    const varName = braced ?? bare;
    const envVal = process.env[varName];
    if (envVal === undefined) {
      throw new Error(`Environment variable "${varName}" is not set (referenced in config)`);
    }
    return envVal;
  });
}

/** Recursively interpolate env vars in all string values of an object */
function interpolateConfig(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return interpolateEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(interpolateConfig);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateConfig(value);
    }
    return result;
  }
  return obj;
}

export function loadConfig(configPath: string): Config {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }

  const raw = fs.readFileSync(resolved, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in config file: ${resolved}`);
  }

  const interpolated = interpolateConfig(parsed);
  const result = ConfigSchema.safeParse(interpolated);
  if (!result.success) {
    throw new Error(`Invalid config: ${z.prettifyError(result.error)}`);
  }

  const config = result.data;
  if (Object.keys(config.databases).length === 0) {
    throw new Error('Config must define at least one database');
  }

  return config;
}

export function resolveDatabase(config: Config, name: string): ResolvedDatabaseConfig {
  const db = config.databases[name];
  if (!db) {
    throw new Error(`Unknown database: "${name}". Use list_databases to see available databases.`);
  }
  const defaults = config.defaults ?? {};
  return {
    connectionString: db.connectionString,
    host: db.host,
    port: db.port,
    database: db.database,
    user: db.user,
    password: db.password,
    ssl: db.ssl,
    readOnly: db.readOnly ?? defaults.readOnly ?? true,
    queryTimeout: db.queryTimeout ?? defaults.queryTimeout ?? 30_000,
    poolSize: db.poolSize ?? defaults.poolSize ?? 5,
  };
}
