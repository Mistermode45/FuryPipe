import { createServer } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserType,
  type Page,
} from 'playwright';

import {
  createFuryGatewayCommandRegistry,
} from '../src/gateway-command-authorization-node.js';
import {
  createRecoveryStore,
} from '../src/core/recovery-store.js';
import {
  createContinuousMemoryEngine,
  type ContinuousMemoryCandidate,
} from '../src/continuous-memory.js';
import {
  FURY_GATEWAY_CONVERSATION_COMMAND_DEFINITIONS,
  FURY_GATEWAY_CONVERSATION_COMMAND_NAMES,
  createFuryGatewayConversationAdapter,
  type FuryGatewayConversationCommandName,
} from '../src/gateway-conversation-adapter-node.js';
import {
  createFuryGatewayLocalBootstrapManager,
} from '../src/gateway-local-operator-bootstrap-node.js';
import {
  createFuryGatewayLocalModelRuntime,
} from '../src/gateway-local-model-runtime-node.js';
import {
  createFuryKernelToolBridge,
} from '../src/fury-kernel-tool-bridge-node.js';
import {
  createFuryKernelMemoryBridge,
} from '../src/fury-kernel-memory-bridge-node.js';
import {
  deriveMcpDirectEndpointFingerprint,
  type McpDirectRuntimeConfig,
} from '../src/mcp-direct-client-node.js';
import {
  createFuryGatewayToolBridgeAdapter,
} from '../src/gateway-tool-bridge-adapter-node.js';
import {
  createFuryGatewayMemoryAdapter,
} from '../src/gateway-memory-adapter-node.js';
import {
  FURY_GATEWAY_TOOL_COMMAND_DEFINITIONS,
  FURY_GATEWAY_TOOL_EXECUTION_COMMAND_NAMES,
  FURY_GATEWAY_TOOL_STATE_COMMAND_NAMES,
  type FuryGatewayToolExecutionCommandName,
  type FuryGatewayToolStateCommandName,
} from '../src/gateway-tool-command-node.js';
import {
  FURY_GATEWAY_MODEL_EXECUTION_COMMAND_DEFINITIONS,
  FURY_GATEWAY_MODEL_EXECUTION_COMMAND_NAMES,
} from '../src/gateway-model-command-node.js';
import {
  FURY_GATEWAY_MEMORY_COMMAND_DEFINITIONS,
  FURY_GATEWAY_MEMORY_EXECUTION_COMMAND_NAMES,
  FURY_GATEWAY_MEMORY_STATE_COMMAND_NAMES,
  type FuryGatewayMemoryExecutionCommandName,
  type FuryGatewayMemoryStateCommandName,
} from '../src/gateway-memory-command-node.js';
import {
  FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
  createFuryGatewayPrincipalRegistry,
} from '../src/gateway-principal-node.js';
import {
  createFuryGatewaySessionCoordinator,
  type FuryGatewayScope,
} from '../src/gateway-session-node.js';
import {
  listenFuryGatewayWebSocketHost,
} from '../src/gateway-websocket-host-node.js';
import {
  FURY_GATEWAY_WEBCHAT_PATH,
  createFuryGatewayWebChatHandler,
} from '../src/gateway-webchat-node.js';
import { createFuryKernelConversationStore } from '../src/fury-kernel.js';

const HOST = '127.0.0.1';
const REPORT_DIR = join(process.cwd(), 'artifacts', 'gateway-webchat-browser-qa');
const SOURCE_COMMIT = process.env.FURYPIPE_SOURCE_COMMIT ?? 'unknown';
const MCP_FIXTURE_PATH = fileURLToPath(
  new URL('../tests/fixtures/mcp-direct-execution-stdio-server.mjs', import.meta.url),
);

type EngineName = 'chromium' | 'firefox' | 'webkit';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to allocate WebChat QA port');
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  );
  return port;
}

async function startHarness(
  modelEnabled = false,
  toolEnabled = false,
  memoryEnabled = false,
) {
  const port = await freePort();
  const origin = `http://${HOST}:${port}`;
  const now = () => Date.now();
  const kernel = createFuryKernelConversationStore({
    now,
    maxConversations: 32,
    maxMessagesPerConversation: 256,
    maxTurnsPerConversation: 128,
    maxMessageBytes: 32 * 1024,
    maxConversationBytes: 512 * 1024,
    maxInFlightTurns: 16,
  });

  let memoryCandidates: readonly ContinuousMemoryCandidate[] = Object.freeze([]);
  const memoryRoot = memoryEnabled
    ? await mkdtemp(join(tmpdir(), 'furypipe-webchat-memory-browser-qa-'))
    : undefined;
  const memoryScopes = memoryEnabled
    ? Object.freeze({ user: 'browser-qa-private-user-scope' })
    : undefined;
  const memoryEngine = memoryRoot && memoryScopes
    ? createContinuousMemoryEngine({
        recovery: createRecoveryStore(memoryRoot, {
          namespace: 'webchat-browser-qa',
          maxObjectBytes: 256 * 1024,
          maxTotalBytes: 8 * 1024 * 1024,
          maxGlobalBytes: 32 * 1024 * 1024,
          encryption: {
            activeKeyId: 'browser-qa-key-v1',
            keys: {
              'browser-qa-key-v1': new Uint8Array(Buffer.alloc(32, 23)),
            },
            allowLegacyPlaintext: false,
          },
        }),
        analyzer: {
          async selectRecallTerms() {
            return Object.freeze([]);
          },
          async extractCandidates() {
            return memoryCandidates;
          },
        },
        policy: {
          allowInferred: false,
          allowSensitive: false,
        },
      })
    : undefined;
  const memoryBridge = memoryEngine && memoryScopes
    ? createFuryKernelMemoryBridge({
        engine: memoryEngine,
        scopes: memoryScopes,
        now,
      })
    : undefined;
  const memoryAdapter = memoryBridge
    ? createFuryGatewayMemoryAdapter({
        bridge: memoryBridge,
        config: Object.freeze({
          format: 'furypipe-gateway-local-memory-config/v1',
          enabled: true as const,
          encrypted: true as const,
          scopeKinds: Object.freeze(['user'] as const),
          policy: Object.freeze({
            allowInferred: false,
            allowSensitive: false,
          }),
          learningEnabled: true,
          quotas: Object.freeze({
            maxObjectBytes: 256 * 1024,
            maxTotalBytes: 8 * 1024 * 1024,
            maxGlobalBytes: 32 * 1024 * 1024,
          }),
        }),
      })
    : undefined;

  const modelRuntime = createFuryGatewayLocalModelRuntime({
    kernel,
    env: modelEnabled
      ? {
          FURYPIPE_WEBCHAT_PROVIDER: 'openai',
          FURYPIPE_WEBCHAT_MODEL: 'gpt-5.6-sol',
          FURYPIPE_WEBCHAT_MAX_OUTPUT_TOKENS: '1024',
          OPENAI_API_KEY: 'browser-qa-local-secret',
        }
      : {},
    ...(memoryEngine && memoryScopes
      ? {
          memory: {
            engine: memoryEngine,
            scopes: memoryScopes,
          },
        }
      : {}),
    now,
    ...(modelEnabled
      ? {
          fetchImpl: async () => new Response(JSON.stringify({
            id: 'resp_browser_qa',
            output: [{
              type: 'message',
              role: 'assistant',
              content: [{
                type: 'output_text',
                text: 'Governed browser QA model response.',
              }],
            }],
            usage: {
              input_tokens: 12,
              input_tokens_details: {
                cached_tokens: 0,
                cache_write_tokens: 0,
              },
              output_tokens: 6,
            },
          }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'browser-qa-request',
            },
          }),
        }
      : {}),
  });

  const toolBridge = (() => {
    if (!toolEnabled) return undefined;
    const provisional: McpDirectRuntimeConfig = {
      source: {
        sourceId: 'browser-qa-tools',
        transport: 'stdio',
        endpointFingerprint: '0'.repeat(64),
        trust: 'trusted',
      },
      command: process.execPath,
      args: [MCP_FIXTURE_PATH],
    };
    const endpointFingerprint = deriveMcpDirectEndpointFingerprint(provisional);
    const config: McpDirectRuntimeConfig = {
      ...provisional,
      source: {
        ...provisional.source,
        endpointFingerprint,
      },
    };
    return createFuryKernelToolBridge({
      sources: [{
        config,
        policy: {
          format: 'furypipe-mcp-direct-policy/v1',
          policyId: 'browser-qa-tools-policy',
          governedPolicyAllowlist: [],
          operatorApprovalAllowlist: [{
            sourceId: 'browser-qa-tools',
            endpointFingerprint,
            toolName: 'governed-echo',
          }],
        },
      }],
      clientInfo: {
        name: 'furypipe-webchat-browser-qa',
        version: '1.0.0',
      },
      allowDisplayResult: true,
    });
  })();

  const toolAdapter = toolBridge
    ? createFuryGatewayToolBridgeAdapter({ bridge: toolBridge })
    : undefined;

  const principalRegistry = createFuryGatewayPrincipalRegistry({
    now,
    evidenceTtlMs: 15 * 60_000,
    maxPrincipals: 2,
  });
  const principal = principalRegistry.recordAuthenticatedPrincipal({
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: 'webchat-browser-qa-owner',
    kind: 'human',
    issuer: 'furypipe-browser-qa',
    subject: 'browser-qa-local-owner',
    authenticationMethod: 'local-owner',
  });
  const sessionCoordinator = createFuryGatewaySessionCoordinator({
    principalRegistry,
    gatewayInstanceId: 'gateway-webchat-browser-qa',
    now,
    defaultTtlMs: 60 * 60_000,
    maxTtlMs: 60 * 60_000,
    maxSessions: 8,
  });
  const scopes: FuryGatewayScope[] = [
    'gateway.inspect',
    'conversations.inspect',
    'conversations.write',
  ];
  if (modelRuntime.bridge) scopes.push('capability.provider-inference');
  if (memoryBridge) scopes.push('memory.read', 'memory.write', 'memory.manage');
  if (toolBridge) {
    scopes.push('mcp.inspect', 'mcp.manage', 'capability.process');
  }
  const session = sessionCoordinator.issueSession({
    principal,
    role: 'operator',
    scopes,
    binding: { kind: 'local-operator' },
    expiresInMs: 60 * 60_000,
  });

  const bootstrap = createFuryGatewayLocalBootstrapManager({
    sessionCoordinator,
    session,
    allowedOrigins: [origin],
    now,
    bootstrapTtlMs: 60_000,
    browserSessionTtlMs: 15 * 60_000,
    maxPendingTickets: 16,
    maxBrowserSessions: 16,
  });
  const webchat = createFuryGatewayWebChatHandler({
    origin,
    modelBridgeEnabled: modelRuntime.bridge !== undefined,
    ...(modelRuntime.config.enabled
      ? {
          modelProvider: modelRuntime.config.providerId,
          model: modelRuntime.config.model,
        }
      : {}),
    toolBridgeEnabled: toolBridge !== undefined,
    ...(toolBridge ? { toolSourceCount: 1 } : {}),
    memoryEnabled: memoryBridge !== undefined,
  });
  const adapter = createFuryGatewayConversationAdapter({
    kernel,
    maxResultBytes: 48 * 1024,
  });
  const commandRegistry = createFuryGatewayCommandRegistry([
    ...FURY_GATEWAY_CONVERSATION_COMMAND_DEFINITIONS,
    ...(modelRuntime.bridge
      ? FURY_GATEWAY_MODEL_EXECUTION_COMMAND_DEFINITIONS
      : []),
    ...(toolBridge
      ? FURY_GATEWAY_TOOL_COMMAND_DEFINITIONS
      : []),
    ...(memoryBridge
      ? FURY_GATEWAY_MEMORY_COMMAND_DEFINITIONS
      : []),
  ]);
  const admittedStateCommandNames = Object.freeze([
    ...FURY_GATEWAY_CONVERSATION_COMMAND_NAMES,
    ...(toolBridge ? FURY_GATEWAY_TOOL_STATE_COMMAND_NAMES : []),
    ...(memoryBridge ? FURY_GATEWAY_MEMORY_STATE_COMMAND_NAMES : []),
  ]);
  const admittedExecutionCommandNames = Object.freeze([
    ...(modelRuntime.bridge ? FURY_GATEWAY_MODEL_EXECUTION_COMMAND_NAMES : []),
    ...(toolBridge ? FURY_GATEWAY_TOOL_EXECUTION_COMMAND_NAMES : []),
    ...(memoryBridge ? FURY_GATEWAY_MEMORY_EXECUTION_COMMAND_NAMES : []),
  ]);

  const host = await listenFuryGatewayWebSocketHost({
    host: HOST,
    port,
    sessionCoordinator,
    commandRegistry,
    allowedOrigins: [origin],
    handleHttpRequest: async (request, response) => {
      if (await webchat(request, response)) return true;
      return bootstrap.handleHttpRequest(request, response);
    },
    resolveConnection: ({ request }) => bootstrap.resolveConnection(request),
    admittedStateCommandNames,
    handleAdmittedStateCommand: (command) => {
      if (
        (FURY_GATEWAY_CONVERSATION_COMMAND_NAMES as readonly string[])
          .includes(command.commandName)
      ) {
        const result = adapter.dispatch(
          command.commandName as FuryGatewayConversationCommandName,
          command.input,
        );
        if (
          command.commandName === 'conversation.cancel'
          && result.status === 'ok'
          && modelRuntime.bridge
        ) {
          const input = command.input as {
            readonly conversationId: string;
            readonly turnId: string;
          };
          modelRuntime.bridge.cancelTurn(input.conversationId, input.turnId);
        }
        return result;
      }
      if (
        toolAdapter
        && (FURY_GATEWAY_TOOL_STATE_COMMAND_NAMES as readonly string[])
          .includes(command.commandName)
      ) {
        return toolAdapter.dispatchState(
          command.commandName as FuryGatewayToolStateCommandName,
          command.input,
        );
      }
      if (
        memoryAdapter
        && (FURY_GATEWAY_MEMORY_STATE_COMMAND_NAMES as readonly string[])
          .includes(command.commandName)
      ) {
        return memoryAdapter.dispatchState(
          command.commandName as FuryGatewayMemoryStateCommandName,
          command.input,
        );
      }
      throw new Error('browser QA received unsupported state command');
    },
    ...(admittedExecutionCommandNames.length > 0
      ? {
          admittedExecutionCommandNames,
          handleAdmittedExecutionCommand: async (command) => {
            if (
              command.commandName === 'conversation.model.execute'
              && modelRuntime.bridge
            ) {
              return modelRuntime.bridge.executeTurn(
                command.input as {
                  readonly conversationId: string;
                  readonly turnId: string;
                },
              );
            }
            if (
              toolAdapter
              && (FURY_GATEWAY_TOOL_EXECUTION_COMMAND_NAMES as readonly string[])
                .includes(command.commandName)
            ) {
              return toolAdapter.dispatchExecution(
                command.commandName as FuryGatewayToolExecutionCommandName,
                command.input,
              );
            }
            if (
              memoryAdapter
              && (FURY_GATEWAY_MEMORY_EXECUTION_COMMAND_NAMES as readonly string[])
                .includes(command.commandName)
            ) {
              return memoryAdapter.dispatchExecution(
                command.commandName as FuryGatewayMemoryExecutionCommandName,
                command.input,
              );
            }
            throw new Error('browser QA received unsupported execution command');
          },
        }
      : {}),
  });

  let memorySeedCounter = 0;
  return {
    origin,
    bootstrap,
    kernel,
    async seedMemory(key: string, text: string) {
      if (!memoryEngine || !memoryScopes) {
        throw new Error('browser QA memory harness is disabled');
      }
      memorySeedCounter += 1;
      memoryCandidates = Object.freeze([{
        action: 'REMEMBER' as const,
        key,
        scopeKind: 'user' as const,
        memoryClass: 'User' as const,
        text,
        terms: Object.freeze(['browser', 'memory', 'qa']),
        importance: 1,
        confidence: 1,
        evidence: 'explicit-user' as const,
      }]);
      try {
        const learned = await memoryEngine.afterTurn({
          conversationId: `browser-memory-seed-${memorySeedCounter}`,
          turnId: `browser-memory-seed-turn-${memorySeedCounter}`,
          scopes: memoryScopes,
          messages: Object.freeze([{
            role: 'user' as const,
            content: 'Explicit browser QA memory seed.',
          }]),
          now: now(),
        });
        assert(
          learned.added + learned.updated > 0,
          'browser QA memory seed did not create an active memory',
        );
      } finally {
        memoryCandidates = Object.freeze([]);
      }
    },
    async close() {
      bootstrap.revokeAllBrowserSessions();
      await host.stop();
      sessionCoordinator.revokeSession(session.sessionId);
      principalRegistry.revokePrincipal(principal.principalId);
      if (memoryRoot) {
        await rm(memoryRoot, { recursive: true, force: true });
      }
    },
  };
}

interface QaObservation {
  readonly name: string;
  readonly engine: EngineName;
  readonly viewport: string;
  readonly overflow: boolean;
  readonly externalScripts: readonly string[];
  readonly csp: string;
  readonly consoleErrors: readonly string[];
  readonly pageErrors: readonly string[];
  readonly firstConversationId: string;
  readonly secondConversationId: string;
  readonly resynchronized: boolean;
  readonly loggedOut: boolean;
}

async function runCase(
  browser: Browser,
  engine: EngineName,
  viewport: { readonly id: string; readonly width: number; readonly height: number },
  harness: Awaited<ReturnType<typeof startHarness>>,
): Promise<QaObservation> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  let screenshotInProgress = false;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const webkitScreenshotStyleNoise =
      screenshotInProgress
      && engine === 'webkit'
      && text.includes(
        "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.",
      );
    if (!webkitScreenshotStyleNoise) consoleErrors.push(text);
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const name = `${engine}-${viewport.id}`;
  try {
    const response = await page.goto(harness.origin + FURY_GATEWAY_WEBCHAT_PATH, {
      waitUntil: 'domcontentloaded',
    });
    assert(response?.status() === 200, `${name}: WebChat HTTP status was not 200`);
    await page.locator('#bootstrap-form').waitFor({ state: 'visible', timeout: 15_000 });
    const headers = response.headers();
    const csp = headers['content-security-policy'] ?? '';
    assert(csp.includes("default-src 'none'"), `${name}: CSP default-src is not deny-by-default`);
    assert(csp.includes("script-src 'self'"), `${name}: CSP does not restrict scripts to self`);
    assert(!csp.includes("'unsafe-inline'"), `${name}: CSP allows inline code`);
    assert(!csp.includes("'unsafe-eval'"), `${name}: CSP allows eval`);

    const structural = await page.evaluate(() => ({
      overflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
        || document.body.scrollWidth > document.documentElement.clientWidth + 1,
      externalScripts: [...document.querySelectorAll<HTMLScriptElement>('script[src]')]
        .map((script) => new URL(script.src, location.href).origin)
        .filter((origin) => origin !== location.origin),
      h1Count: document.querySelectorAll('h1').length,
      hasBootstrapForm: !!document.getElementById('bootstrap-form'),
      chatInitiallyHidden: (document.getElementById('chat-panel') as HTMLElement | null)?.hidden === true,
    }));
    assert(!structural.overflow, `${name}: initial layout overflows horizontally`);
    assert(structural.externalScripts.length === 0, `${name}: external scripts detected`);
    assert(structural.h1Count === 1, `${name}: expected one H1`);
    assert(structural.hasBootstrapForm && structural.chatInitiallyHidden, `${name}: bootstrap-first UI contract failed`);

    const ticket = harness.bootstrap.issueTicket();
    await page.locator('#bootstrap-code').fill(ticket.code);
    await page.locator('#bootstrap-form button[type="submit"]').click();
    await page.waitForFunction(() =>
      document.getElementById('connection-label')?.textContent === 'Connected'
      && /^fkc_[A-Za-z0-9_-]{24}$/u.test(
        document.getElementById('conversation-id')?.textContent ?? '',
      ),
    undefined, { timeout: 10_000 });

    const firstConversationId =
      (await page.locator('#conversation-id').textContent())?.trim() ?? '';
    assert(/^fkc_[A-Za-z0-9_-]{24}$/u.test(firstConversationId), `${name}: no Kernel conversation ID`);
    assert(await page.locator('#bootstrap-panel').isHidden(), `${name}: bootstrap panel remained visible`);
    assert(await page.locator('#chat-panel').isVisible(), `${name}: chat panel is not visible`);

    const testMessage = `WebChat browser QA ${name}`;
    await page.locator('#message-input').fill(testMessage);
    await page.locator('#send-message').click();
    await page.waitForFunction(() =>
      document.getElementById('turn-status')?.textContent?.includes('model bridge not configured'),
    undefined, { timeout: 8_000 });
    assert(
      await page.locator('.message.user').last().textContent()
        .then((text) => text?.includes(testMessage) ?? false),
      `${name}: user message not rendered`,
    );
    assert(await page.locator('#cancel-turn').isEnabled(), `${name}: active turn is not cancellable`);

    await page.locator('#cancel-turn').click();
    await page.waitForFunction(() =>
      document.getElementById('turn-status')?.textContent === 'Turn cancelled',
    undefined, { timeout: 8_000 });

    await page.locator('#reconnect').click();
    await page.waitForFunction(() =>
      document.getElementById('connection-label')?.textContent === 'Connected'
      && document.getElementById('activity-list')?.textContent?.includes('resynchronized'),
    undefined, { timeout: 10_000 });
    const resynchronized =
      (await page.locator('#activity-list').textContent())?.includes('resynchronized') ?? false;
    assert(resynchronized, `${name}: reconnect did not resynchronize conversation state`);

    await page.locator('#new-conversation').click();
    await page.waitForFunction((oldId) => {
      const current = document.getElementById('conversation-id')?.textContent ?? '';
      return /^fkc_[A-Za-z0-9_-]{24}$/u.test(current) && current !== oldId;
    }, firstConversationId, { timeout: 8_000 });
    const secondConversationId =
      (await page.locator('#conversation-id').textContent())?.trim() ?? '';
    assert(secondConversationId !== firstConversationId, `${name}: conversation rollover reused the old ID`);

    const postInteraction = await page.evaluate(() => ({
      overflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
        || document.body.scrollWidth > document.documentElement.clientWidth + 1,
      activityEntries: document.querySelectorAll('#activity-list li').length,
    }));
    assert(!postInteraction.overflow, `${name}: interactive layout overflows horizontally`);
    assert(postInteraction.activityEntries > 0, `${name}: governance activity remained empty`);

    assert(
      consoleErrors.length === 0,
      `${name}: pre-screenshot console errors: ${consoleErrors.join(' | ')}`,
    );
    assert(
      pageErrors.length === 0,
      `${name}: pre-screenshot page errors: ${pageErrors.join(' | ')}`,
    );

    if (viewport.id === 'desktop') {
      screenshotInProgress = true;
      try {
        await page.screenshot({
          path: join(REPORT_DIR, `webchat-${name}.png`),
          fullPage: true,
        });
      } finally {
        screenshotInProgress = false;
      }
    }

    await page.locator('#logout').click();
    try {
      await page.waitForFunction(() =>
        (document.getElementById('bootstrap-panel') as HTMLElement | null)?.hidden === false
        && (document.getElementById('chat-panel') as HTMLElement | null)?.hidden === true
        && document.getElementById('connection-label')?.textContent === 'Not connected',
      undefined, { timeout: 8_000 });
    } catch (error) {
      const logoutState = await page.evaluate(() => ({
        bootstrapHidden: (document.getElementById('bootstrap-panel') as HTMLElement | null)?.hidden,
        chatHidden: (document.getElementById('chat-panel') as HTMLElement | null)?.hidden,
        connectionLabel: document.getElementById('connection-label')?.textContent ?? null,
        bootstrapStatus: document.getElementById('bootstrap-status')?.textContent ?? null,
        readyState: document.readyState,
      }));
      console.error(`${name}: logout state before timeout ${JSON.stringify(logoutState)}`);
      throw error;
    }
    const loggedOut = await page.locator('#bootstrap-panel').isVisible();
    assert(loggedOut, `${name}: logout did not restore bootstrap UI`);

    assert(consoleErrors.length === 0, `${name}: console errors: ${consoleErrors.join(' | ')}`);
    assert(pageErrors.length === 0, `${name}: page errors: ${pageErrors.join(' | ')}`);

    return {
      name,
      engine,
      viewport: viewport.id,
      overflow: postInteraction.overflow,
      externalScripts: structural.externalScripts,
      csp,
      consoleErrors,
      pageErrors,
      firstConversationId,
      secondConversationId,
      resynchronized,
      loggedOut,
    };
  } finally {
    await context.close();
  }
}

async function runEngine(
  engine: EngineName,
  browserType: BrowserType,
  harness: Awaited<ReturnType<typeof startHarness>>,
): Promise<readonly QaObservation[]> {
  const browser = await browserType.launch({ headless: true });
  try {
    const observations: QaObservation[] = [];
    for (const viewport of [
      { id: 'desktop', width: 1440, height: 900 },
      { id: 'mobile', width: 390, height: 844 },
    ] as const) {
      observations.push(await runCase(browser, engine, viewport, harness));
    }
    return Object.freeze(observations);
  } finally {
    await browser.close();
  }
}

interface ModelQaObservation {
  readonly name: string;
  readonly engine: EngineName;
  readonly assistantRendered: boolean;
  readonly modelEligible: boolean;
  readonly modelResponseObserved: boolean;
  readonly secretAbsent: boolean;
  readonly configRedacted: boolean;
}

async function runModelEnabledCase(
  engine: EngineName,
  browserType: BrowserType,
  harness: Awaited<ReturnType<typeof startHarness>>,
): Promise<ModelQaObservation> {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const name = `${engine}-model-enabled`;
  try {
    const response = await page.goto(
      harness.origin + FURY_GATEWAY_WEBCHAT_PATH,
      { waitUntil: 'domcontentloaded' },
    );
    assert(response?.status() === 200, `${name}: WebChat HTTP status was not 200`);
    await page.locator('#bootstrap-form').waitFor({ state: 'visible', timeout: 15_000 });

    const config = await page.evaluate(async () => {
      const response = await fetch('/gateway/webchat/config.json', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      return response.json() as Promise<Record<string, unknown>>;
    });
    const configJson = JSON.stringify(config);
    const configRedacted =
      configJson.includes('"enabled":true')
      && configJson.includes('"providerId":"openai"')
      && configJson.includes('"model":"gpt-5.6-sol"')
      && !/credential|api[_-]?key|browser-qa-local-secret/i.test(configJson);
    assert(configRedacted, `${name}: WebChat model config was not correctly redacted`);

    const ticket = harness.bootstrap.issueTicket();
    await page.locator('#bootstrap-code').fill(ticket.code);
    await page.locator('#bootstrap-form button[type="submit"]').click();
    await page.waitForFunction(() =>
      document.getElementById('connection-label')?.textContent === 'Connected'
      && /^fkc_[A-Za-z0-9_-]{24}$/u.test(
        document.getElementById('conversation-id')?.textContent ?? '',
      ),
    undefined, { timeout: 10_000 });

    const message = `Governed model browser QA ${engine}`;
    await page.locator('#message-input').fill(message);
    await page.locator('#send-message').click();

    await page.waitForFunction(() =>
      [...document.querySelectorAll('.message.assistant')].some((element) =>
        element.textContent?.includes('Governed browser QA model response.'),
      ),
    undefined, { timeout: 12_000 });

    const assistantRendered = await page.locator('.message.assistant').last()
      .textContent()
      .then((text) => text?.includes('Governed browser QA model response.') ?? false);
    const activity = await page.locator('#activity-list').textContent() ?? '';
    const modelEligible = activity.includes('Model eligible');
    const modelResponseObserved = activity.includes('Model response');
    const body = await page.locator('body').textContent() ?? '';
    const secretAbsent = !body.includes('browser-qa-local-secret');

    assert(assistantRendered, `${name}: assistant response did not render`);
    assert(modelEligible, `${name}: model eligibility state was not surfaced`);
    assert(modelResponseObserved, `${name}: model response state was not surfaced`);
    assert(secretAbsent, `${name}: provider secret leaked into rendered UI`);
    assert(consoleErrors.length === 0, `${name}: console errors: ${consoleErrors.join(' | ')}`);
    assert(pageErrors.length === 0, `${name}: page errors: ${pageErrors.join(' | ')}`);

    await page.locator('#logout').click();
    await page.waitForFunction(() =>
      (document.getElementById('bootstrap-panel') as HTMLElement | null)?.hidden === false
      && (document.getElementById('chat-panel') as HTMLElement | null)?.hidden === true,
    undefined, { timeout: 8_000 });

    return {
      name,
      engine,
      assistantRendered,
      modelEligible,
      modelResponseObserved,
      secretAbsent,
      configRedacted,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

interface ToolQaObservation {
  readonly name: string;
  readonly engine: EngineName;
  readonly proposalRequiredApproval: boolean;
  readonly approved: boolean;
  readonly executed: boolean;
  readonly succeeded: boolean;
  readonly verified: boolean;
  readonly resultRendered: boolean;
  readonly chatUntouched: boolean;
  readonly configRedacted: boolean;
}

async function runToolEnabledCase(
  engine: EngineName,
  browserType: BrowserType,
  harness: Awaited<ReturnType<typeof startHarness>>,
): Promise<ToolQaObservation> {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1360, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const name = `${engine}-tools-enabled`;
  try {
    const response = await page.goto(
      harness.origin + FURY_GATEWAY_WEBCHAT_PATH,
      { waitUntil: 'domcontentloaded' },
    );
    assert(response?.status() === 200, `${name}: WebChat HTTP status was not 200`);
    await page.locator('#bootstrap-form').waitFor({ state: 'visible', timeout: 15_000 });

    const config = await page.evaluate(async () => {
      const response = await fetch('/gateway/webchat/config.json', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      return response.json() as Promise<Record<string, unknown>>;
    });
    const configJson = JSON.stringify(config);
    const configRedacted =
      configJson.includes('"tools":{"enabled":true,"sourceCount":1}')
      && !configJson.includes('browser-qa-tools')
      && !/credential|endpointFingerprint|command|policy|header/i.test(configJson);
    assert(configRedacted, `${name}: WebChat tools config was not redacted`);

    const ticket = harness.bootstrap.issueTicket();
    await page.locator('#bootstrap-code').fill(ticket.code);
    await page.locator('#bootstrap-form button[type="submit"]').click();
    await page.waitForFunction(() =>
      document.getElementById('connection-label')?.textContent === 'Connected'
      && (document.getElementById('tools-panel') as HTMLElement | null)?.hidden === false
      && (document.getElementById('tool-source') as HTMLSelectElement | null)?.value === 'browser-qa-tools',
    undefined, { timeout: 12_000 });

    await page.locator('#tool-refresh').click();
    await page.waitForFunction(() =>
      (document.getElementById('tool-name') as HTMLSelectElement | null)?.value === 'governed-echo'
      && document.getElementById('tool-status')?.textContent === 'Inventory refreshed.',
    undefined, { timeout: 15_000 });

    const argumentMessage = `Governed tool browser QA ${engine}`;
    await page.locator('#tool-arguments').fill(JSON.stringify({
      message: argumentMessage,
    }));
    await page.locator('#tool-propose').click();
    await page.waitForFunction(() =>
      document.getElementById('tool-status')?.textContent === 'Operator approval required.'
      && !(document.getElementById('tool-approve') as HTMLButtonElement | null)?.disabled
      && (document.getElementById('tool-execute') as HTMLButtonElement | null)?.disabled === true,
    undefined, { timeout: 15_000 });

    const proposalRequiredApproval = await page.locator('#tool-status').textContent()
      .then((text) => text === 'Operator approval required.');

    await page.locator('#tool-approve').click();
    await page.waitForFunction(() =>
      document.getElementById('tool-status')?.textContent?.includes('Operator approval recorded')
      && (document.getElementById('tool-execute') as HTMLButtonElement | null)?.disabled === false,
    undefined, { timeout: 10_000 });
    const approved = await page.locator('#tool-status').textContent()
      .then((text) => text?.includes('Operator approval recorded') ?? false);

    await page.locator('#tool-execute').click();
    await page.waitForFunction(() =>
      document.getElementById('tool-status')?.textContent?.includes('executed=true')
      && document.getElementById('tool-status')?.textContent?.includes('succeeded=true')
      && document.getElementById('tool-status')?.textContent?.includes('verified=true'),
    undefined, { timeout: 20_000 });

    const lifecycle = await page.locator('#tool-status').textContent() ?? '';
    const executed = lifecycle.includes('executed=true');
    const succeeded = lifecycle.includes('succeeded=true');
    const verified = lifecycle.includes('verified=true');
    const resultText = await page.locator('#tool-result').textContent() ?? '';
    const resultRendered = resultText.includes(argumentMessage);
    const chatUntouched = await page.locator('.message.assistant').count() === 0;
    const activity = await page.locator('#activity-list').textContent() ?? '';

    assert(proposalRequiredApproval, `${name}: operator approval boundary was not surfaced`);
    assert(approved, `${name}: operator approval was not recorded`);
    assert(executed, `${name}: executed state was not surfaced`);
    assert(succeeded, `${name}: succeeded state was not surfaced`);
    assert(verified, `${name}: verified state was not surfaced`);
    assert(resultRendered, `${name}: bounded tool result was not rendered`);
    assert(chatUntouched, `${name}: tool output was inserted into assistant chat`);
    assert(activity.includes('Tool eligible'), `${name}: Gateway tool eligibility was not surfaced`);
    assert(activity.includes('Tool approved'), `${name}: tool approval was not surfaced`);
    assert(activity.includes('Tool executed'), `${name}: tool execution was not surfaced`);
    assert(activity.includes('Tool succeeded'), `${name}: tool success was not surfaced`);
    assert(activity.includes('Evidence verified'), `${name}: tool verification was not surfaced`);
    const body = await page.locator('body').textContent() ?? '';
    assert(!body.includes(MCP_FIXTURE_PATH), `${name}: MCP command path leaked into UI`);
    assert(consoleErrors.length === 0, `${name}: console errors: ${consoleErrors.join(' | ')}`);
    assert(pageErrors.length === 0, `${name}: page errors: ${pageErrors.join(' | ')}`);

    await page.locator('#logout').click();
    await page.waitForFunction(() =>
      (document.getElementById('bootstrap-panel') as HTMLElement | null)?.hidden === false
      && (document.getElementById('chat-panel') as HTMLElement | null)?.hidden === true,
    undefined, { timeout: 8_000 });

    return {
      name,
      engine,
      proposalRequiredApproval,
      approved,
      executed,
      succeeded,
      verified,
      resultRendered,
      chatUntouched,
      configRedacted,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}


interface MemoryQaObservation {
  readonly name: string;
  readonly engine: EngineName;
  readonly configRedacted: boolean;
  readonly memoryPanelVisible: boolean;
  readonly recallObserved: boolean;
  readonly learningObserved: boolean;
  readonly softForgotten: boolean;
  readonly hardPurgeConfirmed: boolean;
  readonly hardPurged: boolean;
  readonly secretAbsent: boolean;
}

async function runMemoryEnabledCase(
  engine: EngineName,
  browserType: BrowserType,
  harness: Awaited<ReturnType<typeof startHarness>>,
): Promise<MemoryQaObservation> {
  const memoryKey = `user.preference.browser-qa-${engine}`;
  const memoryText = `BROWSER_QA_MEMORY_CANARY_${engine} prefer concise browser memory qa responses`;
  await harness.seedMemory(memoryKey, memoryText);

  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1360, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const name = `${engine}-memory-enabled`;
  try {
    const response = await page.goto(
      harness.origin + FURY_GATEWAY_WEBCHAT_PATH,
      { waitUntil: 'domcontentloaded' },
    );
    assert(response?.status() === 200, `${name}: WebChat HTTP status was not 200`);
    await page.locator('#bootstrap-form').waitFor({ state: 'visible', timeout: 15_000 });

    const config = await page.evaluate(async () => {
      const response = await fetch('/gateway/webchat/config.json', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      return response.json() as Promise<Record<string, unknown>>;
    });
    const configJson = JSON.stringify(config);
    const configRedacted =
      configJson.includes('"memory":{"enabled":true}')
      && configJson.includes('"providerId":"openai"')
      && configJson.includes('"model":"gpt-5.6-sol"')
      && !/scopeKinds|private-user-scope|browser-qa-key-v1|recovery|quota|credential|api[_-]?key|token|path/i.test(configJson)
      && !configJson.includes(memoryText);
    assert(configRedacted, `${name}: WebChat memory config was not correctly redacted`);

    const ticket = harness.bootstrap.issueTicket();
    await page.locator('#bootstrap-code').fill(ticket.code);
    await page.locator('#bootstrap-form button[type="submit"]').click();
    await page.waitForFunction(() =>
      document.getElementById('connection-label')?.textContent === 'Connected'
      && (document.getElementById('memory-panel') as HTMLElement | null)?.hidden === false
      && document.getElementById('memory-badge')?.textContent === 'Encrypted'
      && (document.getElementById('memory-scope') as HTMLSelectElement | null)?.value === 'user',
    undefined, { timeout: 12_000 });

    const memoryPanelVisible = await page.locator('#memory-panel').isVisible();
    assert(memoryPanelVisible, `${name}: Memory panel was not visible`);

    await page.locator('#message-input').fill(
      `Please use my browser memory qa preference for ${engine}.`,
    );
    await page.locator('#send-message').click();

    await page.waitForFunction(() =>
      [...document.querySelectorAll('.message.assistant')].some((element) =>
        element.textContent?.includes('Governed browser QA model response.'),
      )
      && document.getElementById('activity-list')?.textContent?.includes('Memory recalled')
      && document.getElementById('activity-list')?.textContent?.includes('Memory learning completed'),
    undefined, { timeout: 15_000 });

    let activity = await page.locator('#activity-list').textContent() ?? '';
    const recallObserved = activity.includes('Memory recalled');
    const learningObserved = activity.includes('Memory learning completed');
    assert(recallObserved, `${name}: recalled-memory lifecycle was not surfaced`);
    assert(learningObserved, `${name}: memory learning lifecycle was not surfaced`);

    await page.locator('#memory-key').fill(memoryKey);
    await page.waitForFunction(() =>
      (document.getElementById('memory-forget') as HTMLButtonElement | null)?.disabled === false,
    undefined, { timeout: 5_000 });
    await page.locator('#memory-forget').click();
    await page.waitForFunction(() =>
      document.getElementById('memory-status')?.textContent?.includes('Soft forget completed'),
    undefined, { timeout: 10_000 });

    activity = await page.locator('#activity-list').textContent() ?? '';
    const softForgotten =
      (await page.locator('#memory-status').textContent() ?? '').includes('Soft forget completed')
      && activity.includes('Memory forgotten');
    assert(softForgotten, `${name}: soft forget did not complete through governed memory`);

    await harness.seedMemory(memoryKey, memoryText);

    await page.locator('#memory-key').fill(memoryKey);
    await page.locator('#memory-purge-confirm').check();
    await page.waitForFunction(() =>
      (document.getElementById('memory-purge') as HTMLButtonElement | null)?.disabled === false,
    undefined, { timeout: 5_000 });
    const hardPurgeConfirmed = await page.locator('#memory-purge').isEnabled();
    assert(hardPurgeConfirmed, `${name}: hard purge did not require/accept explicit confirmation`);

    await page.locator('#memory-purge').click();
    await page.waitForFunction(() =>
      document.getElementById('memory-status')?.textContent?.includes('Hard purge completed'),
    undefined, { timeout: 10_000 });

    activity = await page.locator('#activity-list').textContent() ?? '';
    const hardPurged =
      (await page.locator('#memory-status').textContent() ?? '').includes('Hard purge completed')
      && activity.includes('Memory purged');
    assert(hardPurged, `${name}: hard purge did not complete through governed memory`);

    const body = await page.locator('body').textContent() ?? '';
    const secretAbsent =
      !body.includes(memoryText)
      && !body.includes('browser-qa-private-user-scope')
      && !body.includes('browser-qa-key-v1')
      && !body.includes('BROWSER_QA_MEMORY_CANARY_');
    assert(secretAbsent, `${name}: raw memory/config material leaked into rendered UI`);
    assert(consoleErrors.length === 0, `${name}: console errors: ${consoleErrors.join(' | ')}`);
    assert(pageErrors.length === 0, `${name}: page errors: ${pageErrors.join(' | ')}`);

    await page.locator('#logout').click();
    await page.waitForFunction(() =>
      (document.getElementById('bootstrap-panel') as HTMLElement | null)?.hidden === false
      && (document.getElementById('chat-panel') as HTMLElement | null)?.hidden === true,
    undefined, { timeout: 8_000 });

    return Object.freeze({
      name,
      engine,
      configRedacted,
      memoryPanelVisible,
      recallObserved,
      learningObserved,
      softForgotten,
      hardPurgeConfirmed,
      hardPurged,
      secretAbsent,
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

/** Name the engine and case in any failure, so CI logs say which browser and scenario broke. */
async function labelled<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[${label}] ${message}`, { cause: error });
  }
}

async function main(): Promise<void> {
  await mkdir(REPORT_DIR, { recursive: true });
  const harness = await startHarness();
  const modelHarness = await startHarness(true);
  const toolHarness = await startHarness(false, true);
  const memoryHarness = await startHarness(true, false, true);
  try {
    const observations: QaObservation[] = [];
    observations.push(...await labelled('chromium lifecycle', () => runEngine('chromium', chromium, harness)));
    observations.push(...await labelled('firefox lifecycle', () => runEngine('firefox', firefox, harness)));
    observations.push(...await labelled('webkit lifecycle', () => runEngine('webkit', webkit, harness)));
    assert(observations.length === 6, `expected 6 WebChat browser cases, got ${observations.length}`);
    assert(observations.every((item) => item.resynchronized && item.loggedOut), 'WebChat lifecycle evidence is incomplete');

    const modelCases: ModelQaObservation[] = [];
    modelCases.push(await labelled('chromium model-enabled', () => runModelEnabledCase('chromium', chromium, modelHarness)));
    modelCases.push(await labelled('firefox model-enabled', () => runModelEnabledCase('firefox', firefox, modelHarness)));
    modelCases.push(await labelled('webkit model-enabled', () => runModelEnabledCase('webkit', webkit, modelHarness)));
    assert(
      modelCases.every((item) =>
        item.assistantRendered
        && item.modelEligible
        && item.modelResponseObserved
        && item.secretAbsent
        && item.configRedacted
      ),
      'WebChat governed model browser evidence is incomplete',
    );

    const toolCases: ToolQaObservation[] = [];
    toolCases.push(await labelled('chromium tool-enabled', () => runToolEnabledCase('chromium', chromium, toolHarness)));
    toolCases.push(await labelled('firefox tool-enabled', () => runToolEnabledCase('firefox', firefox, toolHarness)));
    toolCases.push(await labelled('webkit tool-enabled', () => runToolEnabledCase('webkit', webkit, toolHarness)));
    assert(
      toolCases.every((item) =>
        item.proposalRequiredApproval
        && item.approved
        && item.executed
        && item.succeeded
        && item.verified
        && item.resultRendered
        && item.chatUntouched
        && item.configRedacted
      ),
      'WebChat governed tool browser evidence is incomplete',
    );

    const memoryCases: MemoryQaObservation[] = [];
    memoryCases.push(await labelled('chromium memory-enabled', () => runMemoryEnabledCase('chromium', chromium, memoryHarness)));
    memoryCases.push(await labelled('firefox memory-enabled', () => runMemoryEnabledCase('firefox', firefox, memoryHarness)));
    memoryCases.push(await labelled('webkit memory-enabled', () => runMemoryEnabledCase('webkit', webkit, memoryHarness)));
    assert(
      memoryCases.every((item) =>
        item.configRedacted
        && item.memoryPanelVisible
        && item.recallObserved
        && item.learningObserved
        && item.softForgotten
        && item.hardPurgeConfirmed
        && item.hardPurged
        && item.secretAbsent
      ),
      'WebChat governed Memory browser evidence is incomplete',
    );

    const evidence = {
      format: 'furypipe-gateway-webchat-browser-evidence/v1',
      sourceCommit: SOURCE_COMMIT,
      generatedAt: new Date().toISOString(),
      authority: 'browser-qa-only',
      executionAuthority: false,
      cases: observations,
      modelCases,
      toolCases,
      memoryCases,
      summary: {
        total: observations.length + modelCases.length + toolCases.length + memoryCases.length,
        passed: observations.length + modelCases.length + toolCases.length + memoryCases.length,
        engines: ['chromium', 'firefox', 'webkit'],
        viewports: ['desktop', 'mobile'],
        modelEnabledCases: modelCases.length,
        toolEnabledCases: toolCases.length,
        memoryEnabledCases: memoryCases.length,
      },
    };
    await writeFile(
      join(REPORT_DIR, 'report.json'),
      JSON.stringify(evidence, null, 2) + '\n',
      'utf8',
    );
    console.log('Gateway WebChat browser QA passed: 15/15 real browser cases');
  } finally {
    await memoryHarness.close();
    await toolHarness.close();
    await modelHarness.close();
    await harness.close();
  }
}

await main();
