import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { createProductionMcpHandler, type ProductionMcpHttpHandler, type ProductionMcpHttpOptions } from './mcp-modern.js';
import type { RecoveryStore } from './core/recovery-store.js';

export interface NodeMcpHttpOptions extends ProductionMcpHttpOptions {
  /** Interface used by the standalone Node listener. */
  readonly host: string;
  /** Port used by the standalone Node listener; zero asks the OS for one. */
  readonly port: number;
  /** Exact path mounted by the listener. */
  readonly path?: string;
  /** Optional exact source SHA exposed as non-secret response metadata for hosted evidence binding. */
  readonly sourceCommit?: string;
}

export interface NodeMcpHttpServer {
  readonly server: Server;
  readonly handler: ProductionMcpHttpHandler;
  readonly address: () => ReturnType<Server['address']>;
  close(): Promise<void>;
}

interface WebRequestContext {
  readonly request: Request;
  cleanup(): void;
}

function requestUrl(req: IncomingMessage): string {
  const host = req.headers.host ?? 'localhost';
  const target = req.url ?? '/';
  try {
    return new URL(target, `http://${host}`).toString();
  } catch {
    return `http://localhost${target.startsWith('/') ? target : `/${target}`}`;
  }
}

function isLoopbackBindHost(value: string): boolean {
  const host = value.trim().toLowerCase().replace(/^\[|\]$/gu, '');
  return host === 'localhost' || host === '::1'
    || (isIP(host) === 4 && host.startsWith('127.'));
}

function withSourceCommitHeader(response: Response, sourceCommit: string | undefined): Response {
  if (sourceCommit === undefined) return response;
  const headers = new Headers(response.headers);
  headers.set('x-furypipe-source-commit', sourceCommit);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function toWebRequest(req: IncomingMessage, res: ServerResponse): WebRequestContext {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(new DOMException('MCP client disconnected', 'AbortError'));
  };
  const onResponseClose = () => {
    if (!res.writableEnded) abort();
  };
  req.once('aborted', abort);
  req.once('error', abort);
  res.once('close', onResponseClose);

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else headers.set(name, value);
  }
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const body = hasBody
    ? Readable.toWeb(req) as unknown as BodyInit
    : undefined;
  const request = new Request(requestUrl(req), {
    method,
    headers,
    body,
    signal: controller.signal,
    // Node requires this for a streaming request body.
    duplex: hasBody ? 'half' : undefined,
  } as RequestInit & { duplex?: 'half' });

  return {
    request,
    cleanup() {
      req.off('aborted', abort);
      req.off('error', abort);
      res.off('close', onResponseClose);
    },
  };
}

function isClientDisconnect(error: unknown): boolean {
  const value = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof value?.name === 'string' ? value.name : '';
  const code = typeof value?.code === 'string' ? value.code : '';
  const message = typeof value?.message === 'string' ? value.message : '';
  return name === 'AbortError' || code === 'ECONNRESET' || code === 'EPIPE'
    || message === 'client response closed' || message.includes('aborted');
}

function waitForDrain(out: ServerResponse): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      out.off('drain', onDrain);
      out.off('close', onClose);
      out.off('error', onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error('client response closed'));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    out.once('drain', onDrain);
    out.once('close', onClose);
    out.once('error', onError);
  });
}

async function writeWebResponse(response: Response, out: ServerResponse): Promise<void> {
  out.statusCode = response.status;
  response.headers.forEach((value, name) => out.setHeader(name, value));
  if (!response.body) {
    out.end();
    return;
  }
  const reader = response.body.getReader();
  let finished = false;
  const cancelBody = () => {
    if (!finished) void reader.cancel().catch(() => undefined);
  };
  out.once('close', cancelBody);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && !out.write(value)) await waitForDrain(out);
    }
    if (!out.writableEnded) out.end();
  } finally {
    finished = true;
    out.off('close', cancelBody);
    reader.releaseLock();
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve();
    });
    server.closeIdleConnections?.();
  });
}

/**
 * Mount the secured fetch-native MCP boundary on a real Node HTTP listener.
 * The listener is intentionally separate from the inference proxy: callers
 * must opt into it and choose an explicit authenticated or loopback posture.
 */
export async function listenMcpHttpNode(
  store: RecoveryStore,
  options: NodeMcpHttpOptions,
): Promise<NodeMcpHttpServer> {
  const routePath = options.path ?? '/mcp';
  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/u.test(routePath) || routePath.includes('//')) {
    throw new Error('MCP HTTP path must be a single absolute URL path');
  }
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new RangeError('MCP HTTP port must be an integer from 0 to 65535');
  }
  if (options.host.trim() === '') throw new Error('MCP HTTP host must not be empty');
  if (options.sourceCommit !== undefined && !/^[0-9a-f]{40}$/u.test(options.sourceCommit)) {
    throw new Error('MCP HTTP sourceCommit must be a lowercase 40-character commit SHA');
  }
  if (options.allowUnauthenticatedLoopback === true && !isLoopbackBindHost(options.host)) {
    throw new Error('unauthenticated MCP HTTP must bind to a loopback interface');
  }

  const handler = createProductionMcpHandler(store, options);
  const server = createServer((req, res) => {
    let url: URL;
    try {
      url = new URL(requestUrl(req));
    } catch {
      res.statusCode = 400;
      res.end('invalid request URL');
      return;
    }
    if (url.pathname !== routePath) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const context = toWebRequest(req, res);
    Promise.resolve()
      .then(() => handler.fetch(context.request))
      .then((response) => writeWebResponse(withSourceCommitHeader(response, options.sourceCommit), res))
      .catch((error: unknown) => {
        if (isClientDisconnect(error) || res.destroyed) return;
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.setHeader('cache-control', 'no-store');
          res.end(JSON.stringify({ error: 'MCP HTTP request failed' }));
        } else if (!res.writableEnded) {
          res.destroy();
        }
      })
      .finally(() => context.cleanup());
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(options.port, options.host);
    });
  } catch (error) {
    await handler.close().catch(() => undefined);
    throw error;
  }

  let closePromise: Promise<void> | undefined;
  return {
    server,
    handler,
    address: () => server.address(),
    close: () => {
      closePromise ??= Promise.all([closeServer(server), handler.close()]).then(() => undefined);
      return closePromise;
    },
  };
}
