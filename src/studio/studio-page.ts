// FuryPipe Studio — the product shell (Chat, Cowork, Code, Agents,
// Automations). The former dashboard remains available as
// Settings › Advanced › Control Plane (/control-plane).
//
// Security: served with a nonce-based CSP (no inline handlers, no external
// origins); every runtime value is inserted with textContent, never HTML.
import { randomBytes } from 'node:crypto';
import { FURY_HARNESS_REGISTRY } from '../fury-harness-hub.js';

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

export const STUDIO_EXAMPLE_FLOW = Object.freeze({
  format: 'furypipe-flow/v1', id: 'refund-triage', version: 1, name: 'Refund triage',
  nodes: [
    { id: 'trigger', type: 'TRIGGER', label: 'Support webhook', config: { kind: 'webhook' } },
    { id: 'classify', type: 'LLM', label: 'Classify request' },
    { id: 'route', type: 'CONDITION', label: 'Refund?' },
    { id: 'approve', type: 'HUMAN_APPROVAL', label: 'Approve refund' },
    { id: 'pay', type: 'HTTP', label: 'Issue refund', critical: true, config: { sideEffect: true } },
    { id: 'reply', type: 'AGENT', label: 'Draft reply' },
    { id: 'notify', type: 'NOTIFICATION', label: 'Notify ops' },
  ],
  edges: [
    { from: 'trigger', to: 'classify' }, { from: 'classify', to: 'route' },
    { from: 'route', to: 'approve', when: 'refund' }, { from: 'route', to: 'reply', when: 'other' },
    { from: 'approve', to: 'pay' }, { from: 'pay', to: 'notify' }, { from: 'reply', to: 'notify' },
  ],
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
svg.flow{width:100%;height:auto;background:var(--bg);border:1px solid var(--line);border-radius:var(--radius)}
svg.flow .node rect{fill:var(--panel);stroke:var(--ink);stroke-width:1.5}
svg.flow .node.agentic rect{stroke:var(--accent);stroke-dasharray:6 4;stroke-width:2}
svg.flow .node.critical rect{stroke-width:3}
svg.flow text{fill:var(--ink);font-size:12px}svg.flow .zone{fill:var(--muted);font-size:10px;text-transform:uppercase}
svg.flow line{stroke:var(--muted);stroke-width:1.5}svg.flow .when{fill:var(--accent);font-size:11px}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--muted)}
@media (max-width:760px){.app{grid-template-columns:1fr}nav.side{border-right:0;border-bottom:1px solid var(--line)}nav.side ul{grid-template-columns:repeat(3,1fr)}main{padding:16px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

const SCRIPT = String.raw`
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'text') n.textContent = v; else if (k === 'class') n.className = v; else n.setAttribute(k, v); } for (const k of kids) n.append(k); return n; };
  const views = ['chat','cowork','code','agents','mission','automations','models','runtimes','skills','mcp','knowledge','settings'];
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
    if (name === 'skills') loadSkills();
    if (name === 'mcp') loadMcp();
    if (name === 'knowledge') loadKnowledge();
    if (name === 'code') loadGraph();
    if (name === 'mission') loadRuns();
    clearInterval(state.poll); if (name === 'mission') state.poll = setInterval(loadRuns, 2000);
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
  async function loadRuns() {
    try { const r = await getJson('/api/studio/runs.json'); const box = $('#runs'); box.replaceChildren();
      if (!r.runs.length) { box.append(el('p', { class: 'empty', text: 'No run yet. Start one above; only local runtimes are used unless you allow cloud runtimes.' })); return; }
      for (const run of r.runs) {
        const card = el('div', { class: 'card' }); card.append(el('h2', { text: run.runId + ' — ' + run.status + (run.verdict ? ' · FuryJudge ' + run.verdict : '') }), el('p', { class: 'muted', text: run.intent }));
        if (run.error) card.append(el('p', { class: 'bad', text: run.error }));
        const t = el('table'); t.append(el('thead', {}, el('tr', {}, ...['Worker','Role','Runtime','Model','Locality','State','Tokens','Receipts',''].map(h => el('th', { scope: 'col', text: h })))));
        const tb = el('tbody');
        for (const w of run.workers) { const stop = el('button', { type: 'button', class: 'secondary', text: 'Stop' }); stop.disabled = !['queued','running','paused','awaiting-approval'].includes(w.state);
          stop.setAttribute('aria-label', 'Stop worker ' + w.workerId);
          stop.addEventListener('click', async () => { try { await getJson('/api/studio/runs/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: run.runId, workerId: w.workerId, action: 'STOP' }) }); loadRuns(); } catch (e) { $('#run-status').textContent = e.message; } });
          tb.append(el('tr', {}, el('td', { text: w.workerId }), el('td', { text: w.role }), el('td', { text: w.harnessId }), el('td', { text: w.model }), el('td', { text: w.locality }), el('td', { text: w.state }), el('td', { text: String(w.usage.tokens) }), el('td', { text: String(w.receipts) }), el('td', {}, stop))); }
        t.append(tb); card.append(t);
        if (run.requirements) { const ul = el('ul', { class: 'reasons' }); for (const q of run.requirements) ul.append(el('li', { text: q.id + ': ' + q.status })); card.append(ul); }
        box.append(card);
      }
    } catch (e) { $('#run-status').textContent = 'Runs unavailable: ' + e.message; }
  }
  $('#run-form').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const status = $('#run-status');
    const files = $('#run-files').value.split(/\n/).map(s => s.trim()).filter(Boolean);
    try { const r = await getJson('/api/studio/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intent: $('#run-intent').value, plannedFiles: files, allowCloud: $('#run-cloud').checked, confirm: $('#run-confirm').checked }) });
      status.textContent = 'Started ' + r.runId + ' · ' + r.dispatch.mode + ' · dispatch benefit ' + r.dispatch.benefit; loadRuns();
    } catch (e) { status.textContent = 'Not started: ' + e.message; }
  });
  async function skillAct(name, action, value) {
    try { await getJson('/api/studio/skills/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, action, value }) }); await loadSkills(); $('#skills-status').textContent = action + ' applied to ' + name + '.'; }
    catch (e) { $('#skills-status').textContent = e.message; }
  }
  async function loadSkills() {
    const body = $('#skills-body'); const status = $('#skills-status');
    try { const r = await getJson('/api/studio/skills.json'); body.replaceChildren();
      for (const s of r.skills) {
        const toggle = el('button', { type: 'button', class: 'secondary', text: s.enabled ? 'Disable' : 'Enable' }); toggle.setAttribute('aria-label', (s.enabled ? 'Disable ' : 'Enable ') + s.name);
        toggle.addEventListener('click', () => skillAct(s.name, s.enabled ? 'DISABLE' : 'ENABLE'));
        const pin = el('button', { type: 'button', class: 'secondary', text: s.pinned ? (s.pinMismatch ? 'Re-pin' : 'Unpin') : 'Pin' }); pin.setAttribute('aria-label', pin.textContent + ' ' + s.name);
        pin.addEventListener('click', () => skillAct(s.name, s.pinned && !s.pinMismatch ? 'UNPIN' : 'PIN'));
        const gov = el('select', { 'aria-label': 'Governance for ' + s.name }); for (const g of ['DRAFT_ONLY','ASK_BEFORE_WRITE','AUTO_APPLY_LOW_RISK','LOCKED']) { const o = el('option', { text: g }); if (g === s.governance) o.selected = true; gov.append(o); }
        gov.addEventListener('change', () => skillAct(s.name, 'GOVERNANCE', gov.value));
        const state = s.pinMismatch ? badge('pin mismatch', 'warn') : !s.enabled ? badge('disabled', 'muted') : s.trust === 'trusted-instructions' ? badge('trusted', 'ok') : badge('untrusted', 'muted');
        body.append(el('tr', {}, el('td', {}, el('b', { text: s.name }), el('div', { class: 'muted', text: s.description })), el('td', { text: s.scope }), el('td', {}, state),
          el('td', { text: s.version + ' · ' + s.type }), el('td', { text: s.compatibleHarnesses.join(', ') || 'any' }), el('td', { text: s.stats.uses + ' (' + s.stats.successes + '✓/' + s.stats.failures + '✗)' }),
          el('td', { class: 'code', text: s.checksum.slice(0, 12) }), el('td', {}, gov), el('td', {}, toggle, pin)));
      }
      status.textContent = r.skills.length + ' skill(s) discovered. Skills never gain tool, network or script authority from here.';
    } catch (e) { status.textContent = 'Skills unavailable: ' + e.message; }
  }
  $('#skill-select-form').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const out = $('#skill-select-out'); out.replaceChildren();
    try { const r = await getJson('/api/studio/skills/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ objective: $('#skill-objective').value, harnessId: $('#skill-harness').value || undefined }) });
      out.append(el('p', { text: r.plan.selected.length ? 'Selected: ' + r.plan.selected.map(x => x.name + ' (' + x.reason + ')').join(', ') : 'No skill selected.' }));
      if (r.excluded.length) { const ul = el('ul', { class: 'reasons' }); for (const x of r.excluded) ul.append(el('li', { text: x.name + ': ' + x.reason })); out.append(ul); }
    } catch (e) { out.append(el('p', { class: 'bad', text: e.message })); }
  });
  async function mcpPost(url, payload) { return getJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); }
  async function loadMcp() {
    const box = $('#mcp-list'); const status = $('#mcp-status');
    try { const r = await getJson('/api/studio/mcp.json'); box.replaceChildren();
      if (!r.sources.length) box.append(el('p', { class: 'empty', text: 'No MCP server configured. FuryPipe reads .mcp.json, .cursor/mcp.json, .vscode/mcp.json, opencode.json, ~/.claude.json and ~/.codex/config.toml.' }));
      for (const s of r.sources) {
        const card = el('div', { class: 'card' });
        const health = s.health ? (s.health.ok ? badge('healthy · ' + s.health.toolCount + ' tool(s)', 'ok') : badge('unhealthy', 'warn')) : badge('not probed', 'muted');
        card.append(el('h2', { text: s.name }), el('p', { class: 'muted', text: s.origin + ' · ' + s.transport + ' · ' + s.locality + ' · ' + (s.command ? s.command + ' ' + (s.args || []).join(' ') : s.url) }), el('p', {}, health, ' ', s.trusted ? badge('trusted', 'ok') : badge('untrusted', 'muted'), ' ', s.enabled ? badge('enabled', 'ok') : badge('disabled', 'muted')));
        if (s.envNames.length || s.headerNames.length) card.append(el('p', { class: 'muted', text: 'Credentials referenced (values never shown or sent by probes): ' + [...s.envNames, ...s.headerNames].join(', ') }));
        if (s.health && s.health.error) card.append(el('p', { class: 'bad', text: s.health.error }));
        const row = el('div', { class: 'row' });
        const act = (label, action, value) => { const b = el('button', { type: 'button', class: 'secondary', text: label }); b.setAttribute('aria-label', label + ' ' + s.name); b.addEventListener('click', async () => { try { await mcpPost('/api/studio/mcp/act', { sourceId: s.sourceId, action, value }); await loadMcp(); status.textContent = label + ': ' + s.name; } catch (e) { status.textContent = e.message; } }); return b; };
        row.append(act(s.enabled ? 'Disable' : 'Enable', s.enabled ? 'DISABLE' : 'ENABLE'), act(s.trusted ? 'Untrust' : 'Trust', s.trusted ? 'UNTRUST' : 'TRUST'));
        const pol = el('select', { 'aria-label': 'Default tool policy for ' + s.name }); for (const p of ['ALLOW','ASK','DENY','READ_ONLY']) { const o = el('option', { text: p }); if (p === s.defaultPolicy) o.selected = true; pol.append(o); }
        pol.addEventListener('change', async () => { try { await mcpPost('/api/studio/mcp/act', { sourceId: s.sourceId, action: 'DEFAULT_POLICY', value: pol.value }); status.textContent = 'Default policy for ' + s.name + ': ' + pol.value; } catch (e) { status.textContent = e.message; } });
        const probe = el('button', { type: 'button', text: 'Health check' }); probe.setAttribute('aria-label', 'Health check ' + s.name);
        probe.addEventListener('click', async () => {
          const remote = s.locality === 'remote';
          if (!confirm(remote ? 'Contact the remote server ' + s.url + ' without credentials?' : 'Start ' + s.name + ' locally to list its tools?')) return;
          probe.disabled = true; status.textContent = 'Probing ' + s.name + '…';
          try { await mcpPost('/api/studio/mcp/probe', { sourceId: s.sourceId, allowRemote: remote, confirm: true }); await loadMcp(); status.textContent = 'Probed ' + s.name + '.'; } catch (e) { status.textContent = e.message; probe.disabled = false; }
        });
        row.append(el('label', {}, 'Default policy ', pol), probe); card.append(row);
        if (s.health && s.health.tools.length) {
          const t = el('table'); t.append(el('thead', {}, el('tr', {}, ...['Tool','Risk','Read-only','Policy'].map(h => el('th', { scope: 'col', text: h })))));
          const tb = el('tbody');
          for (const tool of s.health.tools) { const sel = el('select', { 'aria-label': 'Policy for ' + tool.name }); for (const p of ['(default)','ALLOW','ASK','DENY','READ_ONLY']) { const o = el('option', { text: p }); if ((s.toolPolicies[tool.name] || '(default)') === p) o.selected = true; sel.append(o); }
            sel.addEventListener('change', async () => { try { await mcpPost('/api/studio/mcp/act', { sourceId: s.sourceId, action: 'TOOL_POLICY', tool: tool.name, value: sel.value === '(default)' ? null : sel.value }); status.textContent = tool.name + ': ' + sel.value; } catch (e) { status.textContent = e.message; } });
            tb.append(el('tr', {}, el('td', { text: tool.name }), el('td', { text: tool.riskClass }), el('td', { text: tool.readOnly ? 'yes' : 'no' }), el('td', {}, sel))); }
          t.append(tb); card.append(t);
        }
        box.append(card);
      }
      status.textContent = r.sources.length + ' MCP server(s) across ' + r.configs.filter(c => c.status === 'found').length + ' config file(s).';
    } catch (e) { status.textContent = 'MCP discovery failed: ' + e.message; }
  }
  async function loadKnowledge() {
    try { const k = await getJson('/api/studio/knowledge.json');
      $('#kb-stats').textContent = k.files + ' file(s), ' + k.chunks + ' passage(s), ' + k.embedded + ' with embeddings. Semantic search: ' + (k.availableEmbeddingModel ? 'available (' + k.availableEmbeddingModel + ')' : 'no local embeddings model found, keyword search only') + '.';
    } catch (e) { $('#kb-stats').textContent = 'Knowledge unavailable: ' + e.message; }
  }
  $('#kb-ingest-form').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const status = $('#kb-ingest-status'); status.textContent = 'Indexing…';
    try { const r = await mcpPost('/api/studio/knowledge/ingest', { dir: $('#kb-dir').value.trim() });
      status.textContent = 'Indexed ' + r.filesIndexed + ' new or changed file(s), ' + r.filesUnchanged + ' unchanged, ' + r.filesRemoved + ' removed' + (r.skipped.length ? ', ' + r.skipped.length + ' skipped' : '') + '.'; loadKnowledge();
    } catch (e) { status.textContent = 'Not indexed: ' + e.message; }
  });
  let kbHits = [];
  $('#kb-search-form').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const out = $('#kb-results'); out.replaceChildren();
    try { const r = await mcpPost('/api/studio/knowledge/search', { query: $('#kb-query').value, mode: $('#kb-mode').value }); kbHits = r.hits;
      if (!r.hits.length) { out.append(el('p', { class: 'empty', text: 'No passage matches. Index a folder first or rephrase.' })); return; }
      out.append(el('p', { class: 'muted', text: r.hits.length + ' passage(s) · ' + r.mode + ' retrieval' }));
      const ol = el('ol', { class: 'hits' });
      for (const h of r.hits) ol.append(el('li', {}, el('b', { text: h.citation }), h.heading ? el('span', { class: 'muted', text: ' — ' + h.heading }) : '', el('pre', { text: h.snippet }), el('p', { class: 'muted', text: 'Why: ' + h.why })));
      const ask = el('button', { type: 'button', class: 'secondary', text: 'Ask a local model with these sources' });
      ask.addEventListener('click', () => { const q = $('#kb-query').value;
        $('#chat-input').value = 'Answer using only the sources below. Cite them as [n]. If the sources do not contain the answer, say so.\n\nSources:\n' + kbHits.map((h, i) => '[' + (i + 1) + '] ' + h.citation + '\n' + h.snippet).join('\n\n') + '\n\nQuestion: ' + q;
        location.hash = '#/chat'; });
      out.append(ol, ask);
    } catch (e) { out.append(el('p', { class: 'bad', text: e.message })); }
  });
  const LEVELS = ['simple', 'power', 'engineer', 'expert'];
  function applyMode(mode) {
    if (!LEVELS.includes(mode)) mode = 'simple';
    $('#ui-mode').value = mode;
    const max = LEVELS.indexOf(mode);
    for (const li of document.querySelectorAll('nav.side li[data-level]')) li.hidden = LEVELS.indexOf(li.dataset.level) > max;
    try { localStorage.setItem('furypipe.studio.mode', mode); } catch {}
  }
  let savedMode = 'simple'; try { savedMode = localStorage.getItem('furypipe.studio.mode') || 'simple'; } catch {}
  applyMode(savedMode);
  $('#ui-mode').addEventListener('change', (e) => applyMode(e.target.value));

  const SVG = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}, text) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); if (text !== undefined) n.textContent = text; return n; };
  function drawFlow(flow, trace) {
    const level = {}; for (const id of flow.order) { const ins = flow.edges.filter(e => e.to === id).map(e => level[e.from] + 1); level[id] = ins.length ? Math.max(...ins) : 0; }
    const cols = {}; for (const id of flow.order) (cols[level[id]] = cols[level[id]] || []).push(id);
    const W = 170, H = 58, GX = 50, GY = 26; const pos = {};
    for (const [c, ids] of Object.entries(cols)) ids.forEach((id, r) => { pos[id] = { x: 20 + Number(c) * (W + GX), y: 20 + r * (H + GY) }; });
    const width = 40 + (Object.keys(cols).length) * (W + GX); const height = 40 + Math.max(...Object.values(cols).map(v => v.length)) * (H + GY);
    const svg = svgEl('svg', { class: 'flow', viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': 'Workflow ' + flow.name + ': ' + flow.nodes.length + ' steps, ' + flow.stochasticSurface.agentic + ' agentic' });
    const skipped = new Set((trace || []).filter(t => t.skipped).map(t => t.node));
    for (const e of flow.edges) { const a = pos[e.from], b = pos[e.to]; svg.append(svgEl('line', { x1: a.x + W, y1: a.y + H / 2, x2: b.x, y2: b.y + H / 2 })); if (e.when) svg.append(svgEl('text', { class: 'when', x: (a.x + W + b.x) / 2 - 12, y: (a.y + b.y + H) / 2 - 4 }, e.when)); }
    for (const n of flow.nodes) { const p = pos[n.id]; const zone = flow.zones[n.id];
      const g = svgEl('g', { class: 'node ' + zone + (n.critical ? ' critical' : ''), opacity: skipped.has(n.id) ? 0.35 : 1 });
      g.append(svgEl('rect', { x: p.x, y: p.y, width: W, height: H, rx: 8 }), svgEl('text', { x: p.x + 10, y: p.y + 22 }, n.label.slice(0, 22)), svgEl('text', { class: 'zone', x: p.x + 10, y: p.y + 42 }, n.type + ' · ' + zone));
      svg.append(g); }
    $('#flow-canvas').replaceChildren(svg);
  }
  async function previewFlow(withRun) {
    const status = $('#flow-status'); let flow; try { flow = JSON.parse($('#flow-json').value); } catch { status.textContent = 'The flow is not valid JSON.'; return; }
    const body = { flow }; if (withRun) { body.fixtures = { classify: 'refund', route: 'refund', reply: 'Thanks, refund on its way.' }; body.approvals = []; }
    try { const r = await getJson('/api/studio/flow-preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const s = r.flow.stochasticSurface; status.textContent = 'Valid · ' + s.nodes + ' steps · ' + s.agentic + ' agentic (' + Math.round(s.ratio * 100) + '% stochastic surface) · digest ' + r.flow.digest.slice(0, 12) + (r.run ? ' · dry-run ' + r.run.status : '');
      drawFlow(r.flow, r.run && r.run.trace); const ol = $('#flow-trace'); ol.replaceChildren();
      if (r.run) for (const t of r.run.trace) ol.append(el('li', { text: t.node + ' — ' + t.zone + (t.skipped ? ' (branch not taken)' : '') }));
      if (r.run && r.run.status === 'waiting-approval') ol.append(el('li', { text: 'Paused at human approval: ' + r.run.checkpoint.waitingApproval }));
    } catch (e) { status.textContent = 'Invalid flow: ' + e.message; $('#flow-canvas').replaceChildren(); }
  }
  $('#flow-form').addEventListener('submit', (ev) => { ev.preventDefault(); previewFlow(false); });
  $('#flow-dry').addEventListener('click', () => previewFlow(true));
  route();
})();
`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function renderStudioHtml(): { readonly html: string; readonly nonce: string } {
  const nonce = randomBytes(16).toString('base64');
  const perm = (cap: string, def: string) => `<div><label for="perm-${cap}">${cap.replace('_', ' ')}</label><select id="perm-${cap}">${['ALLOW', 'ASK', 'DENY'].map((d) => `<option${d === def ? ' selected' : ''}>${d}</option>`).join('')}</select></div>`;
  const nav = (view: string, level: string, label: string) => `<li data-level="${level}"><a href="#/${view}" data-view="${view}">${label}</a></li>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FuryPipe Studio</title><style nonce="${nonce}">${CSS}</style></head>
<body><a class="skip" href="#main">Skip to content</a>
<div class="app">
<nav class="side" aria-label="Studio">
  <div class="brand">Fury<span>Pipe</span> Studio</div>
  <div><h2 id="nav-work">Work</h2><ul aria-labelledby="nav-work">${nav('chat', 'simple', 'Chat')}${nav('cowork', 'power', 'Cowork')}${nav('code', 'engineer', 'Code')}${nav('agents', 'engineer', 'Agents')}${nav('mission', 'engineer', 'Mission Control')}${nav('knowledge', 'power', 'Knowledge')}${nav('automations', 'expert', 'Automations')}</ul></div>
  <div><h2 id="nav-system">System</h2><ul aria-labelledby="nav-system">${nav('models', 'simple', 'Models')}${nav('runtimes', 'power', 'Runtimes')}${nav('skills', 'power', 'Skills')}${nav('mcp', 'engineer', 'MCP')}${nav('settings', 'simple', 'Settings')}</ul></div>
</nav>
<div>
<header class="top" aria-label="Active execution context">
  <label class="chip" for="ui-mode">Mode <select id="ui-mode"><option value="simple">Simple</option><option value="power">Power</option><option value="engineer">Engineer</option><option value="expert">Expert</option></select></label>
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
<section data-view="mission" aria-labelledby="h-mission" hidden><h1 id="h-mission">Mission Control</h1><p class="lead">Run a planned task with real agents in isolated worktrees and watch every worker. Results are accepted only by FuryJudge with receipts.</p>
  <div class="card"><form id="run-form"><label for="run-intent">Task</label><textarea id="run-intent" required placeholder="e.g. Fix the login bug and add a test"></textarea>
  <label for="run-files">Files expected to change (one per line)</label><textarea id="run-files" placeholder="src/auth/login.ts"></textarea>
  <div class="row"><label for="run-cloud"><input id="run-cloud" type="checkbox"> Allow cloud runtimes (may incur provider cost)</label>
  <label for="run-confirm"><input id="run-confirm" type="checkbox" required> I confirm starting agents on this repository</label><button type="submit">Start run</button></div></form>
  <p id="run-status" class="status" role="status"></p></div>
  <div id="runs" aria-live="polite"></div></section>
<section data-view="automations" aria-labelledby="h-automations" hidden><h1 id="h-automations">Automations</h1><p class="lead">FuryFlow: build a workflow and see where non-determinism lives. Validation and dry-run only here; scheduled runs use the Gateway automation scheduler.</p>
  <div class="card"><form id="flow-form"><label for="flow-json">Flow (FuryFlow JSON)</label><textarea id="flow-json" class="code" spellcheck="false">${escapeHtml(JSON.stringify(STUDIO_EXAMPLE_FLOW, null, 2))}</textarea>
  <div class="row"><button type="submit">Validate &amp; draw</button><button id="flow-dry" type="button" class="secondary">Dry-run (refund branch)</button></div></form>
  <p id="flow-status" class="status" role="status"></p>
  <div class="legend"><span>Solid border: deterministic zone</span><span>Dashed orange border: agentic zone</span><span>Thick border: critical step</span></div>
  <div id="flow-canvas"></div><ol id="flow-trace" aria-label="Dry-run trace"></ol></div></section>
<section data-view="models" aria-labelledby="h-models" hidden><h1 id="h-models">Models</h1><p class="lead">Local inference servers on this machine and whether each model fits your hardware. Probes stay on loopback.</p>
  <div class="card"><p><b>Hardware:</b> <span id="hw">—</span></p><table><thead><tr><th scope="col">Backend</th><th scope="col">Endpoint</th><th scope="col">State</th><th scope="col">Model</th><th scope="col">Fit</th></tr></thead><tbody id="models-body"></tbody></table><p id="models-status" class="status muted" role="status"></p></div></section>
<section data-view="runtimes" aria-labelledby="h-runtimes" hidden><h1 id="h-runtimes">Runtimes</h1><p class="lead">Agent harnesses installed on this machine. Harness, provider and model are independent choices.</p>
  <div class="card"><table><thead><tr><th scope="col">Runtime</th><th scope="col">State</th><th scope="col">Version</th><th scope="col">Integration</th><th scope="col">Local models via</th><th scope="col">Evidence</th></tr></thead><tbody id="runtimes-body"></tbody></table><p id="runtimes-status" class="status muted" role="status"></p></div></section>
<section data-view="skills" aria-labelledby="h-skills" hidden><h1 id="h-skills">Skills</h1><p class="lead">Agent Skills found in this project and your home folder (.furypipe, .agents, .claude, .opencode, .github). Pin a skill to block it automatically if its content changes.</p>
  <div class="card"><table><thead><tr><th scope="col">Skill</th><th scope="col">Scope</th><th scope="col">State</th><th scope="col">Version</th><th scope="col">Runtimes</th><th scope="col">Uses</th><th scope="col">Checksum</th><th scope="col">Governance</th><th scope="col">Actions</th></tr></thead><tbody id="skills-body"></tbody></table><p id="skills-status" class="status muted" role="status"></p></div>
  <div class="card"><h2>Which skills would a task use?</h2><form id="skill-select-form"><label for="skill-objective">Task</label><textarea id="skill-objective" required placeholder="e.g. Review the SQL migration for locking"></textarea>
  <div class="row"><div><label for="skill-harness">Runtime</label><select id="skill-harness"><option value="">Any</option>${FURY_HARNESS_REGISTRY.map((h) => `<option value="${h.id}">${escapeHtml(h.displayName)}</option>`).join('')}</select></div><button type="submit">Preview selection</button></div></form><div id="skill-select-out" aria-live="polite"></div></div></section>
<section data-view="mcp" aria-labelledby="h-mcp" hidden><h1 id="h-mcp">MCP servers</h1><p class="lead">Every MCP server your coding tools are configured with, one place to decide what each tool may do. Health checks never send configured secrets.</p>
  <p id="mcp-status" class="status muted" role="status"></p><div id="mcp-list"></div></section>
<section data-view="knowledge" aria-labelledby="h-knowledge" hidden><h1 id="h-knowledge">Knowledge</h1><p class="lead">Index project documents and find cited passages. Everything stays on this machine.</p>
  <p id="kb-stats" class="status muted" role="status"></p>
  <div class="card"><form id="kb-ingest-form"><label for="kb-dir">Folder inside this project</label><input id="kb-dir" required value="docs" autocomplete="off"><div class="row"><button type="submit">Index folder</button></div></form><p id="kb-ingest-status" class="status" role="status"></p></div>
  <div class="card"><form id="kb-search-form"><label for="kb-query">Question</label><input id="kb-query" required autocomplete="off" placeholder="e.g. How does token refresh work?">
  <div class="row"><div><label for="kb-mode">Retrieval</label><select id="kb-mode"><option value="hybrid">Hybrid (keywords + meaning)</option><option value="lexical">Keywords</option><option value="semantic">Meaning only</option></select></div><button type="submit">Search</button></div></form><div id="kb-results" aria-live="polite"></div></div></section>
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
