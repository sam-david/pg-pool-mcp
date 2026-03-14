import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { ConnectionManager } from './connections.js';
import { registerTools } from './tools.js';

function getConfigPath(): string {
  const args = process.argv.slice(2);
  const configIdx = args.indexOf('--config');
  const configArg = configIdx !== -1 ? args[configIdx + 1] : undefined;
  if (configArg) {
    return configArg;
  }

  const envConfig = process.env['MULTI_PG_MCP_CONFIG'];
  if (envConfig) {
    return envConfig;
  }

  return './databases.json';
}

async function main() {
  const configPath = getConfigPath();
  const config = loadConfig(configPath);

  const dbCount = Object.keys(config.databases).length;
  console.error(`multi-pg-mcp: loaded ${dbCount} database(s) from ${configPath}`);

  const manager = new ConnectionManager(config);

  const server = new McpServer({
    name: 'multi-pg-mcp',
    version: '1.0.0',
  });

  registerTools(server, manager);

  const cleanup = async () => {
    await manager.shutdown();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
