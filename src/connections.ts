import pg from 'pg';
import type { Config, ResolvedDatabaseConfig } from './config.js';
import { resolveDatabase } from './config.js';

export interface DatabaseStatus {
  name: string;
  connected: boolean;
  readOnly: boolean;
}

export class ConnectionManager {
  private pools = new Map<string, pg.Pool>();
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  private getResolvedConfig(name: string): ResolvedDatabaseConfig {
    return resolveDatabase(this.config, name);
  }

  private getPool(name: string): pg.Pool {
    let pool = this.pools.get(name);
    if (pool) return pool;

    const resolved = this.getResolvedConfig(name);

    const poolConfig: pg.PoolConfig = {
      max: resolved.poolSize,
    };

    if (resolved.connectionString) {
      poolConfig.connectionString = resolved.connectionString;
    } else {
      poolConfig.host = resolved.host;
      poolConfig.port = resolved.port;
      poolConfig.database = resolved.database;
      poolConfig.user = resolved.user;
      poolConfig.password = resolved.password;
    }

    if (resolved.ssl !== undefined) {
      poolConfig.ssl = resolved.ssl;
    }

    pool = new pg.Pool(poolConfig);
    this.pools.set(name, pool);
    return pool;
  }

  /** Execute a SQL query, respecting the database's readOnly and queryTimeout settings */
  async executeQuery(name: string, sql: string): Promise<pg.QueryResult> {
    const resolved = this.getResolvedConfig(name);
    const pool = this.getPool(name);
    const client = await pool.connect();

    try {
      await client.query(`SET statement_timeout = ${resolved.queryTimeout}`);

      if (resolved.readOnly) {
        await client.query('BEGIN TRANSACTION READ ONLY');
      }

      const result = await client.query(sql);
      return result;
    } finally {
      if (resolved.readOnly) {
        await client.query('ROLLBACK').catch((err: unknown) =>
          console.warn('Could not roll back transaction:', err)
        );
      }
      client.release();
    }
  }

  /** Execute a read-only parameterized query (used by introspection tools) */
  async executeReadOnlyQuery(name: string, sql: string, params: unknown[]): Promise<pg.QueryResult> {
    const resolved = this.getResolvedConfig(name);
    const pool = this.getPool(name);
    const client = await pool.connect();

    try {
      await client.query(`SET statement_timeout = ${resolved.queryTimeout}`);
      await client.query('BEGIN TRANSACTION READ ONLY');
      const result = await client.query(sql, params);
      return result;
    } finally {
      await client.query('ROLLBACK').catch((err: unknown) =>
        console.warn('Could not roll back transaction:', err)
      );
      client.release();
    }
  }

  /** Get the status of all configured databases */
  getStatus(): DatabaseStatus[] {
    return Object.keys(this.config.databases).map((name) => {
      const resolved = this.getResolvedConfig(name);
      return {
        name,
        connected: this.pools.has(name),
        readOnly: resolved.readOnly,
      };
    });
  }

  /** Shut down all connection pools */
  async shutdown(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [name, pool] of this.pools) {
      promises.push(
        pool.end().catch((err: unknown) =>
          console.warn(`Error closing pool "${name}":`, err)
        )
      );
    }
    await Promise.all(promises);
    this.pools.clear();
  }
}
