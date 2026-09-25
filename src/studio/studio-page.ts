// FuryPipe Studio — the product shell (Chat, Cowork, Code, Agents,
// Automations). The former dashboard remains available as
// Settings › Advanced › Control Plane (/control-plane).
//
// Security: served with a nonce-based CSP (no inline handlers, no external
// origins); every runtime value is inserted with textContent, never HTML.
import { randomBytes } from 'node:crypto';

export const STUDIO_EXAMPLE_IR = Object.freeze({
  format: 'furypipe-ir/v1',
  intent: 'Rework authentication, add tests, review security, update docs and check the UI.',
  must: ['keep the public login API stable'],
  mustNot: ['store plaintext passwords'],
  capabilities: { READ: 'ALLOW', WRITE: 'ALLOW', EXECUTE: 'ASK', NETWORK: 'DENY', EXTERNAL_ACTION: 'DENY' },
  privacy: 'local-first',
  budget: { maxCostUsd: 5, maxTokens: 500000, maxWallTimeMs: 3600000, maxAgents: 4, maxRetries: 2, maxCloudCalls: 50, maxToolCalls: 400 },
  successPredicates: [
    { id: 'tests', level: 'MUST', description: 'auth tests pass', evidence: [{ kind: 'TEST_RECEIPT', subject: 'test:auth' }] },
    { id: 'review', level: 'MUST', description: 'independent review accepted', evidence: [{ kind: 'AGENT_RECEIPT', subject: 'review:auth' }] },
  ],
  humanGates: [],
  tasks: [
    { id: 'plan', role: 'planner', description: 'Plan the change', dependsOn: [], capabilities: ['READ'], writeScopes: [] },
    { id: 'backend', role: 'implementer', description: 'Implement auth changes', dependsOn: ['plan'], capabilities: ['READ', 'WRITE'], writeScopes: ['src/auth/**'] },
    { id: 'tests', role: 'tester', description: 'Add auth tests', dependsOn: ['plan'], capabilities: ['READ', 'WRITE'], writeScopes: ['tests/auth/**'] },
    { id: 'docs', role: 'documenter', description: 'Update docs', dependsOn: ['plan'], capabilities: ['READ', 'WRITE'], writeScopes: ['docs/**'] },
    { id: 'review', role: 'reviewer', description: 'Independent review', dependsOn: ['backend', 'tests'], capabilities: ['READ'], writeScopes: [] },
    { id: 'security', role: 'security', description: 'Security review', dependsOn: ['backend'], capabilities: ['READ'], writeScopes: [] },
  ],
  rollbackPolicy: 'revert-worktree',
});

const CSS = `
:root{color-scheme:light dark;--bg:#f6f7f9;--panel:#fff;--ink:#14161a;--muted:#5b6270;--line:#dfe3ea;--accent:#c2410c;--accent-ink:#fff;--ok:#15803d;--warn:#a16207;--bad:#b91c1c;--focus:#2563eb;--radius:10px;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--panel:#171a21;--ink:#e8eaee;--muted:#9aa3b2;--line:#2a2f3a;--accent:#fb923c;--accent-ink:#1a0f07;--ok:#4ade80;--warn:#facc15;--bad:#f87171;--focus:#60a5fa}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink)}
a{color:inherit}:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.skip{position:absolute;left:-999px;top:0;background:var(--panel);padding:8px 12px;z-index:10}.skip:focus{left:8px}
.app{display:grid;grid-template-columns:232px 1fr;min-height:100vh}
nav.side{border-right:1px solid var(--line);background:var(--panel);padding:16px 12px;display:flex;flex-direction:column;gap:18px}
.brand{font-weight:700;font-size:17px;letter-spacing:.2px;padding:0 8px}.brand span{color:var(--accent)}
nav.side h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 8px 6px}
nav.side ul{list-style:none;margin:0;padding:0;display:grid;gap:2px}
nav.side a{display:block;text-decoration:none;padding:7px 10px;border-radius:8px;color:var(--ink)}
nav.side a:hover{background:color-mix(in srgb,var(--accent) 10%,transparent)}
nav.side a[aria-current=page]{background:color-mix(in srgb,var(--accent) 18%,transparent);font-weight:600}
header.top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 24px;border-bottom:1px solid var(--line);background:var(--panel)}
.chip{border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:12px;color:var(--muted)}.chip b{color:var(--ink);font-weight:600}
.chip.local b{color:var(--ok)}.chip.cloud b{color:var(--warn)}
main{padding:24px;max-width:1180px}
main h1{font-size:22px;margin:0 0 4px}.lead{color:var(--muted);margin:0 0 18px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:16px;margin-bottom:16px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:12px}
.badge{display:inline-block;border-radius:6px;padding:0 7px;font-size:12px;font-weight:600;border:1px solid currentColor}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.muted{color:var(--muted)}
button,select,textarea,input{font:inherit;color:inherit}
button{background:var(--accent);color:var(--accent-ink);border:0;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer}
button[disabled]{opacity:.55;cursor:not-allowed}button.secondary{background:transparent;color:var(--ink);border:1px solid var(--line)}
select,input,textarea{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:7px 10px}
textarea{width:100%;min-height:90px;resize:vertical}textarea.code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;min-height:260px}
label{display:block;font-weight:600;font-size:13px;margin:0 0 4px}.row{display:flex;flex-wrap:wrap;gap:10px;align-items:end}
.log{display:grid;gap:10px;max-height:52vh;overflow:auto;padding:4px}
.msg{padding:10px 12px;border-radius:10px;border:1px solid var(--line);white-space:pre-wrap}.msg.user{background:color-mix(in srgb,var(--accent) 8%,var(--panel))}
.msg .who{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);display:block;margin-bottom:2px}
.empty{border:1px dashed var(--line);border-radius:var(--radius);padding:18px;color:var(--muted)}
.status{min-height:1.5em}ul.reasons{margin:6px 0 0;padding-left:18px}
@media (max-width:760px){.app{grid-template-columns:1fr}nav.side{border-right:0;border-bottom:1px solid var(--line)}nav.side ul{grid-template-columns:repeat(3,1fr)}main{padding:16px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

const SCRIPT = String.raw`
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'text') n.textContent = v; else if (k === 'class') n.className = v; else n.setAttribute(k, v); } for (const k of kids) n.append(k); return n; };
  const views = ['chat','cowork','code','agents','automations','models','runtimes','settings'];
  const state = { local: null, harnesses: null, model: null, history: [] };
  async function getJson(url, init) {
    const res = await fetch(url, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body && body.error && body.error.message) || ('HTTP ' + res.status));
    return body;
  }
  function badge(text, cls) { return el('span', { class: 'badge ' + cls, text }); }
  function setIndicators(runtime, provider, model, locality) {
    $('#ind-runtime b').textContent = runtime; $('#ind-provider b').textContent = provider; $('#ind-model b').textContent = model;
    const loc = $('#ind-locality'); loc.className = 'chip ' + (locality === 'local' ? 'local' : locality === 'cloud' ? 'cloud' : ''); $('#ind-locality b').textContent = locality;
  }
  let firstRoute = true;
  function show(name) {
    if (!views.includes(name)) name = 'notfound';
    for (const s of document.querySelectorAll('main > section')) s.hidden = s.dataset.view !== name;
    for (const a of document.querySelectorAll('nav.side a[data-view]')) { if (a.dataset.view === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
    const h = document.querySelector('main > section[data-view="' + name + '"] h1');
    if (h) {
      h.setAttribute('tabindex', '-1'); document.title = h.textContent + ' · FuryPipe Studio';
      // Move focus to the new view's heading on in-app navigation only; on first
      // load keep the natural order so the skip link stays the first tab stop.
      if (!firstRoute) h.focus({ preventScroll: false });
    }
    firstRoute = false;
    if (name === 'chat' || name === 'models') loadLocal();
    if (name === 'runtimes') loadHarnesses();
    if (name === 'code') loadGraph();
  }
  function route() { show((location.hash.replace(/^#\/?/, '') || 'chat').split('/')[0]); }
  addEventListener('hashchange', route);

  async function loadLocal() {
    const target = $('#models-body'); const status = $('#models-status');
    status.textContent = 'Probing local inference servers…';
    try {
      state.local = await getJson('/api/studio/local.json');
      const hw = await getJson('/api/studio/hardware.json');
      $('#hw').textContent = hw.cpuCount + ' CPU · ' + Math.round(hw.totalMemoryBytes / 1073741824) + ' GiB RAM · ' + (hw.gpus.length ? hw.gpus.map(g => g.name + ' ' + Math.round(g.memoryBytes / 1073741824) + ' GiB').join(', ') : (hw.unifiedMemory ? 'unified memory' : 'no discrete GPU detected'));
      target.replaceChildren();
      let models = 0;
      for (const b of state.local.backends) {
        if (!b.reachable) { target.append(el('tr', {}, el('td', { text: b.kind }), el('td', { text: b.baseUrl }), el('td', {}, badge('offline', 'muted')), el('td', { text: '—' }), el('td', { text: '—' }))); continue; }
        if (!b.models.length) target.append(el('tr', {}, el('td', { text: b.kind }), el('td', { text: b.baseUrl }), el('td', {}, badge('up', 'ok')), el('td', { text: 'no models' }), el('td', { text: '—' })));
        for (const m of b.models) { models++; const cls = m.fit === 'FITS' ? 'ok' : m.fit === 'MAY_BE_SLOW' ? 'warn' : m.fit === 'DOES_NOT_FIT' ? 'bad' : 'muted';
          target.append(el('tr', {}, el('td', { text: b.kind }), el('td', { text: b.baseUrl }), el('td', {}, badge('up', 'ok')), el('td', { text: m.id + (m.parameterSize ? ' · ' + m.parameterSize : '') + (m.quantization ? ' · ' + m.quantization : '') }), el('td', {}, badge(m.fit, cls)))); }
      }
      status.textContent = models ? models + ' local model(s) found.' : 'No local model found. Start Ollama, LM Studio, llama.cpp, vLLM or SGLang on this machine.';
      fillModelPicker();
    } catch (e) { status.textContent = 'Local discovery failed: ' + e.message; }
  }
  function fillModelPicker() {
    const sel = $('#chat-model'); sel.replaceChildren();
    const opts = [];
    for (const b of (state.local && state.local.backends) || []) if (b.reachable) for (const m of b.models) if (m.modality !== 'embeddings') opts.push({ b, m });
    for (const { b, m } of opts) sel.append(el('option', { value: JSON.stringify({ kind: b.kind, baseUrl: b.baseUrl, model: m.id }), text: m.id + ' — ' + b.kind }));
    const empty = !opts.length;
    $('#chat-empty').hidden = !empty; $('#chat-form').hidden = empty;
    if (!empty) pickModel(); else setIndicators('FuryPipe Native', '—', '—', '—');
  }
  function pickModel() { const v = JSON.parse($('#chat-model').value); state.model = v; setIndicators('FuryPipe Native', v.kind, v.model, 'local'); }
  $('#chat-model').addEventListener('change', pickModel);
  $('#chat-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const input = $('#chat-input'); const text = input.value.trim(); if (!text || !state.model) return;
    input.value = ''; const log = $('#chat-log');
    state.history.push({ role: 'user', content: text });
    log.append(el('div', { class: 'msg user' }, el('span', { class: 'who', text: 'You' }), el('span', { text })));
    const out = el('span', { text: '' }); log.append(el('div', { class: 'msg' }, el('span', { class: 'who', text: state.model.model + ' · local' }), out));
    const btn = $('#chat-send'); btn.disabled = true; $('#chat-status').textContent = 'Streaming from ' + state.model.kind + '…';
    try {
      const res = await fetch('/api/studio/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...state.model, messages: state.history }) });
      if (!res.ok || !res.body) { const b = await res.json().catch(() => ({})); throw new Error((b.error && b.error.message) || ('HTTP ' + res.status)); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let full = '';
      for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line.startsWith('data:')) continue; const p = line.slice(5).trim(); if (p === '[DONE]') continue;
          try { const d = JSON.parse(p).choices[0].delta.content; if (typeof d === 'string') { full += d; out.textContent = full; } } catch {} } }
      state.history.push({ role: 'assistant', content: full }); $('#chat-status').textContent = 'Done.';
    } catch (e) { out.textContent = ''; out.parentElement.classList.add('bad'); out.textContent = 'Error: ' + e.message; $('#chat-status').textContent = 'Request failed.'; }
    finally { btn.disabled = false; input.focus(); log.scrollTop = log.scrollHeight; }
  });

  async function loadHarnesses() {
    const body = $('#runtimes-body'); const status = $('#runtimes-status'); status.textContent = 'Discovering runtimes…';
    try {
      state.harnesses = await getJson('/api/studio/harnesses.json'); body.replaceChildren();
      for (const h of state.harnesses.harnesses) {
        body.append(el('tr', {}, el('td', { text: h.displayName }), el('td', {}, h.installed ? badge(h.versionStatus === 'builtin' ? 'built in' : 'installed', 'ok') : badge('not installed', 'muted')),
          el('td', { text: h.version || '—' }), el('td', { text: h.definition.integrations.join(', ') }), el('td', { text: h.definition.localModel.mechanism }), el('td', { text: h.definition.evidence })));
      }
      status.textContent = state.harnesses.harnesses.filter(h => h.installed).length + ' runtime(s) available. Authentication is never probed.';
    } catch (e) { status.textContent = 'Runtime discovery failed: ' + e.message; }
  }

  async function loadGraph() {
    const status = $('#graph-status');
    try { const g = await getJson('/api/studio/graph.json');
      $('#graph-provider').textContent = g.provider; $('#graph-files').textContent = g.files; $('#graph-edges').textContent = g.edges;
      $('#graph-stale').replaceChildren(g.stale ? badge('stale (' + g.staleFiles.length + ' file(s))', 'warn') : badge('fresh', 'ok'));
      $('#graph-outputs').textContent = Object.values(g.outputs).join(', ') || 'none (native indexer)';
      status.textContent = '';
    } catch (e) { status.textContent = 'Graph unavailable: ' + e.message; }
  }
  $('#blast-form').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const files = $('#blast-files').value.split(/[\n,]/).map(s => s.trim()).filter(Boolean); const out = $('#blast-out');
    out.replaceChildren();
    try { const r = await getJson('/api/studio/blast-radius', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files }) });
      out.append(el('p', { text: r.affected.length + ' affected file(s), ' + r.affectedTests.length + ' test file(s).' }));
      const ul = el('ul'); for (const f of r.affected) ul.append(el('li', { text: f + (r.affectedTests.includes(f) ? '  (test)' : '') })); out.append(ul);
    } catch (e) { out.append(el('p', { class: 'bad', text: e.message })); }
  });

  $('#dispatch-form').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const out = $('#dispatch-out'); const status = $('#dispatch-status'); out.replaceChildren(); status.textContent = 'Planning…';
    let ir; try { ir = JSON.parse($('#dispatch-ir').value); } catch { status.textContent = 'The contract is not valid JSON.'; return; }
    try {
      const r = await getJson('/api/studio/dispatch-preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ir, mode: $('#dispatch-mode').value, graphAware: $('#dispatch-graph').checked }) });
      const p = r.plan; status.textContent = p.status + ' · mode ' + p.mode + ' · dispatch benefit ' + p.dispatchBenefit + ' · ' + p.agents + ' agent(s) · ' + r.execution;
      if (p.reasons.length) { const ul = el('ul', { class: 'reasons' }); for (const x of p.reasons) ul.append(el('li', { text: x })); out.append(ul); }
      const t = el('table'); t.append(el('thead', {}, el('tr', {}, ...['Task','Role','Runtime binding','Group','Worktree','Authority'].map(h => el('th', { scope: 'col', text: h })))));
      const tb = el('tbody'); for (const a of p.assignments) tb.append(el('tr', {}, el('td', { text: a.taskId }), el('td', { text: a.role }), el('td', { text: a.bindingIds.join(' | ') }), el('td', { text: String(a.group) }), el('td', { text: a.worktree }),
        el('td', { text: Object.entries(a.authority).filter(([,v]) => v !== 'DENY').map(([k,v]) => k + ':' + v).join(' ') || 'none' })));
      t.append(tb); out.append(t);
      if (!r.candidates.length) out.append(el('p', { class: 'empty', text: 'No runtime binding is available on this machine yet: install a harness (Runtimes) or start a local model (Models).' }));
    } catch (e) { status.textContent = 'Rejected: ' + e.message; }
  });
  $('#cowork-plan').addEventListener('click', () => {
    let ir; try { ir = JSON.parse($('#dispatch-ir').value); } catch { location.hash = '#/agents'; $('#dispatch-status').textContent = 'Fix the contract JSON first.'; return; }
    for (const cap of ['READ','WRITE','EXECUTE','NETWORK','EXTERNAL_ACTION']) ir.capabilities[cap] = $('#perm-' + cap).value;
    ir.intent = $('#cowork-intent').value.trim() || ir.intent;
    $('#dispatch-ir').value = JSON.stringify(ir, null, 2); location.hash = '#/agents';
  });
  route();
})();
`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function renderStudioHtml(): { readonly html: string; readonly nonce: string } {
  const nonce = randomBytes(16).toString('base64');
  const perm = (cap: string, def: string) => `<div><label for="perm-${cap}">${cap.replace('_', ' ')}</label><select id="perm-${cap}">${['ALLOW', 'ASK', 'DENY'].map((d) => `<option${d === def ? ' selected' : ''}>${d}</option>`).join('')}</select></div>`;
  const nav = (view: string, label: string) => `<li><a href="#/${view}" data-view="${view}">${label}</a></li>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FuryPipe Studio</title><style nonce="${nonce}">${CSS}</style></head>
<body><a class="skip" href="#main">Skip to content</a>
<div class="app">
<nav class="side" aria-label="Studio">
  <div class="brand">Fury<span>Pipe</span> Studio</div>
  <div><h2 id="nav-work">Work</h2><ul aria-labelledby="nav-work">${nav('chat', 'Chat')}${nav('cowork', 'Cowork')}${nav('code', 'Code')}${nav('agents', 'Agents')}${nav('automations', 'Automations')}</ul></div>
  <div><h2 id="nav-system">System</h2><ul aria-labelledby="nav-system">${nav('models', 'Models')}${nav('runtimes', 'Runtimes')}${nav('settings', 'Settings')}</ul></div>
</nav>
<div>
<header class="top" aria-label="Active execution context">
  <span class="chip" id="ind-runtime">Runtime <b>—</b></span><span class="chip" id="ind-provider">Provider <b>—</b></span>
  <span class="chip" id="ind-model">Model <b>—</b></span><span class="chip" id="ind-locality">Locality <b>—</b></span>
</header>
<main id="main">
<section data-view="chat" aria-labelledby="h-chat"><h1 id="h-chat">Chat</h1><p class="lead">Talk to a model running on this machine. Cloud providers stay in the governed Gateway WebChat.</p>
  <div class="card">
    <div id="chat-empty" class="empty" hidden>No local model is reachable. Start Ollama, LM Studio, llama.cpp, vLLM or SGLang, then open <a href="#/models">Models</a> to refresh.</div>
    <form id="chat-form" hidden><div class="row"><div><label for="chat-model">Model</label><select id="chat-model"></select></div></div>
      <div id="chat-log" class="log" role="log" aria-live="polite" aria-label="Conversation"></div>
      <label for="chat-input">Message</label><textarea id="chat-input" required></textarea>
      <div class="row"><button id="chat-send" type="submit">Send</button><span id="chat-status" class="status muted" role="status"></span></div></form>
  </div></section>
<section data-view="cowork" aria-labelledby="h-cowork" hidden><h1 id="h-cowork">Cowork</h1><p class="lead">Describe a task and decide what the agent may do. Studio drafts an Executable Intent Contract; nothing runs until a runtime executes it.</p>
  <div class="card"><label for="cowork-intent">Task</label><textarea id="cowork-intent" placeholder="e.g. Tidy the docs folder and summarise open TODOs"></textarea>
  <fieldset class="row"><legend class="muted">Permissions</legend>${perm('READ', 'ALLOW')}${perm('WRITE', 'ASK')}${perm('EXECUTE', 'ASK')}${perm('NETWORK', 'DENY')}${perm('EXTERNAL_ACTION', 'DENY')}</fieldset>
  <p><button id="cowork-plan" type="button">Plan with Agents</button></p></div></section>
<section data-view="code" aria-labelledby="h-code" hidden><h1 id="h-code">Code</h1><p class="lead">Project graph for this workspace (Graphify when present, native indexer otherwise) and change blast radius.</p>
  <div class="grid"><div class="card"><h2>Project graph</h2><table><tbody>
    <tr><th scope="row">Provider</th><td id="graph-provider">—</td></tr><tr><th scope="row">Files</th><td id="graph-files">—</td></tr>
    <tr><th scope="row">Edges</th><td id="graph-edges">—</td></tr><tr><th scope="row">Freshness</th><td id="graph-stale">—</td></tr>
    <tr><th scope="row">Outputs</th><td id="graph-outputs">—</td></tr></tbody></table><p id="graph-status" class="status muted" role="status"></p></div>
  <div class="card"><h2>Blast radius</h2><form id="blast-form"><label for="blast-files">Changed files (one per line)</label><textarea id="blast-files" placeholder="src/auth/session.ts"></textarea><button type="submit">Analyse</button></form><div id="blast-out" aria-live="polite"></div></div></div></section>
<section data-view="agents" aria-labelledby="h-agents" hidden><h1 id="h-agents">Agents</h1><p class="lead">Dispatch preview: FuryDispatcher plans runtimes, parallel groups, worktrees and authority for a contract. Preview only — no agent is started.</p>
  <div class="card"><form id="dispatch-form"><label for="dispatch-ir">Intent contract (FuryIR)</label><textarea id="dispatch-ir" class="code" spellcheck="false">${escapeHtml(JSON.stringify(STUDIO_EXAMPLE_IR, null, 2))}</textarea>
    <div class="row"><div><label for="dispatch-mode">Mode</label><select id="dispatch-mode">${['AUTO', 'SINGLE', 'SPECIALISTS', 'PARALLEL', 'PIPELINE', 'REVIEW_CHAIN', 'COUNCIL', 'RACE', 'LOCAL_CLOUD_HYBRID', 'LOCAL_ONLY', 'OFF'].map((m) => `<option>${m}</option>`).join('')}</select></div>
    <div><label for="dispatch-graph"><input id="dispatch-graph" type="checkbox"> Graph-aware</label></div><button type="submit">Preview plan</button></div></form>
    <p id="dispatch-status" class="status" role="status"></p><div id="dispatch-out"></div></div></section>
<section data-view="automations" aria-labelledby="h-automations" hidden><h1 id="h-automations">Automations</h1><p class="lead">Scheduled and webhook automations run in the FuryPipe Gateway.</p>
  <div class="empty">Automations are not managed from Studio yet. Start the Gateway with <code>furypipe gateway start</code>; its WebChat shows automation status when observability is enabled.</div></section>
<section data-view="models" aria-labelledby="h-models" hidden><h1 id="h-models">Models</h1><p class="lead">Local inference servers on this machine and whether each model fits your hardware. Probes stay on loopback.</p>
  <div class="card"><p><b>Hardware:</b> <span id="hw">—</span></p><table><thead><tr><th scope="col">Backend</th><th scope="col">Endpoint</th><th scope="col">State</th><th scope="col">Model</th><th scope="col">Fit</th></tr></thead><tbody id="models-body"></tbody></table><p id="models-status" class="status muted" role="status"></p></div></section>
<section data-view="runtimes" aria-labelledby="h-runtimes" hidden><h1 id="h-runtimes">Runtimes</h1><p class="lead">Agent harnesses installed on this machine. Harness, provider and model are independent choices.</p>
  <div class="card"><table><thead><tr><th scope="col">Runtime</th><th scope="col">State</th><th scope="col">Version</th><th scope="col">Integration</th><th scope="col">Local models via</th><th scope="col">Evidence</th></tr></thead><tbody id="runtimes-body"></tbody></table><p id="runtimes-status" class="status muted" role="status"></p></div></section>
<section data-view="settings" aria-labelledby="h-settings" hidden><h1 id="h-settings">Settings</h1><p class="lead">Advanced surfaces for operators.</p>
  <div class="card"><h2>Advanced</h2><p><a href="/control-plane">Control Plane</a> — the technical dashboard: sessions, compression, readiness, provider and MCP evidence.</p></div></section>
<section data-view="notfound" aria-labelledby="h-notfound" hidden><h1 id="h-notfound">Page not found</h1><p class="lead">This Studio view does not exist. <a href="#/chat">Go to Chat</a>.</p></section>
</main></div></div>
<script nonce="${nonce}">${SCRIPT}</script></body></html>`;
  return Object.freeze({ html, nonce });
}

export function studioHtmlResponse(): Response {
  const { html, nonce } = renderStudioHtml();
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    },
  });
}
