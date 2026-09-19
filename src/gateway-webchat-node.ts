import type { IncomingMessage, ServerResponse } from 'node:http';

import type { FuryGatewayWebSocketHttpRequestHandler } from './gateway-websocket-host-node.js';

export const FURY_GATEWAY_WEBCHAT_PATH = '/gateway/webchat/' as const;
export const FURY_GATEWAY_WEBCHAT_SCRIPT_PATH = '/gateway/webchat/app.js' as const;
export const FURY_GATEWAY_WEBCHAT_STYLE_PATH = '/gateway/webchat/styles.css' as const;
export const FURY_GATEWAY_WEBCHAT_CONFIG_PATH = '/gateway/webchat/config.json' as const;
export const FURY_GATEWAY_WEBCHAT_CONFIG_FORMAT =
  'furypipe-gateway-webchat-config/v1' as const;

export interface FuryGatewayWebChatOptions {
  readonly origin: string;
  readonly modelBridgeEnabled?: boolean;
  readonly modelProvider?: 'openai' | 'anthropic' | 'google';
  readonly model?: string;
  readonly toolBridgeEnabled?: boolean;
  readonly toolSourceCount?: number;
}

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="Local FuryPipe WebChat powered by the governed Fury Gateway and Fury Kernel.">
  <title>FuryPipe WebChat</title>
  <link rel="stylesheet" href="/gateway/webchat/styles.css">
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">FURYPIPE VNEXT</p>
        <h1>Local WebChat</h1>
      </div>
      <div class="connection">
        <span id="connection-dot" class="dot" aria-hidden="true"></span>
        <span id="connection-label">Not connected</span>
      </div>
    </header>

    <section id="bootstrap-panel" class="panel auth-panel" aria-labelledby="bootstrap-title">
      <div>
        <p class="eyebrow">LOCAL OPERATOR</p>
        <h2 id="bootstrap-title">Connect this browser</h2>
        <p class="muted">Enter the one-time code printed by <code>furypipe gateway start</code>. The code is exchanged by POST and is never placed in the URL.</p>
      </div>
      <form id="bootstrap-form" class="bootstrap-form">
        <label for="bootstrap-code">One-time bootstrap code</label>
        <div class="input-row">
          <input id="bootstrap-code" name="code" type="password" autocomplete="off" spellcheck="false" required>
          <button type="submit">Connect</button>
        </div>
        <p id="bootstrap-status" class="status" role="status" aria-live="polite"></p>
      </form>
    </section>

    <section id="chat-panel" class="workspace" hidden>
      <aside class="panel sidebar" aria-label="Conversation status">
        <div>
          <p class="eyebrow">CONVERSATION</p>
          <p id="conversation-id" class="mono muted">Not opened</p>
        </div>
        <div class="actions">
          <button id="new-conversation" type="button" class="secondary">New conversation</button>
          <button id="reconnect" type="button" class="secondary">Reconnect</button>
          <button id="logout" type="button" class="danger">Logout</button>
        </div>
        <div>
          <p class="eyebrow">AUTHORITY STATES</p>
          <ul class="state-legend">
            <li><span class="badge accepted">Accepted</span> message/state accepted</li>
            <li><span class="badge response">Model response</span> provider output</li>
            <li><span class="badge requested">Tool requested</span> request only</li>
            <li><span class="badge eligible">Tool eligible</span> admission only</li>
            <li><span class="badge executed">Tool executed</span> execution receipt</li>
            <li><span class="badge succeeded">Tool succeeded</span> successful return</li>
            <li><span class="badge verified">Evidence verified</span> verification evidence</li>
            <li><span class="badge blocked">Blocked</span> denied / approval required</li>
          </ul>
        </div>
      </aside>

      <section class="panel chat" aria-label="Chat">
        <div id="messages" class="messages" aria-live="polite" aria-label="Conversation messages">
          <div class="empty-state">
            <strong>Fury Kernel is ready.</strong>
            <span>Conversation state, provider inference, and tool execution remain separate governed lifecycles.</span>
          </div>
        </div>
        <form id="message-form" class="composer">
          <label for="message-input" class="sr-only">Message</label>
          <textarea id="message-input" rows="3" maxlength="32768" placeholder="Message FuryPipe…" required></textarea>
          <div class="composer-actions">
            <span id="turn-status" class="status" role="status" aria-live="polite"></span>
            <button id="cancel-turn" class="secondary" type="button" disabled>Cancel turn</button>
            <button id="send-message" type="submit">Send</button>
          </div>
        </form>
      </section>

      <aside class="panel activity" aria-label="Governance activity">
        <div class="activity-title">
          <div>
            <p class="eyebrow">GOVERNANCE</p>
            <h2>Activity</h2>
          </div>
          <button id="clear-activity" type="button" class="secondary compact">Clear</button>
        </div>
        <ol id="activity-list" class="activity-list"></ol>
      </aside>

      <section id="tools-panel" class="panel tools" aria-labelledby="tools-title" hidden>
        <div class="tools-head">
          <div>
            <p class="eyebrow">GOVERNED MCP</p>
            <h2 id="tools-title">Tools</h2>
            <p class="muted">Inventory, proposal, approval and execution are separate steps. Tool output is never inserted into chat automatically.</p>
          </div>
          <span id="tool-source-count" class="badge">0 sources</span>
        </div>
        <div class="tools-grid">
          <div class="tool-control">
            <label for="tool-source">Source</label>
            <select id="tool-source" disabled>
              <option value="">No source loaded</option>
            </select>
          </div>
          <div class="tool-control">
            <label for="tool-name">Tool</label>
            <select id="tool-name" disabled>
              <option value="">Refresh inventory first</option>
            </select>
          </div>
          <div class="tool-actions">
            <button id="tool-refresh" type="button" class="secondary" disabled>Refresh inventory</button>
          </div>
        </div>
        <div class="tool-control tool-arguments">
          <label for="tool-arguments">Arguments (JSON)</label>
          <textarea id="tool-arguments" rows="5" spellcheck="false">{}</textarea>
        </div>
        <div class="tool-actions tool-lifecycle-actions">
          <button id="tool-propose" type="button" disabled>Propose</button>
          <button id="tool-approve" type="button" class="secondary" disabled>Approve</button>
          <button id="tool-execute" type="button" class="secondary" disabled>Execute</button>
          <button id="tool-discard" type="button" class="danger" disabled>Discard</button>
          <span id="tool-status" class="status" role="status" aria-live="polite"></span>
        </div>
        <div class="tool-result-wrap">
          <p class="eyebrow">TOOL RESULT</p>
          <pre id="tool-result" class="tool-result" tabindex="0">No tool result.</pre>
        </div>
      </section>
    </section>
  </main>
  <script src="/gateway/webchat/app.js" defer></script>
</body>
</html>
`;

const CSS = `:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #090b10;
  color: #eef2ff;
  --panel: #11151d;
  --panel-2: #171c26;
  --border: #2a3240;
  --muted: #9aa7b8;
  --accent: #ffb02e;
  --accent-strong: #ffc55f;
  --danger: #ff6b6b;
  --ok: #56d69b;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 20% 0%, #1b2230 0, #090b10 36rem); }
button, input, textarea, select { font: inherit; }
button {
  border: 1px solid #6d4b10;
  background: var(--accent);
  color: #161006;
  font-weight: 800;
  border-radius: .75rem;
  padding: .7rem 1rem;
  cursor: pointer;
}
button:hover { background: var(--accent-strong); }
button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 3px solid #ffd98b; outline-offset: 2px; }
button:disabled { opacity: .45; cursor: not-allowed; }
button.secondary { background: #202735; color: #e6edf7; border-color: #354155; }
button.danger { background: #2a171a; color: #ffb3b3; border-color: #653138; }
button.compact { padding: .4rem .65rem; font-size: .8rem; }
code, .mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
.shell { width: min(1600px, 100%); margin: 0 auto; padding: 1.25rem; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .75rem .25rem 1.25rem; }
h1, h2, p { margin-top: 0; }
h1 { margin-bottom: 0; font-size: clamp(1.65rem, 3vw, 2.5rem); }
h2 { margin-bottom: .45rem; font-size: 1.05rem; }
.eyebrow { color: var(--accent); font-size: .72rem; font-weight: 900; letter-spacing: .14em; margin-bottom: .35rem; }
.muted { color: var(--muted); }
.connection { display: inline-flex; align-items: center; gap: .55rem; color: var(--muted); }
.dot { width: .65rem; height: .65rem; border-radius: 50%; background: #657184; box-shadow: 0 0 0 .25rem rgba(101,113,132,.13); }
.dot.online { background: var(--ok); box-shadow: 0 0 0 .25rem rgba(86,214,155,.13); }
.panel { background: rgba(17,21,29,.96); border: 1px solid var(--border); border-radius: 1rem; box-shadow: 0 1rem 4rem rgba(0,0,0,.22); }
.auth-panel { display: grid; grid-template-columns: minmax(0,1fr) minmax(20rem,.8fr); gap: 2rem; padding: 2rem; max-width: 70rem; margin: 10vh auto 0; }
.bootstrap-form label { display: block; font-weight: 750; margin-bottom: .55rem; }
.input-row { display: flex; gap: .65rem; }
input, textarea, select { width: 100%; border: 1px solid #394559; background: #0b0f16; color: #f5f7fb; border-radius: .75rem; padding: .8rem .9rem; }
textarea { resize: vertical; min-height: 5.5rem; max-height: 18rem; }
.status { color: var(--muted); min-height: 1.2em; font-size: .85rem; }
.workspace { display: grid; grid-template-columns: 17rem minmax(0,1fr) 19rem; gap: 1rem; min-height: calc(100vh - 7rem); }
.sidebar, .activity { padding: 1rem; align-self: stretch; }
.sidebar { display: flex; flex-direction: column; justify-content: space-between; gap: 2rem; }
.actions { display: grid; gap: .6rem; }
.state-legend { list-style: none; padding: 0; margin: 0; display: grid; gap: .65rem; color: var(--muted); font-size: .78rem; }
.badge { display: inline-block; min-width: 6.8rem; margin-right: .35rem; border: 1px solid #364256; border-radius: 999px; padding: .2rem .45rem; color: #dce5f3; text-align: center; }
.badge.accepted, .badge.succeeded, .badge.verified { border-color: #286c50; color: #8de2bc; }
.badge.response, .badge.eligible { border-color: #75531c; color: #ffd180; }
.badge.requested, .badge.executed { border-color: #415b82; color: #a9c8ff; }
.badge.blocked { border-color: #733b42; color: #ffb0b7; }
.chat { display: grid; grid-template-rows: minmax(0,1fr) auto; min-height: 38rem; overflow: hidden; }
.messages { padding: 1rem; overflow-y: auto; display: flex; flex-direction: column; gap: .85rem; }
.empty-state { margin: auto; display: grid; gap: .35rem; max-width: 34rem; text-align: center; color: var(--muted); }
.message { max-width: min(48rem,88%); padding: .8rem .95rem; border-radius: 1rem; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--border); background: var(--panel-2); }
.message.user { align-self: flex-end; background: #2a2112; border-color: #56431f; }
.message.assistant { align-self: flex-start; background: #121d2b; border-color: #263e5b; }
.message .role { display: block; font-size: .7rem; font-weight: 900; color: var(--muted); letter-spacing: .08em; margin-bottom: .3rem; }
.composer { border-top: 1px solid var(--border); padding: 1rem; background: #0e1219; }
.composer-actions { display: flex; gap: .6rem; align-items: center; justify-content: flex-end; margin-top: .65rem; }
.composer-actions .status { margin-right: auto; }
.activity-title { display: flex; justify-content: space-between; gap: .5rem; align-items: flex-start; }
.activity-list { margin: .75rem 0 0; padding-left: 1.35rem; display: grid; gap: .7rem; font-size: .78rem; color: var(--muted); }
.activity-list li strong { display: block; color: #dce5f3; margin-bottom: .15rem; }
.tools { grid-column: 1 / -1; padding: 1rem; display: grid; gap: 1rem; }
.tools-head { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
.tools-head .muted { max-width: 60rem; margin-bottom: 0; }
.tools-grid { display: grid; grid-template-columns: minmax(12rem,.8fr) minmax(12rem,1fr) auto; gap: .75rem; align-items: end; }
.tool-control { display: grid; gap: .4rem; }
.tool-control label { font-weight: 750; font-size: .82rem; color: #dce5f3; }
.tool-actions { display: flex; gap: .55rem; flex-wrap: wrap; align-items: center; }
.tool-lifecycle-actions .status { margin-left: .35rem; }
.tool-result-wrap { border-top: 1px solid var(--border); padding-top: .85rem; }
.tool-result { margin: 0; min-height: 4rem; max-height: 18rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid #293447; background: #090d13; color: #cbd7e7; border-radius: .75rem; padding: .8rem; font-size: .78rem; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
@media (max-width: 1100px) {
  .workspace { grid-template-columns: 15rem minmax(0,1fr); }
  .activity { grid-column: 1 / -1; min-height: auto; }
  .activity-list { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .tools-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .tools-grid .tool-actions { grid-column: 1 / -1; }
}
@media (max-width: 760px) {
  .shell { padding: .75rem; }
  .topbar { align-items: flex-start; }
  .auth-panel { grid-template-columns: 1fr; margin-top: 3vh; padding: 1.25rem; }
  .input-row { flex-direction: column; }
  .workspace { grid-template-columns: 1fr; min-height: auto; }
  .sidebar { order: 2; }
  .chat { order: 1; min-height: 70vh; }
  .activity { order: 3; grid-column: auto; }
  .tools { order: 4; grid-column: auto; }
  .tools-grid { grid-template-columns: 1fr; }
  .tools-grid .tool-actions { grid-column: auto; }
  .activity-list { grid-template-columns: 1fr; }
  .message { max-width: 96%; }
  .composer-actions { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
`;

const JS = `(() => {
  'use strict';

  const BOOTSTRAP_FORMAT = 'furypipe-gateway-local-bootstrap/v1';
  const MESSAGE_FORMAT = 'furypipe-gateway-message/v1';
  const SUBPROTOCOL = 'furypipe.gateway.v1';

  const state = {
    ws: null,
    connectionId: null,
    sequence: 1,
    conversationId: null,
    activeTurnId: null,
    authenticated: false,
    reconnectAttempts: 0,
    reconnectTimer: null,
    openAfterClose: false,
    pendingUserMessages: new Map(),
    modelBridgeEnabled: false,
    modelProvider: null,
    model: null,
    toolBridgeEnabled: false,
    toolSourceCount: 0,
    toolSources: [],
    toolInventory: [],
    toolProposalId: null,
    toolProposalTransport: null,
    toolProposalStatus: null,
  };

  const byId = (id) => document.getElementById(id);
  const bootstrapPanel = byId('bootstrap-panel');
  const chatPanel = byId('chat-panel');
  const bootstrapForm = byId('bootstrap-form');
  const bootstrapCode = byId('bootstrap-code');
  const bootstrapStatus = byId('bootstrap-status');
  const connectionDot = byId('connection-dot');
  const connectionLabel = byId('connection-label');
  const conversationLabel = byId('conversation-id');
  const messages = byId('messages');
  const messageForm = byId('message-form');
  const messageInput = byId('message-input');
  const turnStatus = byId('turn-status');
  const cancelTurn = byId('cancel-turn');
  const activityList = byId('activity-list');
  const toolsPanel = byId('tools-panel');
  const toolSourceCount = byId('tool-source-count');
  const toolSource = byId('tool-source');
  const toolName = byId('tool-name');
  const toolArguments = byId('tool-arguments');
  const toolRefresh = byId('tool-refresh');
  const toolPropose = byId('tool-propose');
  const toolApprove = byId('tool-approve');
  const toolExecute = byId('tool-execute');
  const toolDiscard = byId('tool-discard');
  const toolStatus = byId('tool-status');
  const toolResult = byId('tool-result');

  const safeText = (value) => typeof value === 'string' ? value : '';

  function setConnection(online, label) {
    connectionDot.classList.toggle('online', online);
    connectionLabel.textContent = label;
  }

  function addActivity(title, detail, kind) {
    const item = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = title;
    const span = document.createElement('span');
    span.textContent = detail;
    if (kind) item.dataset.kind = kind;
    item.append(strong, span);
    activityList.prepend(item);
    while (activityList.children.length > 80) {
      activityList.lastElementChild?.remove();
    }
  }

  function clearMessages() {
    messages.replaceChildren();
  }

  function renderMessage(role, content) {
    const article = document.createElement('article');
    article.className = 'message ' + (role === 'assistant' ? 'assistant' : 'user');
    const label = document.createElement('span');
    label.className = 'role';
    label.textContent = role === 'assistant' ? 'FURYPIPE' : 'YOU';
    const body = document.createElement('span');
    body.textContent = safeText(content);
    article.append(label, body);
    messages.append(article);
    messages.scrollTop = messages.scrollHeight;
  }

  function socketUrl() {
    const url = new URL('/gateway/v1', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }

  function makeMessageId(prefix) {
    const suffix = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : String(Date.now()) + '-' + String(Math.floor(Math.random() * 1000000));
    return prefix + '-' + suffix;
  }

  function sendCommand(commandName, input, declaredPluginPermissions = []) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.connectionId) {
      throw new Error('Gateway WebSocket is not connected');
    }
    const message = {
      format: MESSAGE_FORMAT,
      messageId: makeMessageId('webchat'),
      connectionId: state.connectionId,
      sequence: state.sequence,
      type: 'command',
      sentAt: Date.now(),
      payload: {
        commandName,
        declaredPluginPermissions,
        input,
      },
    };
    state.sequence += 1;
    state.ws.send(JSON.stringify(message));
    return message.messageId;
  }

  function inspectConversation() {
    if (!state.conversationId) return;
    sendCommand('conversation.inspect', {
      conversationId: state.conversationId,
      messageOffset: 0,
      messageLimit: 32,
      turnOffset: 0,
      turnLimit: 32,
    });
  }

  function toolPermission(transport) {
    return transport === 'stdio'
      ? ['process']
      : transport === 'streamable_http'
        ? ['network']
        : [];
  }

  function toolCommand(base, transport) {
    if (transport === 'stdio') return base + '.stdio';
    if (transport === 'streamable_http') return base + '.http';
    throw new Error('Tool source transport is unavailable');
  }

  function selectedToolSource() {
    const sourceId = safeText(toolSource.value);
    return state.toolSources.find((source) => source.sourceId === sourceId) || null;
  }

  function resetToolProposal() {
    state.toolProposalId = null;
    state.toolProposalTransport = null;
    state.toolProposalStatus = null;
    toolApprove.disabled = true;
    toolExecute.disabled = true;
    toolDiscard.disabled = true;
  }

  function resetToolInventory() {
    state.toolInventory = [];
    toolName.replaceChildren();
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Refresh inventory first';
    toolName.append(option);
    toolName.disabled = true;
    toolPropose.disabled = true;
    resetToolProposal();
  }

  function renderToolSources(sources) {
    state.toolSources = Array.isArray(sources)
      ? sources.filter((source) =>
          source
          && typeof source.sourceId === 'string'
          && (source.transport === 'stdio' || source.transport === 'streamable_http'))
      : [];
    toolSource.replaceChildren();
    if (state.toolSources.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No configured source';
      toolSource.append(option);
      toolSource.disabled = true;
      toolRefresh.disabled = true;
    } else {
      for (const source of state.toolSources) {
        const option = document.createElement('option');
        option.value = source.sourceId;
        option.textContent = source.sourceId + ' · ' + source.transport + ' · ' + safeText(source.trust);
        toolSource.append(option);
      }
      toolSource.disabled = false;
      toolRefresh.disabled = false;
    }
    toolSourceCount.textContent = String(state.toolSources.length) + ' source' + (state.toolSources.length === 1 ? '' : 's');
    resetToolInventory();
  }

  function renderToolInventory(payload) {
    const tools = Array.isArray(payload?.tools) ? payload.tools : [];
    state.toolInventory = tools.filter((tool) =>
      tool && typeof tool.name === 'string' && typeof tool.riskClass === 'string'
    );
    toolName.replaceChildren();
    if (state.toolInventory.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No listed tool';
      toolName.append(option);
      toolName.disabled = true;
      toolPropose.disabled = true;
    } else {
      for (const tool of state.toolInventory) {
        const option = document.createElement('option');
        option.value = tool.name;
        option.textContent = tool.name + ' · ' + tool.riskClass;
        toolName.append(option);
      }
      toolName.disabled = false;
      toolPropose.disabled = false;
    }
    resetToolProposal();
  }

  function renderToolExecution(payload) {
    const stateReceipt = payload?.state;
    const executed = stateReceipt?.executed;
    const succeeded = stateReceipt?.succeeded;
    const verified = stateReceipt?.verified === true;

    if (executed === true) addActivity('Tool executed', safeText(payload.toolName) || 'tool', 'executed');
    if (succeeded === true) addActivity('Tool succeeded', safeText(payload.toolName) || 'tool', 'succeeded');
    if (verified) addActivity('Evidence verified', safeText(payload.toolName) || 'tool', 'verified');
    else if (executed === true) addActivity('Unverified', 'Execution receipt is not verified evidence.', 'requested');

    if (payload?.displayResult?.available === true) {
      try {
        toolResult.textContent = JSON.stringify(payload.displayResult.value, null, 2);
      } catch {
        toolResult.textContent = 'Tool result could not be rendered.';
      }
    } else if (payload?.displayResult?.reason) {
      toolResult.textContent = 'Tool result withheld: ' + safeText(payload.displayResult.reason);
    } else if (payload?.status === 'outcome-unknown') {
      toolResult.textContent = 'Execution outcome is unknown. FuryPipe will not retry automatically.';
    } else {
      toolResult.textContent = 'No displayable tool result.';
    }

    const status = safeText(payload?.status) || 'unknown';
    toolStatus.textContent =
      'executed=' + String(executed)
      + ' · succeeded=' + String(succeeded)
      + ' · verified=' + String(verified)
      + ' · status=' + status;
    resetToolProposal();
  }

  function handleToolGatewayResult(message) {
    const adapter = message.result;
    if (!adapter || typeof adapter !== 'object') {
      toolStatus.textContent = 'Malformed tool result.';
      addActivity('Blocked', 'Malformed tool result.', 'blocked');
      return;
    }
    if (adapter.status !== 'ok') {
      const code = safeText(adapter.error?.code) || 'tool-command-rejected';
      toolStatus.textContent = code;
      addActivity('Blocked', code, 'blocked');
      return;
    }

    const payload = adapter.result;
    if (message.commandName === 'tools.sources.inspect') {
      renderToolSources(payload);
      addActivity('Accepted', 'Configured MCP source metadata loaded.', 'accepted');
      return;
    }
    if (
      message.commandName === 'tools.source.inspect.stdio'
      || message.commandName === 'tools.source.inspect.http'
    ) {
      renderToolInventory(payload);
      toolStatus.textContent = 'Inventory refreshed.';
      addActivity('Accepted', 'Fresh MCP inventory listed.', 'accepted');
      return;
    }
    if (
      message.commandName === 'tools.propose.stdio'
      || message.commandName === 'tools.propose.http'
    ) {
      const proposalStatus = safeText(payload?.status);
      if (proposalStatus === 'denied') {
        resetToolProposal();
        toolStatus.textContent = 'Policy denied this tool proposal.';
        addActivity('Blocked', safeText(payload?.policy?.reason) || 'policy-denied', 'blocked');
        return;
      }
      const proposalId = safeText(payload?.proposalId);
      const source = selectedToolSource();
      if (!proposalId || !source) {
        resetToolProposal();
        toolStatus.textContent = 'Proposal result is incomplete.';
        addActivity('Blocked', 'Proposal result is incomplete.', 'blocked');
        return;
      }
      state.toolProposalId = proposalId;
      state.toolProposalTransport = source.transport;
      state.toolProposalStatus = proposalStatus;
      toolDiscard.disabled = false;
      if (proposalStatus === 'approval-required') {
        toolApprove.disabled = false;
        toolExecute.disabled = true;
        toolStatus.textContent = 'Operator approval required.';
        addActivity('Tool requested', safeText(payload.toolName) || 'tool', 'requested');
        addActivity('Blocked', 'Explicit operator approval required.', 'blocked');
      } else if (proposalStatus === 'approved') {
        toolApprove.disabled = true;
        toolExecute.disabled = false;
        toolStatus.textContent = 'Approved by governed policy; execution remains separate.';
        addActivity('Tool requested', safeText(payload.toolName) || 'tool', 'requested');
        addActivity('Tool approved', 'governed_policy', 'eligible');
      }
      return;
    }
    if (message.commandName === 'tools.approve') {
      state.toolProposalStatus = 'approved';
      toolApprove.disabled = true;
      toolExecute.disabled = false;
      toolDiscard.disabled = false;
      toolStatus.textContent = 'Operator approval recorded. Execute remains a separate action.';
      addActivity('Tool approved', 'operator', 'eligible');
      return;
    }
    if (
      message.commandName === 'tools.execute.stdio'
      || message.commandName === 'tools.execute.http'
    ) {
      renderToolExecution(payload);
      return;
    }
    if (message.commandName === 'tools.discard') {
      const discarded = payload?.discarded === true;
      resetToolProposal();
      toolStatus.textContent = discarded ? 'Proposal discarded.' : 'Proposal was already absent.';
      addActivity('Blocked', discarded ? 'Tool proposal discarded.' : 'Tool proposal unavailable.', 'blocked');
    }
  }

  function scheduleReconnect() {
    if (!state.authenticated || state.reconnectTimer || state.reconnectAttempts >= 5) return;
    const delay = Math.min(5000, 500 * Math.pow(2, state.reconnectAttempts));
    state.reconnectAttempts += 1;
    setConnection(false, 'Reconnecting…');
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      connectWebSocket();
    }, delay);
  }

  function handleStateResult(message) {
    const adapter = message.result;
    if (!adapter || typeof adapter !== 'object') {
      addActivity('Blocked', 'Malformed state result.', 'blocked');
      return;
    }
    if (adapter.status !== 'ok') {
      const code = adapter.error && typeof adapter.error === 'object'
        ? safeText(adapter.error.code)
        : 'state-command-rejected';
      if (message.commandName === 'conversation.message.submit') {
        state.pendingUserMessages.delete(message.messageId);
      }
      if (message.commandName === 'conversation.close') {
        state.openAfterClose = false;
      }
      addActivity('Blocked', code || 'State command rejected.', 'blocked');
      turnStatus.textContent = code || 'State command rejected.';
      return;
    }

    const payload = adapter.result;
    if (message.commandName === 'conversation.open') {
      state.conversationId = payload?.conversationId ?? null;
      conversationLabel.textContent = state.conversationId || 'Not opened';
      clearMessages();
      addActivity('Accepted', 'Conversation opened by Fury Kernel.', 'accepted');
      return;
    }
    if (message.commandName === 'conversation.inspect') {
      if (!payload || !Array.isArray(payload.messages)) return;
      clearMessages();
      for (const item of payload.messages) {
        if (item && (item.role === 'user' || item.role === 'assistant')) {
          renderMessage(item.role, item.content);
        }
      }
      state.activeTurnId = typeof payload.activeTurnId === 'string' ? payload.activeTurnId : null;
      cancelTurn.disabled = !state.activeTurnId;
      turnStatus.textContent = state.activeTurnId ? 'Turn pending' : '';
      addActivity('Accepted', 'Conversation state resynchronized.', 'accepted');
      return;
    }
    if (message.commandName === 'conversation.message.submit') {
      const pending = state.pendingUserMessages.get(message.messageId);
      state.pendingUserMessages.delete(message.messageId);
      if (pending) renderMessage('user', pending);
      state.activeTurnId = payload?.turn?.turnId ?? null;
      cancelTurn.disabled = !state.activeTurnId;
      addActivity('Accepted', 'User turn accepted. Provider inference is still a separate command.', 'accepted');
      if (state.activeTurnId && state.modelBridgeEnabled) {
        turnStatus.textContent = 'Requesting governed model execution…';
        addActivity(
          'Model requested',
          (state.modelProvider || 'provider') + ' / ' + (state.model || 'model'),
          'requested',
        );
        sendCommand(
          'conversation.model.execute',
          {
            conversationId: state.conversationId,
            turnId: state.activeTurnId,
          },
          ['provider-inference'],
        );
      } else {
        turnStatus.textContent = state.activeTurnId
          ? 'Turn accepted — model bridge not configured'
          : '';
      }
      return;
    }
    if (message.commandName === 'conversation.cancel') {
      state.activeTurnId = null;
      cancelTurn.disabled = true;
      turnStatus.textContent = 'Turn cancelled';
      addActivity('Blocked', 'Turn cancelled before model/tool execution.', 'blocked');
      return;
    }
    if (message.commandName === 'conversation.close') {
      state.conversationId = null;
      state.activeTurnId = null;
      conversationLabel.textContent = 'Not opened';
      cancelTurn.disabled = true;
      clearMessages();
      addActivity('Accepted', 'Conversation closed and Kernel capacity reclaimed.', 'accepted');
      if (state.openAfterClose) {
        state.openAfterClose = false;
        sendCommand('conversation.open', {});
      }
    }
  }

  function handleSocketMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      addActivity('Blocked', 'Invalid Gateway server message.', 'blocked');
      return;
    }

    if (message.type === 'connected') {
      state.connectionId = safeText(message.connectionId);
      state.sequence = 1;
      state.reconnectAttempts = 0;
      setConnection(true, 'Connected');
      addActivity('Accepted', 'Authenticated local Gateway transport connected.', 'accepted');
      if (state.conversationId) inspectConversation();
      else sendCommand('conversation.open', {});
      return;
    }

    if (message.type === 'command-admission') {
      const admission = message.admission;
      const commandName = safeText(admission?.commandName);
      if (admission?.outcome === 'eligible') {
        addActivity(
          commandName === 'conversation.model.execute' ? 'Model eligible' : 'State eligible',
          commandName || 'Command admitted.',
          'eligible',
        );
      } else {
        const reason = safeText(admission?.reason) || 'command denied';
        addActivity('Blocked', reason, 'blocked');
        turnStatus.textContent = reason;
        if (
          commandName === 'conversation.model.execute'
          && state.conversationId
          && state.activeTurnId
        ) {
          sendCommand('conversation.cancel', {
            conversationId: state.conversationId,
            turnId: state.activeTurnId,
          });
        }
      }
      return;
    }

    if (message.type === 'state-command-result') {
      handleStateResult(message);
      return;
    }

    if (message.type === 'execution-command-result') {
      const result = message.result;
      if (!result || typeof result !== 'object') {
        addActivity('Blocked', 'Malformed model execution result.', 'blocked');
        return;
      }
      if (result.status === 'completed') {
        const provider = result.provider && typeof result.provider === 'object'
          ? safeText(result.provider.providerId) + ' / ' + safeText(result.provider.model)
          : 'provider response';
        addActivity('Model response', provider, 'response');
        turnStatus.textContent = 'Model response received — resynchronizing…';
        inspectConversation();
      } else if (result.status === 'cancelled') {
        addActivity('Blocked', 'Model execution cancelled.', 'blocked');
        turnStatus.textContent = 'Turn cancelled';
        inspectConversation();
      } else {
        const code = safeText(result.failureCode)
          || safeText(result.error?.code)
          || 'model-execution-failed';
        addActivity('Blocked', code, 'blocked');
        turnStatus.textContent = code;
        inspectConversation();
      }
      return;
    }

    if (message.type === 'error') {
      addActivity('Blocked', safeText(message.code) || 'Gateway protocol error.', 'blocked');
    }
  }

  async function loadWebChatConfig() {
    try {
      const response = await fetch('/gateway/webchat/config.json', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) return;
      const config = await response.json();
      const modelBridge = config?.modelBridge;
      state.modelBridgeEnabled = modelBridge?.enabled === true;
      state.modelProvider = state.modelBridgeEnabled ? safeText(modelBridge.providerId) : null;
      state.model = state.modelBridgeEnabled ? safeText(modelBridge.model) : null;
    } catch {
      state.modelBridgeEnabled = false;
      state.modelProvider = null;
      state.model = null;
    }
  }

  function connectWebSocket() {
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;
    const ws = new WebSocket(socketUrl(), SUBPROTOCOL);
    state.ws = ws;
    setConnection(false, 'Connecting…');

    ws.addEventListener('open', () => {
      state.authenticated = true;
      bootstrapPanel.hidden = true;
      chatPanel.hidden = false;
    });
    ws.addEventListener('message', handleSocketMessage);
    ws.addEventListener('close', () => {
      if (state.ws !== ws) return;
      state.ws = null;
      state.connectionId = null;
      setConnection(false, 'Disconnected');
      if (state.authenticated) scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      setConnection(false, 'Connection failed');
    });
  }

  bootstrapForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = bootstrapCode.value.trim();
    if (!code) return;
    bootstrapStatus.textContent = 'Exchanging one-time code…';
    try {
      const response = await fetch('/gateway/local-bootstrap/v1', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: BOOTSTRAP_FORMAT, code }),
      });
      bootstrapCode.value = '';
      if (response.status !== 204) {
        bootstrapStatus.textContent = response.status === 401
          ? 'Code invalid or expired.'
          : 'Bootstrap rejected (HTTP ' + response.status + ').';
        return;
      }
      bootstrapStatus.textContent = 'Browser session established.';
      state.authenticated = true;
      await webChatConfigReady;
      connectWebSocket();
    } catch {
      bootstrapStatus.textContent = 'Bootstrap request failed.';
    }
  });

  messageForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state.conversationId || state.activeTurnId) return;
    const content = messageInput.value;
    if (!content.trim()) return;
    const messageId = makeMessageId('user');
    messageInput.value = '';
    turnStatus.textContent = 'Submitting…';
    try {
      const transportMessageId = sendCommand('conversation.message.submit', {
        conversationId: state.conversationId,
        messageId,
        content,
      });
      state.pendingUserMessages.set(transportMessageId, content);
    } catch {
      turnStatus.textContent = 'Not connected';
      messageInput.value = content;
    }
  });

  cancelTurn.addEventListener('click', () => {
    if (!state.conversationId || !state.activeTurnId) return;
    sendCommand('conversation.cancel', {
      conversationId: state.conversationId,
      turnId: state.activeTurnId,
    });
  });

  byId('new-conversation').addEventListener('click', () => {
    if (state.activeTurnId) {
      turnStatus.textContent = 'Cancel the active turn first.';
      return;
    }
    if (state.conversationId) {
      state.openAfterClose = true;
      sendCommand('conversation.close', { conversationId: state.conversationId });
      return;
    }
    sendCommand('conversation.open', {});
  });

  byId('reconnect').addEventListener('click', () => {
    state.reconnectAttempts = 0;
    if (state.ws) state.ws.close(1000, 'manual-reconnect');
    connectWebSocket();
  });

  byId('logout').addEventListener('click', async () => {
    state.authenticated = false;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.ws) state.ws.close(1000, 'logout');
    await fetch('/gateway/local-logout/v1', {
      method: 'POST',
      credentials: 'same-origin',
    }).catch(() => undefined);
    state.conversationId = null;
    state.activeTurnId = null;
    state.pendingUserMessages.clear();
    state.openAfterClose = false;
    clearMessages();
    chatPanel.hidden = true;
    bootstrapPanel.hidden = false;
    bootstrapStatus.textContent = 'Logged out.';
    setConnection(false, 'Not connected');
  });

  byId('clear-activity').addEventListener('click', () => {
    activityList.replaceChildren();
  });

  const webChatConfigReady = loadWebChatConfig();
})();
`;

function isLoopback(address: string | undefined): boolean {
  const value = address?.trim().toLowerCase() ?? '';
  return value === '127.0.0.1'
    || value === '::1'
    || value === '::ffff:127.0.0.1';
}

function normalizeOrigin(value: string): { readonly origin: string; readonly wsOrigin: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Gateway WebChat origin is invalid');
  }
  if (
    url.protocol !== 'http:'
    || url.username !== ''
    || url.password !== ''
    || url.pathname !== '/'
    || url.search !== ''
    || url.hash !== ''
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname === '::1' ? '[::1]' : url.hostname)
  ) {
    throw new Error('Gateway WebChat requires an exact loopback HTTP origin');
  }
  const ws = new URL(url.origin);
  ws.protocol = 'ws:';
  return Object.freeze({ origin: url.origin, wsOrigin: ws.origin });
}

function pathOf(request: IncomingMessage): { readonly pathname: string; readonly clean: boolean } | undefined {
  if (typeof request.url !== 'string') return undefined;
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    return Object.freeze({
      pathname: url.pathname,
      clean: url.search === '' && url.hash === '',
    });
  } catch {
    return undefined;
  }
}

function commonHeaders(
  response: ServerResponse,
  csp: string,
): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  response.setHeader('Content-Security-Policy', csp);
}

function send(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string,
  csp: string,
): void {
  if (response.writableEnded) return;
  const bytes = Buffer.from(body, 'utf8');
  commonHeaders(response, csp);
  response.statusCode = status;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Length', String(bytes.byteLength));
  if (request.method === 'HEAD') response.end();
  else response.end(bytes);
}

export function createFuryGatewayWebChatHandler(
  options: FuryGatewayWebChatOptions,
): FuryGatewayWebSocketHttpRequestHandler {
  if (!options || typeof options !== 'object' || typeof options.origin !== 'string') {
    throw new Error('Gateway WebChat requires an exact local origin');
  }
  const local = normalizeOrigin(options.origin);
  const modelBridgeEnabled = options.modelBridgeEnabled === true;
  if (modelBridgeEnabled) {
    if (
      options.modelProvider !== 'openai'
      && options.modelProvider !== 'anthropic'
      && options.modelProvider !== 'google'
    ) {
      throw new Error('Gateway WebChat model provider is invalid');
    }
    if (
      typeof options.model !== 'string'
      || options.model.length < 1
      || options.model.length > 256
      || options.model.trim() !== options.model
      || /[\u0000-\u001f\u007f]/u.test(options.model)
    ) {
      throw new Error('Gateway WebChat model identifier is invalid');
    }
  } else if (options.modelProvider !== undefined || options.model !== undefined) {
    throw new Error('Gateway WebChat disabled model bridge must not expose model metadata');
  }
  const webChatConfig = JSON.stringify(Object.freeze({
    format: FURY_GATEWAY_WEBCHAT_CONFIG_FORMAT,
    modelBridge: modelBridgeEnabled
      ? Object.freeze({
          enabled: true as const,
          providerId: options.modelProvider!,
          model: options.model!,
        })
      : Object.freeze({ enabled: false as const }),
    executionAuthority: false as const,
  }));
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self' " + local.wsOrigin,
    "img-src 'self'",
    "font-src 'none'",
    "object-src 'none'",
  ].join('; ');

  return async (request, response): Promise<boolean> => {
    const parsed = pathOf(request);
    if (!parsed) return false;
    if (parsed.pathname === '/gateway/webchat') {
      if (!parsed.clean) {
        send(request, response, 400, 'text/plain; charset=utf-8', '', csp);
        return true;
      }
      if (!isLoopback(request.socket.remoteAddress)) {
        send(request, response, 403, 'text/plain; charset=utf-8', '', csp);
        return true;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD');
        send(request, response, 405, 'text/plain; charset=utf-8', '', csp);
        return true;
      }
      commonHeaders(response, csp);
      response.statusCode = 308;
      response.setHeader('Location', FURY_GATEWAY_WEBCHAT_PATH);
      response.setHeader('Content-Length', '0');
      response.end();
      return true;
    }

    if (
      parsed.pathname !== FURY_GATEWAY_WEBCHAT_PATH
      && parsed.pathname !== FURY_GATEWAY_WEBCHAT_SCRIPT_PATH
      && parsed.pathname !== FURY_GATEWAY_WEBCHAT_STYLE_PATH
      && parsed.pathname !== FURY_GATEWAY_WEBCHAT_CONFIG_PATH
    ) {
      return false;
    }
    if (!parsed.clean) {
      send(request, response, 400, 'text/plain; charset=utf-8', '', csp);
      return true;
    }
    if (!isLoopback(request.socket.remoteAddress)) {
      send(request, response, 403, 'text/plain; charset=utf-8', '', csp);
      return true;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      send(request, response, 405, 'text/plain; charset=utf-8', '', csp);
      return true;
    }

    if (parsed.pathname === FURY_GATEWAY_WEBCHAT_PATH) {
      send(request, response, 200, 'text/html; charset=utf-8', HTML, csp);
    } else if (parsed.pathname === FURY_GATEWAY_WEBCHAT_SCRIPT_PATH) {
      send(request, response, 200, 'text/javascript; charset=utf-8', JS, csp);
    } else if (parsed.pathname === FURY_GATEWAY_WEBCHAT_STYLE_PATH) {
      send(request, response, 200, 'text/css; charset=utf-8', CSS, csp);
    } else {
      send(
        request,
        response,
        200,
        'application/json; charset=utf-8',
        webChatConfig,
        csp,
      );
    }
    return true;
  };
}
