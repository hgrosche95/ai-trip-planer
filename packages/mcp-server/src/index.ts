import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { registerTools } from './tools.js';

const server = new McpServer({ name: 'trip-planner', version: '0.1.0' });
registerTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Trip-Planner MCP-Server läuft (stdio)');
}

main().catch((error) => {
  console.error('Fataler Fehler beim Start des MCP-Servers:', error);
  process.exit(1);
});
