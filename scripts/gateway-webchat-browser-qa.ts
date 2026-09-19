import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
  FURY_GATEWAY_MODEL_EXECUTION_COMMAND_DEFINITIONS,
  FURY_GATEWAY_MODEL_EXECUTION_COMMAND_NAMES,
} from '../src/gateway-model-command-node.js';
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

async function startHarness(modelEnabled = false) {
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
    admittedStateCommandNames: FURY_GATEWAY_CONVERSATION_COMMAND_NAMES,
    handleAdmittedStateCommand: (command) => {
      if (
        !(FURY_GATEWAY_CONVERSATION_COMMAND_NAMES as readonly string[])
          .includes(command.commandName)
      ) {
        throw new Error('browser QA received unsupported state command');
      }
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
    },
    ...(modelRuntime.bridge
      ? {
          admittedExecutionCommandNames:
            FURY_GATEWAY_MODEL_EXECUTION_COMMAND_NAMES,
          handleAdmittedExecutionCommand: async (command) => {
            if (command.commandName !== 'conversation.model.execute') {
              throw new Error('browser QA received unsupported execution command');
            }
            return modelRuntime.bridge!.executeTurn(
              command.input as {
                readonly conversationId: string;
                readonly turnId: string;
              },
            );
          },
        }
      : {}),
  });

  return {
    origin,
    bootstrap,
    kernel,
    async close() {
      bootstrap.revokeAllBrowserSessions();
      await host.stop();
      sessionCoordinator.revokeSession(session.sessionId);
      principalRegistry.revokePrincipal(principal.principalId);
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
      waitUntil: 'load',
    });
    assert(response?.status() === 200, `${name}: WebChat HTTP status was not 200`);
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
    await page.waitForFunction(() =>
      (document.getElementById('bootstrap-panel') as HTMLElement | null)?.hidden === false
      && (document.getElementById('chat-panel') as HTMLElement | null)?.hidden === true
      && document.getElementById('connection-label')?.textContent === 'Not connected',
    undefined, { timeout: 8_000 });
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
      { waitUntil: 'load' },
    );
    assert(response?.status() === 200, `${name}: WebChat HTTP status was not 200`);

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

async function main(): Promise<void> {
  await mkdir(REPORT_DIR, { recursive: true });
  const harness = await startHarness();
  const modelHarness = await startHarness(true);
  try {
    const observations: QaObservation[] = [];
    observations.push(...await runEngine('chromium', chromium, harness));
    observations.push(...await runEngine('firefox', firefox, harness));
    observations.push(...await runEngine('webkit', webkit, harness));
    assert(observations.length === 6, `expected 6 WebChat browser cases, got ${observations.length}`);
    assert(observations.every((item) => item.resynchronized && item.loggedOut), 'WebChat lifecycle evidence is incomplete');

    const modelCases: ModelQaObservation[] = [];
    modelCases.push(await runModelEnabledCase('chromium', chromium, modelHarness));
    modelCases.push(await runModelEnabledCase('firefox', firefox, modelHarness));
    modelCases.push(await runModelEnabledCase('webkit', webkit, modelHarness));
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

    const evidence = {
      format: 'furypipe-gateway-webchat-browser-evidence/v1',
      sourceCommit: SOURCE_COMMIT,
      generatedAt: new Date().toISOString(),
      authority: 'browser-qa-only',
      executionAuthority: false,
      cases: observations,
      modelCases,
      summary: {
        total: observations.length + modelCases.length,
        passed: observations.length + modelCases.length,
        engines: ['chromium', 'firefox', 'webkit'],
        viewports: ['desktop', 'mobile'],
        modelEnabledCases: modelCases.length,
      },
    };
    await writeFile(
      join(REPORT_DIR, 'report.json'),
      JSON.stringify(evidence, null, 2) + '\n',
      'utf8',
    );
    console.log('Gateway WebChat browser QA passed: 9/9 real browser cases');
  } finally {
    await modelHarness.close();
    await harness.close();
  }
}

await main();
