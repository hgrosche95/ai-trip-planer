import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import {
  McpServer,
  createMcpHandler,
  requireBearerAuth,
} from '@modelcontextprotocol/server';
import { staticTokenVerifier } from './bearer-auth.js';
import { registerTools } from './tools.js';

const PORT = Number(process.env.MCP_HTTP_PORT ?? 8787);

// Statt stdio (ein Prozess pro Client, siehe index.ts) ein langlebiger
// Prozess, den mehrere entfernte Clients über HTTP erreichen können - dafür
// braucht es überhaupt erst eine Absicherung (stdio läuft nur lokal, unter
// derselben Nutzer-Session, HTTP ist netzwerkweit erreichbar).
//
// createMcpHandler statt eines einzelnen, wiederverwendeten Transports:
// ein einzelner WebStandardStreamableHTTPServerTransport im Stateful-Modus
// kann nur eine Client-Sitzung gleichzeitig bedienen - ein zweiter,
// unabhängiger Client (z.B. ein zweiter MCP-Client-Prozess) scheitert dann
// mit "Server already initialized". createMcpHandler(factory, { legacy:
// 'stateless' }) erzeugt pro eingehendem Request eine frische
// Server-Instanz über einen frischen Transport (sessionIdGenerator:
// undefined) - der dokumentierte Standard-Idiom für genau diesen Fall.
const handler = createMcpHandler(
  () => {
    const server = new McpServer({ name: 'trip-planner', version: '0.1.0' });
    registerTools(server);
    return server;
  },
  { legacy: 'stateless' },
);

const authGate = requireBearerAuth({ verifier: staticTokenVerifier });

function toWebRequest(req: IncomingMessage): Request {
  const url = `http://${req.headers.host ?? 'localhost'}${req.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(', '));
    else if (value !== undefined) headers.set(key, value);
  }
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(url, {
    method,
    headers,
    // Node liefert den Request-Body als klassischen Readable-Stream, die
    // Web-Standard-Transport-API erwartet einen Web ReadableStream -
    // Readable.toWeb() ist Nodes eingebaute Brücke zwischen beiden Welten
    // (seit Node 17), keine zusätzliche Abhängigkeit nötig.
    body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
    duplex: hasBody ? 'half' : undefined,
  } as RequestInit);
}

async function sendWebResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) {
    res.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const nodeStream = Readable.fromWeb(response.body as never);
    nodeStream.pipe(res);
    nodeStream.on('error', reject);
    res.on('finish', resolve);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url !== '/mcp') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const request = toWebRequest(req);

  const authResult = await authGate(request);
  if (authResult instanceof Response) {
    await sendWebResponse(authResult, res);
    return;
  }

  const response = await handler.fetch(request, { authInfo: authResult });
  await sendWebResponse(response, res);
}

function main(): void {
  if (!process.env.MCP_HTTP_TOKEN) {
    console.error(
      'MCP_HTTP_TOKEN ist nicht gesetzt - jede Anfrage würde mit 401 abgelehnt (siehe README).',
    );
  }

  const httpServer = createServer((req, res) => {
    handleRequest(req, res).catch((error: unknown) => {
      console.error('Unerwarteter Fehler bei der Anfrageverarbeitung:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'internal_error' }));
    });
  });

  httpServer.listen(PORT, () => {
    console.error(`Trip-Planner MCP-Server läuft (HTTP) auf Port ${PORT}, Pfad /mcp`);
  });
}

main();
