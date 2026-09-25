// FuryPipe Studio — the product shell (Chat, Cowork, Code, Agents,
// Automations). The former dashboard remains available as
// Settings › Advanced › Control Plane (/control-plane).
//
// Visual language "Fury Lux" (docs/design/FURYPIPE_STUDIO_DESIGN_SYSTEM_2026.md):
// layered blacks, a controlled orange scale, restrained gradients, CSS/SVG
// depth instead of WebGL (zero GPU cost at rest, no dependency).
//
// Security: served with a nonce-based CSP (no inline handlers, no external
// origins); every runtime value is inserted with textContent, never HTML.
// Static icon markup is the only HTML built from strings, and it is a
// compile-time constant.
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

/** Line icons (24px grid, stroke = currentColor). Compile-time constants only. */
const ICONS: Readonly<Record<string, string>> = Object.freeze({
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  compose: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
  cowork: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  agents: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4"/><path d="M9 14h.01M15 14h.01"/>',
  mission: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m12 12 5.5-5.5"/>',
  automations: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M6.5 10v3a2 2 0 0 0 2 2H14"/>',
  knowledge: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  memory: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  models: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  runtimes: '<path d="m4 17 6-5-6-5"/><path d="M12 19h8"/>',
  skills: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  mcp: '<path d="M9 2v6M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>',
  integrations: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>',
  connections: '<circle cx="8" cy="12" r="3"/><circle cx="16" cy="12" r="3"/><path d="M11 12h2M5 7.5a8 8 0 0 1 14 0M5 16.5a8 8 0 0 0 14 0"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M9 3v18"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  branch: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M18 10.5a6 6 0 0 1-6 6H8.5"/>',
  retry: '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  route: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h5a4 4 0 0 1 4 4v4a4 4 0 0 0 1.2 2.8"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  cloud: '<path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 1 0 6 17.5"/><path d="M6 19h11.5"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
});

function icon(name: string, cls = 'i'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;
}

/** The FuryPipe mark: a ring, a luminous core and the pipe flowing through it. */
const MARK = '<svg class="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="13" fill="none" stroke="url(#fury-ring)" stroke-width="1.4"/><path d="M4.5 20.5c5 0 6.5-9 11.5-9s6.5 9 11.5 9" fill="none" stroke="url(#fury-flow)" stroke-width="2.2" stroke-linecap="round"/><circle cx="16" cy="11.5" r="3.1" fill="url(#fury-core)"/></svg>';

const CSS = `
:root{
  --b0:#050506;--b1:#0a0a0c;--b2:#0f0f12;--b3:#15151a;--b4:#1c1c22;--b5:#25252c;
  --line:rgba(255,255,255,.065);--line-2:rgba(255,255,255,.11);--line-3:rgba(255,255,255,.18);
  --ink:#f4f1ec;--ink-2:#c3bdb4;--muted:#8b857c;--faint:#5d5953;
  --o-core:#ff6a1a;--o-hot:#ff8a3d;--o-deep:#d9480f;--o-soft:rgba(255,106,26,.12);--o-line:rgba(255,122,40,.34);--o-glow:rgba(255,90,0,.32);
  --ok:#5fd99a;--warn:#f5b547;--bad:#ff6b6b;
  --font:"Inter var",Inter,"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;
  --display:"Inter Display","Inter var",Inter,"Segoe UI Variable Display","Segoe UI",system-ui,sans-serif;
  --mono:"JetBrains Mono","Cascadia Code","SF Mono",ui-monospace,Menlo,Consolas,monospace;
  --ease:cubic-bezier(.2,.8,.2,1);--ease-out:cubic-bezier(.16,1,.3,1);
  --r-sm:8px;--r-md:12px;--r-lg:16px;--r-xl:22px;
  --side-w:272px;--pad:32px;
  color-scheme:dark;
}
html[data-density="compact"]{--pad:22px}
@media (prefers-color-scheme:light){html[data-theme="system"]{
  --b0:#f7f5f2;--b1:#f1eee9;--b2:#ffffff;--b3:#f3f0eb;--b4:#e9e5de;--b5:#ddd8cf;
  --line:rgba(20,16,10,.08);--line-2:rgba(20,16,10,.13);--line-3:rgba(20,16,10,.22);
  --ink:#1a1714;--ink-2:#4a443d;--muted:#6f685f;--faint:#9a938a;--o-hot:#b93d0a;--o-core:#e8590c;--ok:#1f8f55;--warn:#a86b00;--bad:#c92a2a;color-scheme:light}}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
/* View headings take focus on navigation for screen readers; they are not controls. */
main section>h1:focus{outline:none}
html,body{height:100%}
body{margin:0;background:var(--b0);color:var(--ink);font:15px/1.6 var(--font);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;overflow:hidden}
a{color:inherit}
:focus-visible{outline:2px solid var(--o-hot);outline-offset:2px;border-radius:6px}
::selection{background:rgba(255,106,26,.32);color:#fff}
.sr-only,.defs{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.skip{position:absolute;left:-999px;top:8px;z-index:100;background:var(--b4);color:var(--ink);padding:8px 14px;border-radius:10px;border:1px solid var(--o-line)}.skip:focus{left:12px}
.i{width:18px;height:18px;flex:none}
kbd{font:600 11px/1 var(--font);color:var(--muted);border:1px solid var(--line-2);border-bottom-width:2px;border-radius:6px;padding:3px 6px;background:rgba(255,255,255,.02)}
*{scrollbar-width:thin;scrollbar-color:var(--b5) transparent}
::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:var(--b5);border-radius:10px;border:3px solid var(--b0)}::-webkit-scrollbar-track{background:transparent}

/* ---------- Shell ---------- */
.app{display:grid;grid-template-columns:var(--side-w) minmax(0,1fr);height:100vh;height:100dvh;transition:grid-template-columns .26s var(--ease-out)}
.app[data-collapsed="true"]{--side-w:68px}
.side{position:relative;display:flex;flex-direction:column;min-height:0;min-width:0;background:linear-gradient(180deg,var(--b1) 0%,var(--b0) 100%);border-right:1px solid var(--line);overflow:hidden}
.side::after{content:"";position:absolute;inset:0 0 auto 0;height:220px;background:radial-gradient(260px 140px at 40px -30px,rgba(255,106,26,.10),transparent 70%);pointer-events:none}
.side-top{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:16px 12px 10px 16px;position:relative;z-index:1}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;font:650 16.5px/1 var(--display);letter-spacing:-.015em;color:var(--ink);white-space:nowrap}
.brand .mark{width:28px;height:28px;flex:none;filter:drop-shadow(0 0 10px rgba(255,106,26,.35))}
.brand b{font-weight:650;color:var(--o-hot)}
.icon-btn{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:10px;border:1px solid transparent;background:transparent;color:var(--muted);cursor:pointer;transition:background .15s,color .15s,transform .12s}
.icon-btn:hover{background:var(--b4);color:var(--ink)}.icon-btn:active{transform:scale(.94)}
.new-chat{position:relative;z-index:1;display:flex;align-items:center;gap:10px;margin:6px 12px 6px;height:42px;padding:0 12px;border-radius:13px;border:1px solid var(--o-line);background:linear-gradient(180deg,rgba(255,122,40,.17),rgba(255,106,26,.05));color:var(--ink);font:600 14px/1 var(--font);cursor:pointer;box-shadow:0 1px 0 rgba(255,255,255,.06) inset,0 10px 30px -18px var(--o-glow);transition:transform .12s var(--ease),border-color .2s,background .2s;white-space:nowrap}
.new-chat:hover{border-color:rgba(255,138,61,.6);background:linear-gradient(180deg,rgba(255,122,40,.24),rgba(255,106,26,.07))}.new-chat:active{transform:scale(.985)}
.new-chat .i{color:var(--o-hot)}
.search-btn{position:relative;z-index:1;display:flex;align-items:center;gap:10px;margin:0 12px 10px;height:36px;padding:0 10px 0 12px;border-radius:11px;border:1px solid var(--line);background:rgba(255,255,255,.015);color:var(--muted);font:500 13.5px/1 var(--font);cursor:pointer;white-space:nowrap}
.search-btn:hover{color:var(--ink);border-color:var(--line-2)}.search-btn kbd{margin-left:auto}
.side-nav ul{list-style:none;margin:0;padding:2px 8px;display:flex;flex-direction:column;gap:1px}
.nav-item{position:relative;display:flex;align-items:center;gap:12px;height:38px;padding:0 12px;border-radius:10px;color:var(--ink-2);text-decoration:none;font:500 14px/1 var(--font);white-space:nowrap;transition:background .15s,color .15s}
.nav-item:hover{background:var(--b3);color:var(--ink)}
.nav-item[aria-current="page"]{color:var(--ink);background:linear-gradient(90deg,rgba(255,106,26,.15),rgba(255,106,26,.02) 80%)}
.nav-item[aria-current="page"] .i{color:var(--o-hot)}
.nav-item[aria-current="page"]::before{content:"";position:absolute;left:0;top:9px;bottom:9px;width:3px;border-radius:0 3px 3px 0;background:linear-gradient(180deg,#ffae70,var(--o-core));box-shadow:0 0 12px rgba(255,106,26,.7)}
.nav-sep{height:1px;background:var(--line);margin:8px 12px}
.recent{flex:1;min-height:0;overflow:auto;padding:12px 8px 8px}
.recent h2{font:600 11px/1 var(--font);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:6px 12px 8px}
.recent ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1px}
.conv-item{display:flex;align-items:center;border-radius:9px;transition:background .15s}
.conv-item:hover,.conv-item[data-current="true"]{background:var(--b3)}
.conv{flex:1;min-width:0;text-align:left;background:none;border:0;color:var(--ink-2);padding:8px 10px 8px 12px;font:450 13.5px/1.3 var(--font);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;border-radius:9px}
.conv-item[data-current="true"] .conv{color:var(--ink)}
.conv .branch-mark{color:var(--o-hot);margin-left:6px;font-size:11px}
.conv-more{opacity:0;width:28px;height:28px}.conv-item:hover .conv-more,.conv-more:focus-visible,.conv-more[aria-expanded="true"]{opacity:1}
.conv-edit{flex:1;min-width:0;margin:3px;height:30px;background:var(--b1);border:1px solid var(--o-line);border-radius:8px;color:var(--ink);padding:0 9px;font:inherit;font-size:13.5px}
.recent .empty-note{color:var(--muted);font-size:12.5px;padding:6px 12px}
.side-foot{display:flex;align-items:center;gap:6px;padding:10px;border-top:1px solid var(--line)}
.mode-btn{flex:1;min-width:0;display:flex;align-items:center;gap:10px;height:40px;padding:0 10px;border-radius:11px;border:1px solid var(--line);background:rgba(255,255,255,.015);color:var(--ink);cursor:pointer;font:500 13.5px/1 var(--font);white-space:nowrap}
.mode-btn:hover{border-color:var(--line-2)}.mode-btn .mode-dot{width:8px;height:8px;border-radius:50%;background:var(--o-core);box-shadow:0 0 8px var(--o-core);flex:none}
.mode-btn small{color:var(--muted);font-weight:500;margin-right:auto}
.app[data-collapsed="true"] .label,.app[data-collapsed="true"] .recent,.app[data-collapsed="true"] .search-btn kbd,.app[data-collapsed="true"] .brand span,.app[data-collapsed="true"] .mode-btn small,.app[data-collapsed="true"] .mode-btn .i{display:none}
.app[data-collapsed="true"] .side-top{flex-direction:column;padding:14px 0 8px;gap:10px}
.app[data-collapsed="true"] .new-chat,.app[data-collapsed="true"] .search-btn{justify-content:center;padding:0;margin-left:12px;margin-right:12px}
.app[data-collapsed="true"] .nav-item{justify-content:center;padding:0}
.app[data-collapsed="true"] .side-foot{flex-direction:column}
.app[data-collapsed="true"] .mode-btn{justify-content:center;padding:0;width:40px;flex:none}
.main-col{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0}
.top{display:flex;align-items:center;gap:10px;height:56px;padding:0 16px;flex:none;position:relative;z-index:5}
.top-title{font:600 14px/1 var(--font);color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.top-right{margin-left:auto;display:flex;align-items:center;gap:8px}
.privacy{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 11px;border-radius:999px;border:1px solid var(--o-line);background:rgba(255,106,26,.07);color:var(--ink);font:550 12.5px/1 var(--font);cursor:default}
.privacy .i{width:15px;height:15px;color:var(--o-hot)}
.mobile-only{display:none}
main{flex:1;min-height:0;overflow:auto;position:relative}
main>section{max-width:1140px;margin:0 auto;padding:12px var(--pad) 56px}
main>section>h1{font:650 28px/1.15 var(--display);letter-spacing:-.025em;margin:8px 0 8px}
main>section>.lead{color:var(--ink-2);max-width:760px;margin:0 0 26px;font-size:15px}
.scrim{display:none}

/* ---------- Chat ---------- */
main>section.chat{max-width:none;margin:0;padding:0;height:100%;display:flex;flex-direction:column}
.chat-scroll{flex:1;min-height:0;overflow:auto;padding:12px 24px 12px;scroll-behavior:smooth}
.log{max-width:820px;margin:0 auto;display:flex;flex-direction:column;gap:26px;padding-bottom:12px}
.dock{flex:none;padding:0 24px 16px;position:relative}
.dock-inner{max-width:820px;margin:0 auto;position:relative}
.stage-bg{display:none}
.chat.is-empty{justify-content:center}
.chat.is-empty .chat-scroll{display:none}
.chat.is-empty .stage-bg{display:block;position:absolute;inset:0;pointer-events:none;background:radial-gradient(900px 420px at 50% 112%,rgba(255,90,0,.13),transparent 62%),radial-gradient(600px 300px at 50% -10%,rgba(255,255,255,.035),transparent 70%)}
.chat.is-empty .dock{padding-bottom:max(12vh,48px)}
.chat:not(.is-empty) .hero,.chat:not(.is-empty) .suggest{display:none}
.hero{text-align:center;margin:0 auto 30px;position:relative;z-index:1;animation:rise .5s var(--ease-out) both}
.hero h2{font:650 clamp(30px,3.4vw,42px)/1.08 var(--display);letter-spacing:-.035em;margin:0;color:var(--ink);background:linear-gradient(180deg,#fff 0%,#e6dfd6 55%,#b5ab9f 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
html[data-theme="system"] .hero h2{-webkit-text-fill-color:currentColor;background:none}
.hero p{color:var(--muted);margin:12px 0 0;font-size:15.5px}
.hero-mark{position:relative;width:118px;height:118px;margin:0 auto 26px;perspective:560px}
.hero-glow{position:absolute;inset:-70px;border-radius:50%;background:radial-gradient(circle,rgba(255,106,26,.22) 0%,rgba(255,90,0,.06) 40%,transparent 68%)}
.orbit{position:absolute;inset:0;border-radius:50%;border:1px solid rgba(255,138,61,.34);transform:rotateX(72deg);animation:orbit-a 16s linear infinite}
.orbit.o2{inset:14px;border-color:rgba(255,255,255,.14);animation:orbit-b 24s linear infinite}
.orbit.o3{inset:-16px;border-color:rgba(255,106,26,.16);animation:orbit-c 32s linear infinite}
.orbit::after{content:"";position:absolute;top:-3px;left:50%;width:6px;height:6px;margin-left:-3px;border-radius:50%;background:var(--o-hot);box-shadow:0 0 10px 2px rgba(255,122,40,.8)}
.orbit.o2::after{background:#fff;box-shadow:0 0 8px rgba(255,255,255,.7);width:4px;height:4px;margin-left:-2px}
.hero-core{position:absolute;inset:22px}
.flow{stroke-dasharray:5 9;animation:flow 2.6s linear infinite}
@keyframes orbit-a{from{transform:rotateX(72deg) rotateZ(0)}to{transform:rotateX(72deg) rotateZ(360deg)}}
@keyframes orbit-b{from{transform:rotateX(66deg) rotateY(18deg) rotateZ(360deg)}to{transform:rotateX(66deg) rotateY(18deg) rotateZ(0)}}
@keyframes orbit-c{from{transform:rotateX(78deg) rotateY(-12deg) rotateZ(0)}to{transform:rotateX(78deg) rotateY(-12deg) rotateZ(360deg)}}
@keyframes flow{to{stroke-dashoffset:-56}}
@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
body.paused .orbit,body.paused .flow{animation-play-state:paused}
.suggest{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:18px;position:relative;z-index:1;animation:rise .6s .08s var(--ease-out) both}
.chip-btn{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px;border-radius:999px;border:1px solid var(--line-2);background:rgba(255,255,255,.02);color:var(--ink-2);font:500 13.5px/1 var(--font);cursor:pointer;transition:border-color .2s,color .2s,background .2s,transform .12s}
.chip-btn:hover{border-color:var(--o-line);color:var(--ink);background:rgba(255,106,26,.06)}.chip-btn:active{transform:scale(.97)}
.chip-btn .i{width:16px;height:16px;color:var(--o-hot)}
.setup{max-width:640px;margin:0 auto 18px;padding:18px 20px;border-radius:var(--r-lg);border:1px solid var(--line-2);background:linear-gradient(180deg,var(--b3),var(--b2));position:relative;z-index:1}
.setup h3{margin:0 0 6px;font:600 16px/1.3 var(--display)}
.setup p{margin:0 0 14px;color:var(--ink-2);font-size:14px}
.setup .row{gap:8px}

/* Composer */
.composer{position:relative;z-index:2;background:linear-gradient(180deg,var(--b4) 0%,var(--b3) 100%);border:1px solid var(--line-2);border-radius:var(--r-xl);box-shadow:0 1px 0 rgba(255,255,255,.055) inset,0 -1px 0 rgba(0,0,0,.4) inset,0 22px 60px -24px rgba(0,0,0,.9);transition:border-color .22s var(--ease),box-shadow .22s var(--ease)}
.composer:hover{border-color:var(--line-3)}
.composer:focus-within{border-color:var(--o-line);box-shadow:0 1px 0 rgba(255,255,255,.06) inset,0 0 0 4px rgba(255,106,26,.08),0 22px 70px -22px rgba(255,90,0,.3)}
.composer textarea{display:block;width:100%;background:transparent;border:0;outline:0;resize:none;color:var(--ink);font:16px/1.55 var(--font);padding:16px 18px 4px 18px;min-height:30px;max-height:384px;overflow-y:auto}
.composer textarea::placeholder{color:var(--muted)}
.composer-bar{display:flex;align-items:center;gap:4px;padding:8px 10px 10px}
.composer-bar .left{display:flex;align-items:center;gap:4px;flex:1;min-width:0;flex-wrap:wrap}
.composer-bar .right{display:flex;align-items:center;gap:6px}
.tool{position:relative;display:inline-flex;align-items:center;gap:7px;height:34px;min-width:34px;justify-content:center;padding:0 10px;border-radius:11px;border:1px solid transparent;background:transparent;color:var(--ink-2);font:500 13px/1 var(--font);cursor:pointer;transition:background .15s,color .15s,border-color .15s,transform .12s}
.tool:hover{background:var(--b5);color:var(--ink)}.tool:active{transform:scale(.95)}
.tool.icon-only{padding:0;width:34px}
.tool[aria-pressed="true"]{color:var(--o-hot);background:var(--o-soft);border-color:var(--o-line)}
.tool .i{width:17px;height:17px}
.model-btn{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 10px 0 11px;border-radius:11px;border:1px solid var(--line);background:rgba(255,255,255,.02);color:var(--ink);font:550 13px/1 var(--font);cursor:pointer;max-width:260px;transition:border-color .15s,background .15s}
.model-btn:hover,.model-btn[aria-expanded="true"]{border-color:var(--line-3);background:var(--b5)}
.model-btn .name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.model-btn .chev{width:15px;height:15px;color:var(--muted);transition:transform .2s var(--ease)}.model-btn[aria-expanded="true"] .chev{transform:rotate(180deg)}
.fury-dot{width:16px;height:16px;flex:none;border-radius:50%;background:radial-gradient(circle at 40% 35%,#ffd4b0 0%,var(--o-hot) 35%,var(--o-deep) 75%,#5a1a00 100%);box-shadow:0 0 10px rgba(255,106,26,.55)}
.fury-dot.local{background:radial-gradient(circle at 40% 35%,#f4f1ec 0%,#9a938a 60%,#3a3833 100%);box-shadow:none}
.send{display:inline-grid;place-items:center;width:38px;height:38px;border-radius:13px;border:0;cursor:pointer;background:linear-gradient(180deg,#ffa05c 0%,var(--o-core) 55%,#f25500 100%);color:#1b0900;box-shadow:0 1px 0 rgba(255,220,190,.55) inset,0 0 0 1px rgba(255,140,60,.45),0 8px 22px -8px rgba(255,90,0,.8);transition:transform .12s var(--ease),box-shadow .2s,filter .2s}
.send:hover{filter:brightness(1.06)}.send:active{transform:scale(.93)}
.send:disabled{cursor:not-allowed;background:var(--b5);color:var(--faint);box-shadow:none}
.send .i{width:18px;height:18px;stroke-width:2.2}
.send.stop{background:var(--ink);color:var(--b0);box-shadow:0 0 0 1px var(--line-3)}
.attach-tray{display:flex;gap:10px;overflow-x:auto;padding:12px 14px 2px}
.att{position:relative;flex:none;width:118px;height:92px;border-radius:14px;border:1px solid var(--line-2);background:linear-gradient(180deg,var(--b3),var(--b2));padding:10px;display:flex;flex-direction:column;justify-content:space-between;animation:att-in .22s var(--ease-out) both}
.att:hover{border-color:var(--line-3)}
.att .kind{display:flex;align-items:center;gap:6px;color:var(--muted);font:700 9.5px/1 var(--font);letter-spacing:.08em;text-transform:uppercase}
.att .kind .i{width:15px;height:15px;color:var(--o-hot)}
.att .nm{font:550 12px/1.25 var(--font);color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.att .sz{font-size:10.5px;color:var(--muted)}
.att .snip{font:10px/1.4 var(--mono);color:var(--muted);overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;white-space:pre-wrap;word-break:break-word}
.att .tag{align-self:flex-start;font:700 9px/1 var(--font);letter-spacing:.09em;text-transform:uppercase;border:1px solid var(--line-2);border-radius:5px;padding:3px 5px;color:var(--ink-2)}
.att .rm{position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:50%;border:1px solid var(--line-2);background:var(--b1);color:var(--ink-2);display:grid;place-items:center;cursor:pointer;opacity:0;transition:opacity .15s}
.att:hover .rm,.att .rm:focus-visible{opacity:1}.att .rm .i{width:12px;height:12px}
.drop{position:absolute;inset:0;border-radius:var(--r-xl);border:1.5px dashed rgba(255,138,61,.75);background:rgba(8,8,10,.88);display:grid;place-items:center;text-align:center;color:var(--o-hot);font:600 14px/1.4 var(--font);z-index:5;backdrop-filter:blur(4px)}
.dock-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:30px;padding:8px 6px 0;flex-wrap:wrap}
.route-chip{display:inline-flex;align-items:center;gap:8px;height:28px;padding:0 10px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--ink-2);font:500 12.5px/1 var(--font);cursor:pointer;max-width:100%}
.route-chip:hover{border-color:var(--o-line);color:var(--ink)}
.route-chip .i{width:14px;height:14px;color:var(--o-hot)}
.route-chip .sep{color:var(--faint)}
.disclaimer{color:var(--muted);font-size:12px;margin-left:auto}
.stage-line{display:inline-flex;align-items:center;gap:9px;color:var(--ink-2);font-size:12.5px}
.pulse{position:relative;width:34px;height:2px;border-radius:2px;background:linear-gradient(90deg,transparent,var(--o-hot),transparent);background-size:200% 100%;animation:pulse 1.1s linear infinite}
@keyframes pulse{from{background-position:100% 0}to{background-position:-100% 0}}
@keyframes att-in{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}

/* Messages */
.msg{display:flex;flex-direction:column;gap:8px;animation:msg-in .32s var(--ease-out) both;min-width:0}
@keyframes msg-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.msg.user{align-self:flex-end;max-width:min(82%,660px);background:linear-gradient(180deg,var(--b4),var(--b3));border:1px solid var(--line-2);border-radius:20px 20px 6px 20px;padding:11px 16px;box-shadow:0 10px 30px -22px rgba(0,0,0,.9)}
.msg.user .who{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
.msg.user .body{white-space:pre-wrap;word-break:break-word}
.msg .who{display:flex;align-items:center;gap:8px;color:var(--muted);font:550 12.5px/1 var(--font)}
.msg .who .fury-dot{width:14px;height:14px}
.msg .body{font-size:15.5px;line-height:1.7;color:var(--ink);min-width:0;overflow-wrap:anywhere}
.msg .body p{margin:0 0 .85em}.msg .body p:last-child{margin-bottom:0}
.msg .body code{font:13.5px/1.5 var(--mono);background:var(--b4);border:1px solid var(--line);border-radius:6px;padding:1px 5px}
.msg .body strong{font-weight:650;color:#fff}
.att-chips{display:flex;flex-wrap:wrap;gap:6px}
.att-chip{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:999px;border:1px solid var(--line-2);color:var(--ink-2);font-size:12px}
.att-chip .i{width:13px;height:13px;color:var(--o-hot)}
.code-block{border:1px solid var(--line-2);border-radius:14px;background:#08080a;overflow:hidden;margin:.3em 0 1em}
.code-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px 6px 14px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,var(--b3),var(--b2));color:var(--muted);font:600 11.5px/1 var(--mono);text-transform:lowercase}
.code-block pre{margin:0;padding:14px 16px;overflow:auto;font:13.5px/1.65 var(--mono);color:#ece6de;tab-size:2}
.msg-actions{display:flex;flex-wrap:wrap;gap:2px;opacity:0;transition:opacity .2s}
.msg:hover .msg-actions,.msg:focus-within .msg-actions,.msg.last .msg-actions{opacity:1}
.ghost{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 9px;border-radius:9px;border:0;background:transparent;color:var(--muted);font:500 12.5px/1 var(--font);cursor:pointer;transition:background .15s,color .15s}
.ghost:hover{background:var(--b4);color:var(--ink)}.ghost .i{width:15px;height:15px}
.ghost.done{color:var(--ok)}
.caret{display:inline-block;width:8px;height:1.05em;margin-left:2px;vertical-align:-3px;border-radius:2px;background:var(--o-hot);box-shadow:0 0 10px rgba(255,106,26,.7);animation:blink 1s steps(2,start) infinite}
@keyframes blink{to{visibility:hidden}}
.activity{display:flex;flex-direction:column;gap:4px;align-self:stretch}
.activity details{border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.012)}
.activity summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:9px;padding:8px 12px;color:var(--ink-2);font-size:13px}
.activity summary::-webkit-details-marker{display:none}
.activity summary .i{width:15px;height:15px;color:var(--o-hot)}
.activity .detail{padding:0 12px 10px 36px;color:var(--muted);font-size:12.5px;white-space:pre-wrap;word-break:break-word}
.err{border:1px solid rgba(255,107,107,.3);background:rgba(255,107,107,.06);border-radius:14px;padding:12px 14px;color:var(--ink)}
.err p{margin:0 0 8px}

/* Popovers, menus, palette */
.pop{position:fixed;z-index:60;min-width:300px;max-width:min(380px,calc(100vw - 24px));background:rgba(17,17,21,.97);border:1px solid var(--line-2);border-radius:16px;box-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 28px 70px -14px rgba(0,0,0,.9),0 0 0 1px rgba(0,0,0,.5);padding:6px;animation:pop-in .16s var(--ease-out) both;backdrop-filter:blur(18px)}
html[data-theme="system"] .pop{background:var(--b2)}
@keyframes pop-in{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
.pop input[type=search]{width:100%;height:38px;margin:2px 0 6px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:var(--b1);color:var(--ink);font:inherit;font-size:14px;outline:none}
.pop input[type=search]:focus{border-color:var(--o-line)}
.pop-h{font:650 10.5px/1 var(--font);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding:10px 12px 6px}
.opt{display:flex;align-items:flex-start;gap:10px;width:100%;text-align:left;padding:9px 11px;border-radius:11px;border:0;background:transparent;color:var(--ink);cursor:pointer;font:inherit}
.opt:hover,.opt:focus-visible,.opt.active{background:var(--b4);outline:none}
.opt .t{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.opt .n{font:600 13.5px/1.2 var(--font);display:flex;align-items:center;gap:7px}
.opt .d{font-size:12px;color:var(--muted);line-height:1.35}
.opt .ck{width:16px;height:16px;color:var(--o-hot);visibility:hidden;margin-top:2px}.opt[aria-selected="true"] .ck,.opt[aria-checked="true"] .ck{visibility:visible}
.opt a{color:var(--o-hot)}
a.opt{text-decoration:none}
.fit{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:5px;font:700 9.5px/1 var(--font);letter-spacing:.05em;border:1px solid currentColor}
.fit.ok{color:var(--ok)}.fit.warn{color:var(--warn)}.fit.bad{color:var(--bad)}.fit.muted{color:var(--muted)}
.route-pop dl{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;margin:6px 10px 10px;font-size:13px}
.route-pop dt{color:var(--muted)}.route-pop dd{margin:0;color:var(--ink)}
.route-pop h3{margin:8px 10px 4px;font:650 14px/1.3 var(--display);display:flex;align-items:center;gap:8px}
.route-pop .why{margin:8px 10px 10px;padding:10px 12px;border-radius:10px;background:var(--o-soft);border:1px solid var(--o-line);font-size:13px;color:var(--ink)}
.overlay{position:fixed;inset:0;z-index:70;display:grid;place-items:start center;padding-top:14vh;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);animation:fade .15s ease both}
@keyframes fade{from{opacity:0}to{opacity:1}}
.palette{width:min(640px,calc(100vw - 32px));background:rgba(15,15,18,.98);border:1px solid var(--line-2);border-radius:18px;box-shadow:0 40px 120px -20px rgba(0,0,0,.95),0 0 0 1px rgba(255,106,26,.08);overflow:hidden;animation:pop-in .18s var(--ease-out) both}
html[data-theme="system"] .palette{background:var(--b2)}
.palette-in{display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:1px solid var(--line)}
.palette-in .i{color:var(--muted)}
.palette-in input{flex:1;height:56px;border:0;outline:0;background:transparent;color:var(--ink);font:16px/1 var(--font)}
.palette ul{list-style:none;margin:0;padding:6px;max-height:min(420px,56vh);overflow:auto}
.palette li{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:11px;color:var(--ink-2);cursor:pointer;font-size:14px}
.palette li .i{color:var(--muted)}
.palette li[aria-selected="true"]{background:var(--b4);color:var(--ink)}.palette li[aria-selected="true"] .i{color:var(--o-hot)}
.palette li small{margin-left:auto;color:var(--muted);font-size:12px}
.palette .p-empty{padding:18px;color:var(--muted);font-size:13.5px}
.menu{min-width:250px}

/* ---------- Pages ---------- */
.card{background:linear-gradient(180deg,var(--b2),var(--b1));border:1px solid var(--line);border-radius:var(--r-lg);padding:20px 22px;margin-bottom:16px;box-shadow:0 1px 0 rgba(255,255,255,.03) inset;min-width:0;overflow-x:auto}
.card h2{font:650 15px/1.3 var(--display);margin:0 0 14px;letter-spacing:-.01em}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr))}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{text-align:left;padding:10px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font:600 11px/1.2 var(--font);letter-spacing:.07em;text-transform:uppercase}
tbody tr{transition:background .15s}tbody tr:hover{background:rgba(255,255,255,.015)}
.badge{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font:600 11.5px/1 var(--font);border:1px solid currentColor;white-space:nowrap}
.badge.ok{color:var(--ok);background:rgba(95,217,154,.07);border-color:rgba(95,217,154,.28)}
.badge.warn{color:var(--warn);background:rgba(245,181,71,.07);border-color:rgba(245,181,71,.28)}
.badge.bad{color:var(--bad);background:rgba(255,107,107,.07);border-color:rgba(255,107,107,.3)}
.badge.muted{color:var(--muted);border-color:var(--line-2)}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.muted{color:var(--muted)}
button,select,textarea,input{font:inherit;color:inherit}
main button:not(.ghost):not(.chip-btn):not(.tool):not(.send):not(.model-btn):not(.route-chip):not(.opt):not(.linkish):not(.icon-btn):not(.seg-btn){display:inline-flex;align-items:center;justify-content:center;gap:8px;height:38px;padding:0 16px;border-radius:11px;border:1px solid rgba(255,140,60,.45);background:linear-gradient(180deg,#ff8f45,var(--o-core));color:#1b0900;font:650 13.5px/1 var(--font);cursor:pointer;box-shadow:0 1px 0 rgba(255,220,190,.5) inset,0 8px 20px -10px rgba(255,90,0,.7);transition:transform .12s var(--ease),filter .2s}
main button:not(.ghost):not(.chip-btn):not(.tool):not(.send):not(.model-btn):not(.route-chip):not(.opt):not(.linkish):not(.icon-btn):not(.seg-btn):hover{filter:brightness(1.06)}
main button:active{transform:scale(.97)}
main button.secondary{background:var(--b4)!important;color:var(--ink)!important;border:1px solid var(--line-2)!important;box-shadow:0 1px 0 rgba(255,255,255,.04) inset!important}
main button.secondary:hover{border-color:var(--line-3)!important}
main button[disabled]{opacity:.5;cursor:not-allowed}
.btn{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 16px;border-radius:11px;text-decoration:none;font:600 13.5px/1 var(--font);border:1px solid var(--line-2);background:var(--b4);color:var(--ink)}
.btn:hover{border-color:var(--line-3)}.btn.primary{border-color:rgba(255,140,60,.45);background:linear-gradient(180deg,#ff8f45,var(--o-core));color:#1b0900}
select,input:not([type=checkbox]):not([type=radio]):not([type=search]),textarea{background:var(--b1);border:1px solid var(--line-2);border-radius:11px;padding:9px 12px;color:var(--ink);transition:border-color .15s,box-shadow .15s}
select:focus,input:focus,textarea:focus{outline:none;border-color:var(--o-line);box-shadow:0 0 0 3px rgba(255,106,26,.1)}
select{appearance:none;-webkit-appearance:none;padding-right:34px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238b857c' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;cursor:pointer}
input[type=checkbox],input[type=radio]{accent-color:var(--o-core);width:16px;height:16px;vertical-align:-3px;margin-right:6px}
main textarea{width:100%;min-height:96px;resize:vertical}
textarea.code{font:13px/1.6 var(--mono);min-height:260px}
label{display:block;font:600 12.5px/1.4 var(--font);color:var(--ink-2);margin:0 0 6px}
fieldset{border:1px solid var(--line);border-radius:var(--r-md);padding:12px 14px;margin:14px 0}
legend{padding:0 6px;font-size:12.5px}
.row{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin-top:12px}
.empty{border:1px dashed var(--line-2);border-radius:var(--r-md);padding:18px;color:var(--muted)}
.status{min-height:1.5em;color:var(--ink-2);font-size:13.5px}
ul.reasons{margin:8px 0 0;padding-left:18px;color:var(--ink-2)}
pre{font:13px/1.6 var(--mono)}
.tree{list-style:none;margin:0;padding:0;max-height:42vh;overflow:auto}
.code-view{max-height:52vh;overflow:auto;white-space:pre;font:12.5px/1.6 var(--mono);background:#08080a;border:1px solid var(--line);border-radius:var(--r-md);padding:12px}
.code-view .add{color:var(--ok)}.code-view .del{color:var(--bad)}.code-view .hunk{color:var(--muted)}
.linkish{background:none;border:1px solid transparent;color:var(--ink-2);padding:4px 8px;border-radius:8px;cursor:pointer;font-size:13.5px}.linkish:hover{background:var(--b4);color:var(--ink)}
svg.flow{width:100%;height:auto;background:#07070a;border:1px solid var(--line);border-radius:var(--r-md)}
svg.flow .node rect{fill:var(--b3);stroke:var(--line-3);stroke-width:1.3}
svg.flow .node.agentic rect{stroke:var(--o-hot);stroke-dasharray:6 4;stroke-width:1.8}
svg.flow .node.critical rect{stroke-width:2.8}
svg.flow text{fill:var(--ink);font:12px var(--font)}svg.flow .zone{fill:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em}
svg.flow line{stroke:var(--faint);stroke-width:1.4}svg.flow .when{fill:var(--o-hot);font-size:11px}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--muted)}
details.adv{margin-top:18px;border:1px solid var(--line);border-radius:var(--r-lg);background:rgba(255,255,255,.01)}
details.adv>summary{cursor:pointer;padding:14px 18px;color:var(--ink-2);font-weight:550;list-style:none}
details.adv>summary::-webkit-details-marker{display:none}
details.adv>div{padding:0 18px 16px}
.sec-h{font:650 13px/1 var(--font);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:30px 0 12px}

/* Models */
.models-top{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:16px}
.hw-card .big{font:650 22px/1.2 var(--display);letter-spacing:-.02em;margin:2px 0 6px}
.hw-card .spec{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.spec span{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:9px;background:var(--b3);border:1px solid var(--line);font-size:12.5px;color:var(--ink-2)}
.auto-card{position:relative;overflow:hidden}
.auto-card::before{content:"";position:absolute;right:-60px;top:-60px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(255,106,26,.18),transparent 65%)}
.auto-card h2{display:flex;align-items:center;gap:10px}
.auto-card p{color:var(--ink-2);margin:0;max-width:52ch;position:relative}
.backend-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:14px}
.backend{border:1px solid var(--line);border-radius:var(--r-lg);background:linear-gradient(180deg,var(--b2),var(--b1));padding:16px 18px;display:flex;flex-direction:column;gap:10px;min-width:0}
.backend.up{border-color:rgba(95,217,154,.22)}
.backend-h{display:flex;align-items:center;gap:10px}
.backend-h b{font:650 15px/1.2 var(--display)}
.backend-h .state{margin-left:auto}
.dot{width:8px;height:8px;border-radius:50%;background:var(--faint);flex:none}.dot.on{background:var(--ok);box-shadow:0 0 10px rgba(95,217,154,.7)}
.backend p{margin:0;color:var(--muted);font-size:13px}
.model-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:var(--b3);border:1px solid var(--line);font-size:13px;min-width:0}
.model-row .mn{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.model-row .ms{color:var(--muted);font-size:12px;white-space:nowrap}
.model-row .fit{margin-left:auto}

/* Connections */
.connection-head{display:flex;align-items:center;justify-content:space-between;gap:20px}.connection-head h2,.privacy-note h2{margin:0 0 5px}.connection-head p,.privacy-note p{margin:0}.connection-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;margin:14px 0}.connection-card{position:relative;overflow:hidden}.connection-card::after{content:"";position:absolute;inset:auto -35% -65% 20%;height:100px;background:radial-gradient(circle,rgba(255,106,26,.10),transparent 68%);pointer-events:none}.connection-top{display:flex;align-items:center;gap:10px;margin-bottom:12px}.connection-top .i{color:var(--o-hot)}.connection-top b{font:600 15px/1.2 var(--display);margin-right:auto}.connection-meta{display:flex;flex-direction:column;gap:7px;color:var(--ink-2);font-size:13px}.connection-meta span{display:flex;align-items:flex-start;gap:7px}.connection-meta .i{width:15px;height:15px;margin-top:2px;color:var(--muted)}.privacy-note{margin-top:12px}
@media (max-width:640px){.connection-head{align-items:flex-start;flex-direction:column}.connection-head .btn{width:100%;justify-content:center}}

/* Settings */
.settings{display:grid;grid-template-columns:200px minmax(0,1fr);gap:28px;align-items:start}
.settings-nav{position:sticky;top:0;display:flex;flex-direction:column;gap:2px}
.settings-nav a{display:block;padding:8px 12px;border-radius:9px;color:var(--ink-2);text-decoration:none;font-size:14px}
.settings-nav a:hover{background:var(--b3);color:var(--ink)}
.set-group{margin-bottom:18px}
.set-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 20px;padding:14px 0;border-bottom:1px solid var(--line)}
.set-row:last-child{border-bottom:0}
.set-row .t b{display:block;font-weight:600;font-size:14px}.set-row .t span{color:var(--muted);font-size:13px}
.seg{display:inline-flex;padding:3px;border-radius:12px;background:var(--b1);border:1px solid var(--line-2);gap:2px;flex-wrap:nowrap;max-width:100%;overflow-x:auto}
.seg label{margin:0;position:relative}
.seg input{position:absolute;opacity:0;width:1px;height:1px}
.seg span{display:inline-flex;align-items:center;height:32px;padding:0 13px;border-radius:9px;color:var(--ink-2);font:550 13px/1 var(--font);cursor:pointer;transition:background .15s,color .15s}
.seg input:checked+span{background:linear-gradient(180deg,var(--b5),var(--b4));color:var(--ink);box-shadow:0 1px 0 rgba(255,255,255,.06) inset,0 0 0 1px var(--o-line)}
.seg input:focus-visible+span{outline:2px solid var(--o-hot);outline-offset:1px}
.card p{color:var(--ink-2)}

/* ---------- Responsive ---------- */
@media (max-width:1100px){.settings{grid-template-columns:1fr}.settings-nav{position:static;flex-direction:row;flex-wrap:wrap}}
@media (max-width:520px){.tool span{display:none}.tool{padding:0;width:34px}}
@media (max-width:860px){
  .app{grid-template-columns:minmax(0,1fr)}
  .side{position:fixed;z-index:80;top:0;bottom:0;left:0;width:min(300px,86vw);transform:translateX(-102%);transition:transform .26s var(--ease-out);box-shadow:30px 0 80px rgba(0,0,0,.6)}
  .app[data-drawer="open"] .side{transform:none}
  .app[data-drawer="open"] .scrim{display:block;position:fixed;inset:0;z-index:79;background:rgba(0,0,0,.5)}
  .app[data-collapsed="true"]{--side-w:272px}
  .desktop-only{display:none}.mobile-only{display:inline-grid}
  main>section{padding:8px 16px 40px}
  .chat-scroll{padding:8px 14px}.dock{padding:0 12px 12px}
  .hero-mark{width:92px;height:92px;margin-bottom:20px}
  .disclaimer{display:none}
  .model-btn{max-width:170px}
}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}}
html[data-motion="reduced"] *,html[data-motion="reduced"] *::before,html[data-motion="reduced"] *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}
`;

const SCRIPT = String.raw`
(() => {
  const ICONS = __ICONS__;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'text') n.textContent = v; else if (k === 'class') n.className = v; else n.setAttribute(k, v); } for (const k of kids) if (k !== null && k !== undefined && k !== false) n.append(k); return n; };
  const SVGNS = 'http://www.w3.org/2000/svg';
  const tpl = document.createElement('template');
  function ic(name, cls) { tpl.innerHTML = '<svg class="' + (cls || 'i') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>'; return tpl.content.firstChild; }
  const store = { get(k, d) { try { const v = localStorage.getItem('furypipe.studio.' + k); return v === null ? d : v; } catch { return d; } }, set(k, v) { try { localStorage.setItem('furypipe.studio.' + k, v); } catch {} } };
  const views = ['chat','cowork','code','agents','mission','automations','models','connections','runtimes','skills','mcp','knowledge','web','memory','integrations','settings'];
  const VIEW_TITLES = { chat: 'Chat', cowork: 'Cowork', code: 'Code', agents: 'Agents', mission: 'Mission Control', automations: 'Automations', models: 'Models', connections: 'Connections', runtimes: 'Runtimes', skills: 'Skills', mcp: 'MCP servers', knowledge: 'Knowledge', web: 'Web', memory: 'Memory', integrations: 'Integrations', settings: 'Settings' };
  const PROVIDER = { ollama: 'Ollama', lmstudio: 'LM Studio', llamacpp: 'llama.cpp', vllm: 'vLLM', sglang: 'SGLang', localai: 'LocalAI', jan: 'Jan', 'openai-compatible': 'OpenAI-compatible', 'anthropic-compatible': 'Anthropic-compatible' };
  const SETUP = { ollama: 'https://ollama.com/download', lmstudio: 'https://lmstudio.ai', llamacpp: 'https://github.com/ggml-org/llama.cpp', vllm: 'https://docs.vllm.ai', sglang: 'https://docs.sglang.ai', localai: 'https://localai.io', jan: 'https://jan.ai' };
  const state = { local: null, hw: null, harnesses: null, conv: null, pick: 'auto', lastRoute: null, files: [], pastes: [], web: false, kb: false, busy: null, activity: new Map() };
  /* ---------- Locale / i18n ---------- */
  const SUPPORTED_LANGUAGES = Object.freeze(['en', 'fr']);
  const FR = Object.freeze({
    'New chat': 'Nouvelle discussion',
    'Search': 'Rechercher',
    'Chat': 'Discussion',
    'Cowork': 'Travail',
    'Code': 'Code',
    'Agents': 'Agents',
    'Mission Control': 'Centre de contrôle',
    'Automations': 'Automatisations',
    'Knowledge': 'Connaissances',
    'Web': 'Web',
    'Memory': 'Mémoire',
    'Models': 'Modèles',
    'Runtimes': 'Runtimes',
    'Skills': 'Skills',
    'MCP servers': 'Serveurs MCP',
    'Integrations': 'Intégrations',
    'Settings': 'Paramètres',
    'Recent': 'RÉCENT',
    'Your conversations appear here.': 'Vos conversations apparaîtront ici.',
    'How can FuryPipe help?': 'Comment FuryPipe peut-il vous aider ?',
    'One workspace for every model, agent and tool, starting with the AI on this machine.': 'Un seul espace pour tous vos modèles, agents et outils, en commençant par l’IA de cette machine.',
    'Run AI privately on this PC': 'Exécuter une IA en privé sur ce PC',
    'No local model is running yet. Start one and FuryPipe finds it automatically, or use your cloud providers in the Gateway WebChat.': 'Aucun modèle local n’est lancé. Démarrez-en un et FuryPipe le détectera automatiquement, ou utilisez vos fournisseurs cloud via le Gateway WebChat.',
    'Set up Ollama': 'Configurer Ollama',
    'Get LM Studio': 'Installer LM Studio',
    'See what fits': 'Voir les modèles adaptés',
    'Use cloud AI': 'Utiliser une IA cloud',
    'Ask FuryPipe anything…': 'Demandez n’importe quoi à FuryPipe…',
    'Message': 'Message',
    'Attach text files': 'Joindre des fichiers texte',
    'Read the web pages you link': 'Lire les pages web que vous partagez',
    'Ground answers in your indexed project documents': 'Appuyer les réponses sur les documents indexés du projet',
    'Choose a model': 'Choisir un modèle',
    'Search models': 'Rechercher des modèles',
    'Research': 'Rechercher',
    'Create': 'Créer',
    'Work': 'Travailler',
    'AI can make mistakes. Check important information.': 'L’IA peut se tromper. Vérifiez les informations importantes.',
    'Simple': 'Simple',
    'Power': 'Avancé',
    'Engineer': 'Ingénieur',
    'Expert': 'Expert',
    'mode': 'mode',
    'Workspace mode': 'Mode de travail',
    'Collapse sidebar': 'Réduire la barre latérale',
    'Expand sidebar': 'Déployer la barre latérale',
    'Open sidebar': 'Ouvrir la barre latérale',
    'FuryPipe home': 'Accueil FuryPipe',
    'Search and commands (Ctrl K)': 'Recherche et commandes (Ctrl K)',
    'Private · on this PC': 'Privé · sur ce PC',
    'This conversation runs on your computer. Nothing is sent to a cloud provider.': 'Cette conversation s’exécute sur votre ordinateur. Rien n’est envoyé à un fournisseur cloud.',
    'Models': 'Modèles',
    'Fury Auto routes each message to the best model available. Local models keep everything on this computer; probes stay on loopback.': 'Fury Auto route chaque message vers le meilleur modèle disponible. Les modèles locaux gardent tout sur cet ordinateur et les sondes restent en loopback.',
    'Your machine': 'Votre machine',
    'Local runtimes': 'Runtimes locaux',
    'Cloud': 'Cloud',
    'Claude, GPT, Gemini and other cloud models run through the governed Gateway WebChat, using the providers and budgets you configured.': 'Claude, GPT, Gemini et les autres modèles cloud passent par le Gateway WebChat gouverné avec les fournisseurs et budgets que vous avez configurés.',
    'Open Gateway WebChat': 'Ouvrir le Gateway WebChat',
    'Advanced · endpoints': 'Avancé · endpoints',
    'Backend': 'Backend',
    'Endpoint': 'Endpoint',
    'State': 'État',
    'Model': 'Modèle',
    'Fit': 'Compatibilité',
    'Settings': 'Paramètres',
    'Connections': 'Connexions',
    'FuryPipe automatically detects AI runtimes and safe credential hints on this machine. It never reads browser cookies, OAuth stores or secret values.': 'FuryPipe détecte automatiquement les runtimes IA et les indices de configuration sûrs sur cette machine. Il ne lit jamais les cookies du navigateur, les stockages OAuth ni les valeurs secrètes.',
    'AI accounts & providers': 'Comptes IA et fournisseurs',
    'Detection is local and privacy-preserving. A detected runtime does not mean the account is authenticated.': 'La détection est locale et respecte la confidentialité. Un runtime détecté ne signifie pas que le compte est authentifié.',
    'Open cloud setup': 'Configurer le cloud',
    'Privacy boundary': 'Limite de confidentialité',
    'Browser sessions and other applications\' credential stores are never inspected automatically. FuryPipe only reports installed runtimes and the presence of supported environment credential sources; secret contents never leave the process.': 'Les sessions du navigateur et les stockages d’identifiants des autres applications ne sont jamais inspectés automatiquement. FuryPipe signale uniquement les runtimes installés et la présence de sources d’identifiants prises en charge dans l’environnement ; le contenu secret ne quitte jamais le processus.',
    'Credential configured': 'Identifiant configuré',
    'Runtime detected': 'Runtime détecté',
    'Not detected': 'Non détecté',
    'Credential source': 'Source d’identifiant',
    'Installed runtime': 'Runtime installé',
    'Sign-in state is not inspected': 'L’état de connexion n’est pas inspecté',
    'No runtime or credential source detected': 'Aucun runtime ni source d’identifiant détecté',
    'Automatic detection completed. Secret values and browser sessions were not inspected.': 'Détection automatique terminée. Les valeurs secrètes et les sessions du navigateur n’ont pas été inspectées.',
    'Settings': 'Paramètres',
    'Make FuryPipe yours. Preferences are stored in this browser.': 'Personnalisez FuryPipe. Les préférences sont stockées dans ce navigateur.',
    'General': 'Général',
    'Appearance': 'Apparence',
    'Privacy': 'Confidentialité',
    'Advanced': 'Avancé',
    'Language': 'Langue',
    'Automatically follows your browser language. You can override it here.': 'Suit automatiquement la langue de votre navigateur. Vous pouvez la remplacer ici.',
    'Auto': 'Auto',
    'English': 'English',
    'French': 'Français',
    'Theme': 'Thème',
    'Dark': 'Sombre',
    'System': 'Système',
    'Dark is the signature FuryPipe look. System follows your OS.': 'Le thème sombre est l’identité visuelle FuryPipe. Système suit le réglage de votre OS.',
    'Motion': 'Animations',
    'Reduce animation everywhere.': 'Réduire les animations dans toute l’interface.',
    'Reduced': 'Réduites',
    'Density': 'Densité',
    'Spacing around pages.': 'Espacement général de l’interface.',
    'Comfortable': 'Confortable',
    'Compact': 'Compacte',
    'How much of FuryPipe\\'s control plane you see. Power features are always one switch away.': 'Détermine la quantité de fonctions avancées FuryPipe affichées. Les fonctions puissantes restent accessibles en un clic.',
    'Studio chat runs on local models only: messages stay on this computer. Studio listens on loopback, accepts same-origin requests only, and never reads other tools\\' credentials. Cloud providers run through the governed Gateway with explicit budgets.': 'Le chat Studio utilise uniquement les modèles locaux : les messages restent sur cet ordinateur. Studio écoute uniquement en loopback, n’accepte que les requêtes same-origin et ne lit jamais les identifiants des autres outils. Les fournisseurs cloud passent par le Gateway gouverné avec des budgets explicites.',
    'Control Plane': 'Plan de contrôle',
    'Page not found': 'Page introuvable',
    'This Studio view does not exist.': 'Cette vue Studio n’existe pas.',
    'Go to Chat': 'Retourner au chat',
    'Rename': 'Renommer',
    'Delete': 'Supprimer',
    'Conversation options': 'Options de la conversation',
    'Search and commands': 'Recherche et commandes',
    'Search conversations, pages and commands…': 'Rechercher dans les conversations, pages et commandes…',
    'Results': 'Résultats',
    'No match.': 'Aucun résultat.',
    'Change model': 'Changer de modèle',
    'New chat': 'Nouvelle discussion',
    'On this machine': 'Sur cette machine',
    'No local model running': 'Aucun modèle local en cours',
    'Cloud models': 'Modèles cloud',
    'Why this route?': 'Pourquoi ce routage ?',
    'Provider': 'Fournisseur',
    'Runtime': 'Runtime',
    'Where': 'Emplacement',
    'Local, on this machine': 'Local, sur cette machine',
    'Messages never leave this computer': 'Les messages ne quittent jamais cet ordinateur',
    'Cost': 'Coût',
    '$0 (local inference)': '0 $ (inférence locale)',
    'Hardware fit': 'Compatibilité matérielle',
    'Tools': 'Outils',
    'Skills / MCP': 'Skills / MCP',
    'not used in chat': 'non utilisés dans le chat',
    'Chosen by': 'Choisi par',
    'Looking for local AI on this machine…': 'Recherche des IA locales sur cette machine…',
    'Start a local runtime to see which models fit.': 'Démarrez un runtime local pour voir quels modèles sont adaptés.',
    'Running': 'En cours',
    'Not running': 'Arrêté',
    'Start': 'Démarrer',
    'Actions': 'Actions',
    'Save': 'Enregistrer',
    'Search': 'Rechercher',
    'Question': 'Question',
    'Recall': 'Rappeler',
    'Remember': 'Mémoriser',
    'This project': 'Ce projet',
    'Me, everywhere': 'Moi, partout',
    'Folder inside this project': 'Dossier dans ce projet',
    'Index folder': 'Indexer le dossier',
    'Task': 'Tâche',
    'Any': 'Tous',
    'Preview selection': 'Prévisualiser la sélection',
    'Local': 'Local',
    'Private': 'Privé',
    'Installed': 'Installé',
    'Available': 'Disponible'
  });
  function detectedLanguage() {
    const langs = Array.isArray(navigator.languages) && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (const raw of langs) {
      const lang = String(raw || '').toLowerCase().split('-')[0];
      if (SUPPORTED_LANGUAGES.includes(lang)) return lang;
    }
    return 'en';
  }
  function languagePreference() {
    const saved = store.get('language', 'auto');
    return saved === 'auto' || SUPPORTED_LANGUAGES.includes(saved) ? saved : 'auto';
  }
  function currentLanguage() {
    const pref = languagePreference();
    return pref === 'auto' ? detectedLanguage() : pref;
  }
  let activeLanguage = currentLanguage();
  function translated(value) {
    return activeLanguage === 'fr' ? (FR[value] || value) : value;
  }
  function translateTextNode(node) {
    const raw = node.nodeValue || '';
    const value = raw.trim();
    if (!value) return;
    const parent = node.parentElement;
    if (parent && parent.closest('script,style,pre,code,textarea,.code')) return;
    const next = translated(value);
    if (next === value) return;
    const start = raw.match(/^\s*/u)?.[0] || '';
    const end = raw.match(/\s*$/u)?.[0] || '';
    node.nodeValue = start + next + end;
  }
  function translateDom(root = document) {
    if (activeLanguage === 'en') return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) translateTextNode(node);
    const elements = root.querySelectorAll ? root.querySelectorAll('[placeholder],[title],[aria-label]') : [];
    for (const node of elements) for (const attr of ['placeholder','title','aria-label']) {
      const value = node.getAttribute(attr);
      if (value && FR[value]) node.setAttribute(attr, FR[value]);
    }
  }
  function applyLanguage() {
    activeLanguage = currentLanguage();
    document.documentElement.lang = activeLanguage;
    for (const r of $('input[name="pref-language"]')) r.checked = r.value === languagePreference();
    translateDom(document);
  }
  async function getJson(url, init) {
    const res = await fetch(url, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body && body.error && body.error.message) || ('HTTP ' + res.status));
    return body;
  }
  const post = (url, payload) => getJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  function badge(text, cls) { return el('span', { class: 'badge ' + cls, text }); }
  const reduceMotion = () => document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Preferences ---------- */
  function applyPrefs() {
    const d = document.documentElement;
    d.dataset.theme = store.get('theme', 'dark'); d.dataset.motion = store.get('motion', 'system'); d.dataset.density = store.get('density', 'comfortable');
    for (const n of ['theme', 'motion', 'density']) for (const r of $$('input[name="pref-' + n + '"]')) r.checked = r.value === d.dataset[n];
  }
  for (const n of ['theme', 'motion', 'density']) for (const r of $('input[name="pref-' + n + '"]')) r.addEventListener('change', () => { store.set(n, r.value); applyPrefs(); });
  applyPrefs();
  for (const r of $('input[name="pref-language"]')) r.addEventListener('change', () => { store.set('language', r.value); location.reload(); });
  applyLanguage();
  const i18nObserver = new MutationObserver((records) => {
    if (activeLanguage === 'en') return;
    for (const record of records) {
      if (record.type === 'characterData') translateTextNode(record.target);
      for (const node of record.addedNodes) if (node.nodeType === Node.TEXT_NODE) translateTextNode(node); else if (node.nodeType === Node.ELEMENT_NODE) translateDom(node);
    }
  });
  i18nObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener('visibilitychange', () => document.body.classList.toggle('paused', document.hidden));

  /* ---------- Sidebar ---------- */
  const app = $('#app');
  function setCollapsed(v) { app.dataset.collapsed = String(v); store.set('sidebar', v ? 'collapsed' : 'open'); $('#side-collapse').setAttribute('aria-label', v ? 'Expand sidebar' : 'Collapse sidebar'); $('#side-collapse').setAttribute('aria-expanded', String(!v)); }
  setCollapsed(store.get('sidebar', 'open') === 'collapsed');
  $('#side-collapse').addEventListener('click', () => setCollapsed(app.dataset.collapsed !== 'true'));
  function setDrawer(open) { app.dataset.drawer = open ? 'open' : 'closed'; $('#side-open').setAttribute('aria-expanded', String(open)); if (open) $('#new-chat').focus(); }
  $('#side-open').addEventListener('click', () => setDrawer(true));
  $('#scrim').addEventListener('click', () => setDrawer(false));
  for (const a of $$('.side-nav a')) { a.addEventListener('click', () => setDrawer(false)); }

  /* ---------- Modes ---------- */
  const LEVELS = ['simple', 'power', 'engineer', 'expert'];
  const MODE_TEXT = { simple: 'Simple', power: 'Power', engineer: 'Engineer', expert: 'Expert' };
  function applyMode(mode) {
    if (!LEVELS.includes(mode)) mode = 'simple';
    document.body.dataset.mode = mode;
    const max = LEVELS.indexOf(mode);
    for (const li of $$('.side-nav li[data-level]')) li.hidden = LEVELS.indexOf(li.dataset.level) > max;
    $('#mode-label').textContent = MODE_TEXT[mode];
    for (const b of $$('#mode-menu [role=menuitemradio]')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
    for (const r of $$('input[name="pref-mode"]')) r.checked = r.value === mode;
    store.set('mode', mode);
  }
  applyMode(store.get('mode', 'simple'));
  for (const r of $$('input[name="pref-mode"]')) r.addEventListener('change', () => applyMode(r.value));

  /* ---------- Popovers ---------- */
  let openPop = null;
  function closePop(restore) { if (!openPop) return; const { pop, anchor } = openPop; pop.hidden = true; anchor.setAttribute('aria-expanded', 'false'); openPop = null; if (restore !== false) anchor.focus(); }
  function placePop(pop, anchor, align) {
    pop.hidden = false; const r = anchor.getBoundingClientRect(); const w = pop.offsetWidth; const h = pop.offsetHeight;
    let left = align === 'left' ? r.left : r.right - w; left = Math.max(12, Math.min(left, innerWidth - w - 12));
    let top = r.top - h - 8; if (top < 12) top = Math.min(r.bottom + 8, innerHeight - h - 12);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  function openPopover(pop, anchor, align) { if (openPop && openPop.pop === pop) { closePop(); return false; } closePop(false); openPop = { pop, anchor }; anchor.setAttribute('aria-expanded', 'true'); placePop(pop, anchor, align); return true; }
  document.addEventListener('mousedown', (e) => { if (openPop && !openPop.pop.contains(e.target) && !openPop.anchor.contains(e.target)) closePop(false); });
  addEventListener('resize', () => { if (openPop) placePop(openPop.pop, openPop.anchor, openPop.pop.dataset.align); });
  function menuKeys(container, selector) {
    container.addEventListener('keydown', (e) => {
      const items = $$(selector, container).filter(x => !x.hidden && x.offsetParent !== null); const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0] && items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1] && items[items.length - 1].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); closePop(); }
    });
  }
  $('#mode-button').addEventListener('click', () => { const m = $('#mode-menu'); m.dataset.align = 'left'; if (openPopover(m, $('#mode-button'), 'left')) { const c = $('#mode-menu [aria-checked=true]'); (c || $('#mode-menu [role=menuitemradio]')).focus(); } });
  for (const b of $$('#mode-menu [role=menuitemradio]')) b.addEventListener('click', () => { applyMode(b.dataset.mode); closePop(); });
  menuKeys($('#mode-menu'), '[role=menuitemradio]');

  /* ---------- Routing ---------- */
  let firstRoute = true;
  function show(name) {
    if (!views.includes(name)) name = 'notfound';
    for (const s of $$('main > section')) s.hidden = s.dataset.view !== name;
    for (const a of $$('.side-nav a[data-view]')) { if (a.dataset.view === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
    document.body.dataset.view = name;
    $('#top-title').textContent = name === 'chat' ? (state.conv && state.conv.title ? state.conv.title : '') : (VIEW_TITLES[name] || '');
    $('#privacy').hidden = name !== 'chat' || !state.lastRoute;
    const h = document.querySelector('main > section[data-view="' + name + '"] h1');
    if (h) {
      h.setAttribute('tabindex', '-1'); document.title = h.textContent + ' · FuryPipe Studio';
      // Focus moves to the view heading on in-app navigation only; on first
      // load the natural order keeps the skip link as the first tab stop.
      if (!firstRoute) h.focus({ preventScroll: true });
    }
    firstRoute = false;
    if (name === 'chat' || name === 'models') loadLocal();
    if (name === 'chat') autosize();
    if (name === 'connections') loadConnections();
    if (name === 'runtimes') loadHarnesses();
    if (name === 'skills') loadSkills();
    if (name === 'mcp') loadMcp();
    if (name === 'knowledge') loadKnowledge();
    if (name === 'memory') loadMemory();
    if (name === 'integrations') loadIntegrations();
    if (name === 'code') { loadGraph(); loadTree(''); loadWorktrees(); }
    if (name === 'mission') loadRuns();
    clearInterval(state.poll); if (name === 'mission') state.poll = setInterval(loadRuns, 2000);
  }
  function route() { show((location.hash.replace(/^#\/?/, '') || 'chat').split('/')[0]); }
  addEventListener('hashchange', route);

  /* ---------- Local models + Fury Auto ---------- */
  function candidates() {
    const out = [];
    for (const b of (state.local && state.local.backends) || []) if (b.reachable) for (const m of b.models) if (m.modality !== 'embeddings') out.push({ kind: b.kind, baseUrl: b.baseUrl, model: m.id, m });
    return out;
  }
  const FIT_SCORE = { FITS: 3, UNKNOWN: 2, MAY_BE_SLOW: 1, DOES_NOT_FIT: -9 };
  const CODEY = /\x60\x60\x60|\b(code|function|bug|error|stack ?trace|typescript|javascript|python|rust|golang|refactor|compile|regex|sql|api|class|script)\b/i;
  function autoRoute(text) {
    const c = candidates(); if (!c.length) return null;
    const codey = CODEY.test(text || '');
    let best = null; let bestScore = -Infinity;
    for (const x of c) {
      const coder = /coder|code/i.test(x.model);
      const s = (FIT_SCORE[x.m.fit] ?? 2) + (codey && coder ? 2 : 0) + (!codey && coder ? -0.5 : 0) + (x.m.sizeBytes ? Math.min(x.m.sizeBytes / 1e11, 0.5) : 0);
      if (s > bestScore) { bestScore = s; best = x; }
    }
    const fit = best.m.fit === 'FITS' ? 'fits your hardware' : best.m.fit === 'MAY_BE_SLOW' ? 'may be slow on your hardware' : 'hardware fit unknown';
    const reason = (codey ? 'Looks like a coding task, so a coding model is preferred. ' : 'General task, so the best-fitting general model is preferred. ') + best.model + ' ' + fit + ' and runs on this machine.';
    return { kind: best.kind, baseUrl: best.baseUrl, model: best.model, fit: best.m.fit, auto: true, reason, considered: c.length };
  }
  function currentRoute(text) {
    if (state.pick === 'auto') return autoRoute(text);
    const c = candidates().find(x => x.model === state.pick.model && x.baseUrl === state.pick.baseUrl);
    return c ? { kind: c.kind, baseUrl: c.baseUrl, model: c.model, fit: c.m.fit, auto: false, reason: 'You picked this model.', considered: candidates().length } : autoRoute(text);
  }
  function renderModelButton() {
    const dot = $('#model-button .fury-dot'); const name = $('#model-label');
    if (state.pick === 'auto') { dot.className = 'fury-dot'; name.textContent = 'Fury Auto'; }
    else { dot.className = 'fury-dot local'; name.textContent = state.pick.model; }
  }
  function renderRouteChip() {
    const r = state.lastRoute; const chip = $('#route-chip');
    if (!r) { chip.hidden = true; $('#privacy').hidden = true; return; }
    chip.hidden = false; chip.replaceChildren(ic('route'), el('span', { text: r.model }), el('span', { class: 'sep', text: '·' }), el('span', { text: PROVIDER[r.kind] || r.kind }), el('span', { class: 'sep', text: '·' }), el('span', { text: 'Local' }));
    chip.setAttribute('aria-label', 'Route: ' + r.model + ', ' + (PROVIDER[r.kind] || r.kind) + ', local. Why this route?');
    $('#privacy').hidden = document.body.dataset.view !== 'chat';
  }
  function fitPill(fit) { const cls = fit === 'FITS' ? 'ok' : fit === 'MAY_BE_SLOW' ? 'warn' : fit === 'DOES_NOT_FIT' ? 'bad' : 'muted'; return el('span', { class: 'fit ' + cls, text: fit === 'MAY_BE_SLOW' ? 'SLOW' : fit === 'DOES_NOT_FIT' ? 'TOO BIG' : (fit || 'UNKNOWN') }); }
  function buildModelList(filter) {
    const list = $('#model-list'); list.replaceChildren(); const q = (filter || '').toLowerCase();
    const opt = (id, name, desc, selected, extra, onPick) => {
      const b = el('button', { type: 'button', class: 'opt', role: 'option', 'aria-selected': String(selected), 'data-id': id });
      b.append(extra || el('span', { class: 'fury-dot' }), el('span', { class: 't' }, el('span', { class: 'n', text: name }), el('span', { class: 'd', text: desc })), ic('check', 'i ck'));
      b.addEventListener('click', () => { onPick(); closePop(); renderModelButton(); $('#chat-input').focus(); }); return b;
    };
    if (!q || 'fury auto'.includes(q)) list.append(opt('auto', 'Fury Auto', 'Picks the best model on this machine for each message', state.pick === 'auto', null, () => { state.pick = 'auto'; }));
    const c = candidates().filter(x => !q || x.model.toLowerCase().includes(q) || (PROVIDER[x.kind] || x.kind).toLowerCase().includes(q));
    if (c.length) {
      list.append(el('div', { class: 'pop-h', text: 'On this machine' }));
      for (const x of c) {
        const n = el('span', { class: 't' });
        const b = opt(x.baseUrl + '|' + x.model, x.model, [PROVIDER[x.kind] || x.kind, x.m.parameterSize, x.m.quantization].filter(Boolean).join(' · '), state.pick !== 'auto' && state.pick.model === x.model && state.pick.baseUrl === x.baseUrl, el('span', { class: 'fury-dot local' }), () => { state.pick = { kind: x.kind, baseUrl: x.baseUrl, model: x.model }; });
        b.querySelector('.n').append(fitPill(x.m.fit)); list.append(b); void n;
      }
    } else if (!q) list.append(el('div', { class: 'pop-h', text: 'No local model running' }));
    if (!q || 'cloud'.includes(q)) {
      list.append(el('div', { class: 'pop-h', text: 'Cloud' }));
      const a = el('a', { class: 'opt', href: '/gateway/webchat/', role: 'option', 'aria-selected': 'false' }, el('span', { class: 'fury-dot local' }), el('span', { class: 't' }, el('span', { class: 'n', text: 'Cloud models' }), el('span', { class: 'd', text: 'Claude, GPT, Gemini and others run in the governed Gateway WebChat with your providers' })), ic('chevron', 'i ck'));
      list.append(a);
    }
  }
  $('#model-button').addEventListener('click', () => { const p = $('#model-pop'); p.dataset.align = 'right'; $('#model-search').value = ''; buildModelList(''); if (openPopover(p, $('#model-button'), 'right')) $('#model-search').focus(); });
  $('#model-search').addEventListener('input', (e) => { buildModelList(e.target.value); placePop($('#model-pop'), $('#model-button'), 'right'); });
  $('#model-search').addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); const f = $('#model-list .opt'); f && f.focus(); } if (e.key === 'Escape') closePop(); });
  menuKeys($('#model-pop'), '.opt');
  $('#route-chip').addEventListener('click', () => {
    const r = state.lastRoute; if (!r) return; const p = $('#route-pop'); p.replaceChildren();
    p.append(el('h3', {}, ic('route'), el('span', { text: 'Why this route?' })));
    const dl = el('dl'); const row = (k, v) => dl.append(el('dt', { text: k }), el('dd', { text: v }));
    row('Model', r.model); row('Provider', PROVIDER[r.kind] || r.kind); row('Runtime', 'FuryPipe Native'); row('Where', 'Local, on this machine'); row('Privacy', 'Messages never leave this computer'); row('Cost', '$0 (local inference)'); row('Hardware fit', r.fit || 'unknown');
    row('Tools', [state.web ? 'Web' : '', state.kb ? 'Knowledge' : ''].filter(Boolean).join(', ') || 'none'); row('Skills / MCP', 'not used in chat'); row('Chosen by', r.auto ? 'Fury Auto (' + r.considered + ' model' + (r.considered === 1 ? '' : 's') + ' considered)' : 'You');
    p.append(dl, el('div', { class: 'why', text: r.reason }));
    p.dataset.align = 'left'; openPopover(p, $('#route-chip'), 'left');
  });
  $('#route-pop').addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });

  async function loadLocal() {
    const status = $('#models-status'); status.textContent = 'Looking for local AI on this machine…';
    try {
      const [local, hw] = await Promise.all([getJson('/api/studio/local.json'), getJson('/api/studio/hardware.json')]);
      state.local = local; state.hw = hw;
      renderModels(); renderChatAvailability();
    } catch (e) { status.textContent = 'Local discovery failed: ' + e.message; renderChatAvailability(); }
  }
  function renderChatAvailability() {
    const has = candidates().length > 0;
    $('#chat-empty').hidden = has || !state.local;
    $('#chat-send').disabled = !has || !hasDraft();
    if (state.pick !== 'auto' && !candidates().some(x => x.model === state.pick.model && x.baseUrl === state.pick.baseUrl)) state.pick = 'auto';
    renderModelButton();
  }
  function renderModels() {
    const hw = state.hw; const gib = (b) => Math.round(b / 1073741824);
    if (hw) {
      const gpu = hw.gpus.length ? hw.gpus[0] : null;
      $('#hw').textContent = gpu ? gpu.name : (hw.unifiedMemory ? 'Unified memory' : hw.cpuModel);
      const spec = $('#hw-spec'); spec.replaceChildren();
      if (gpu) spec.append(el('span', { text: gib(gpu.memoryBytes) + ' GB VRAM' }));
      spec.append(el('span', { text: gib(hw.totalMemoryBytes) + ' GB RAM' }), el('span', { text: hw.cpuCount + ' CPU threads' }));
      const fits = candidates().filter(x => x.m.fit === 'FITS').length;
      $('#hw-rec').textContent = candidates().length ? fits + ' of ' + candidates().length + ' local model' + (candidates().length === 1 ? '' : 's') + ' fit this machine comfortably.' : 'Start a local runtime to see which models fit.';
    }
    const grid = $('#backends'); grid.replaceChildren(); const table = $('#models-body'); table.replaceChildren();
    let models = 0;
    for (const b of (state.local && state.local.backends) || []) {
      const name = PROVIDER[b.kind] || b.kind;
      const card = el('div', { class: 'backend' + (b.reachable ? ' up' : '') });
      card.append(el('div', { class: 'backend-h' }, el('span', { class: 'dot' + (b.reachable ? ' on' : '') }), el('b', { text: name }), b.version ? el('span', { class: 'muted', text: 'v' + b.version }) : '', el('span', { class: 'state' }, b.reachable ? badge('Running', 'ok') : badge('Not running', 'muted'))));
      if (!b.reachable) {
        card.append(el('p', { text: 'Start ' + name + ' on this computer and FuryPipe will find it automatically.' }));
        if (SETUP[b.kind]) card.append(el('div', {}, el('a', { class: 'btn', href: SETUP[b.kind], target: '_blank', rel: 'noopener noreferrer', text: 'Set up ' + name })));
      } else if (!b.models.length) card.append(el('p', { text: 'Running, but no model is installed yet.' }));
      for (const m of b.models) { models++;
        const row = el('div', { class: 'model-row' }, el('span', { class: 'mn', text: m.id }), el('span', { class: 'ms', text: [m.parameterSize, m.quantization, m.modality === 'embeddings' ? 'embeddings' : ''].filter(Boolean).join(' · ') }), fitPill(m.fit));
        card.append(row);
        table.append(el('tr', {}, el('td', { text: name }), el('td', { text: b.baseUrl }), el('td', {}, badge('up', 'ok')), el('td', { text: m.id }), el('td', { text: m.fit })));
      }
      if (!b.reachable) table.append(el('tr', {}, el('td', { text: name }), el('td', { text: b.baseUrl }), el('td', {}, badge('offline', 'muted')), el('td', { text: '—' }), el('td', { text: '—' })));
      grid.append(card);
    }
    $('#models-status').textContent = models ? models + ' local model' + (models === 1 ? '' : 's') + ' available.' : 'No local model running yet.';
  }

  /* ---------- Composer ---------- */
  const input = $('#chat-input');
  function hasDraft() { return input.value.trim().length > 0 || state.files.length > 0 || state.pastes.length > 0; }
  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 384) + 'px'; $('#chat-send').disabled = !state.busy && (!hasDraft() || !candidates().length); }
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chat-form').requestSubmit(); } });
  const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const TEXTY = /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|ini|xml|html?|css|scss|js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|swift|sh|ps1|sql|log|env\.example)$/i;
  function renderTray() {
    const tray = $('#attach-tray'); tray.replaceChildren(); tray.hidden = !state.files.length && !state.pastes.length;
    for (const p of state.pastes) {
      const rm = el('button', { type: 'button', class: 'rm', 'aria-label': 'Remove pasted text' }, ic('x'));
      rm.addEventListener('click', () => { state.pastes = state.pastes.filter(x => x !== p); renderTray(); autosize(); input.focus(); });
      tray.append(el('div', { class: 'att pasted' }, el('div', { class: 'snip', text: p.text.slice(0, 240) }), el('span', { class: 'tag', text: 'Pasted · ' + p.text.length + ' chars' }), rm));
    }
    for (const f of state.files) {
      const rm = el('button', { type: 'button', class: 'rm', 'aria-label': 'Remove ' + f.name }, ic('x'));
      rm.addEventListener('click', () => { state.files = state.files.filter(x => x !== f); renderTray(); autosize(); input.focus(); });
      tray.append(el('div', { class: 'att' }, el('div', { class: 'kind' }, ic('file'), el('span', { text: (f.name.split('.').pop() || 'file').slice(0, 6) })), el('div', {}, el('div', { class: 'nm', text: f.name, title: f.name }), el('div', { class: 'sz', text: fmtSize(f.size) })), rm));
    }
  }
  async function addFiles(list) {
    for (const file of [...list]) {
      if (state.files.length >= 6) { setStatus('Up to 6 files per message.'); break; }
      if (!(file.type.startsWith('text/') || TEXTY.test(file.name) || file.type === 'application/json')) { setStatus(file.name + ': only text files can be attached to a local model for now.'); continue; }
      if (file.size > 256 * 1024) { setStatus(file.name + ' is larger than 256 KB.'); continue; }
      const text = await file.text(); if (text.includes('\u0000')) { setStatus(file.name + ' looks binary.'); continue; }
      state.files.push({ name: file.name, size: file.size, text });
    }
    renderTray(); autosize();
  }
  $('#attach-btn').addEventListener('click', () => $('#attach-input').click());
  $('#attach-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData && e.clipboardData.files || [])]; if (files.length) { e.preventDefault(); addFiles(files); return; }
    const text = e.clipboardData ? e.clipboardData.getData('text') : '';
    if (text.length > 300) { e.preventDefault(); state.pastes.push({ text: text.slice(0, 64000) }); renderTray(); autosize(); }
  });
  const composer = $('#composer'); let dragDepth = 0;
  composer.addEventListener('dragenter', (e) => { if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); dragDepth++; $('#drop').hidden = false; });
  composer.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  composer.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop').hidden = true; });
  composer.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('#drop').hidden = true; if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  for (const [id, key] of [['#tool-web', 'web'], ['#tool-kb', 'kb']]) $(id).addEventListener('click', () => { state[key] = !state[key]; $(id).setAttribute('aria-pressed', String(state[key])); });
  for (const b of $$('.chip-btn[data-prompt]')) b.addEventListener('click', () => { input.value = b.dataset.prompt; autosize(); input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
  function setStatus(text, stage) {
    const s = $('#chat-status'); s.replaceChildren();
    if (stage) s.append(el('span', { class: 'stage-line' }, el('span', { class: 'pulse', 'aria-hidden': 'true' }), el('span', { text })));
    else s.textContent = text || '';
  }

  /* ---------- Conversation ---------- */
  const CTX = '\n\n<<furypipe-context>>\n';
  function splitContext(content) { const i = content.indexOf(CTX); return i < 0 ? { text: content, ctx: '' } : { text: content.slice(0, i), ctx: content.slice(i + CTX.length) }; }
  function contextChips(ctx) {
    const chips = el('div', { class: 'att-chips' });
    for (const m of ctx.matchAll(/^\[(File|Pasted text|Web|Knowledge)(?::\s*([^\]\n]*))?\]/gm)) {
      const kind = m[1]; const label = kind === 'File' ? m[2] : kind === 'Web' ? (m[2] || 'web page') : kind === 'Knowledge' ? 'Project knowledge' : 'Pasted text';
      chips.append(el('span', { class: 'att-chip' }, ic(kind === 'Web' ? 'web' : kind === 'Knowledge' ? 'knowledge' : 'file'), el('span', { text: label })));
    }
    return chips.children.length ? chips : null;
  }
  function inline(node, text) {
    const re = /(\x60[^\x60\n]+\x60|\*\*[^*\n]+\*\*)/g; let last = 0; let m;
    while ((m = re.exec(text))) { if (m.index > last) node.append(text.slice(last, m.index)); const t = m[0]; node.append(t[0] === '\x60' ? el('code', { text: t.slice(1, -1) }) : el('strong', { text: t.slice(2, -2) })); last = m.index + t.length; }
    if (last < text.length) node.append(text.slice(last));
  }
  function codeBlock(lang, code) {
    const copy = el('button', { type: 'button', class: 'ghost', 'aria-label': 'Copy code' }, ic('copy'), el('span', { text: 'Copy' }));
    copy.addEventListener('click', () => copyText(code, copy));
    return el('div', { class: 'code-block' }, el('div', { class: 'code-head' }, el('span', { text: lang || 'text' }), copy), el('pre', {}, el('code', { text: code })));
  }
  function rich(container, text) {
    container.replaceChildren();
    const parts = text.split('\x60\x60\x60');
    parts.forEach((part, i) => {
      if (i % 2 === 1) { const nl = part.indexOf('\n'); const lang = nl > -1 ? part.slice(0, nl).trim() : ''; const code = nl > -1 ? part.slice(nl + 1) : part; container.append(codeBlock(lang, code.replace(/\n$/, ''))); return; }
      for (const para of part.split(/\n{2,}/)) { if (!para.trim()) continue; const p = el('p'); const lines = para.split('\n'); lines.forEach((ln, j) => { inline(p, ln); if (j < lines.length - 1) p.append(el('br')); }); container.append(p); }
    });
  }
  async function copyText(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch { const t = el('textarea'); t.value = text; document.body.append(t); t.select(); try { document.execCommand('copy'); } catch {} t.remove(); }
    const span = btn.querySelector('span'); const old = span ? span.textContent : ''; btn.classList.add('done'); if (span) span.textContent = 'Copied';
    setTimeout(() => { btn.classList.remove('done'); if (span) span.textContent = old; }, 1400);
  }
  function whoLabel(m) { return m.model ? m.model.model + ' · ' + m.model.kind + ' · ' + m.model.locality : 'assistant'; }
  function renderConversation() {
    const log = $('#chat-log'); log.replaceChildren();
    const msgs = state.conv ? state.conv.messages : [];
    $('#chat').classList.toggle('is-empty', !msgs.length);
    const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant');
    msgs.forEach((m, idx) => {
      if (m.role === 'user') {
        const { text, ctx } = splitContext(m.content);
        const box = el('div', { class: 'msg user' }, el('span', { class: 'who', text: 'You' }));
        const chips = ctx ? contextChips(ctx) : null; if (chips) box.append(chips);
        box.append(el('div', { class: 'body', text: text.trim() || '(attachments only)' }));
        log.append(box);
        const act = state.activity.get(idx); if (act) log.append(act);
        return;
      }
      const body = el('div', { class: 'body' }); rich(body, m.content || '');
      const box = el('div', { class: 'msg assistant' + (m === lastAssistant ? ' last' : '') }, el('div', { class: 'who' }, el('span', { class: 'fury-dot' + (m.model ? ' local' : '') }), el('span', { text: whoLabel(m) })), body);
      const acts = el('div', { class: 'msg-actions' });
      const cp = el('button', { type: 'button', class: 'ghost' }, ic('copy'), el('span', { text: 'Copy' })); cp.addEventListener('click', () => copyText(m.content, cp));
      const br = el('button', { type: 'button', class: 'ghost' }, ic('branch'), el('span', { text: 'Branch from here' })); br.addEventListener('click', () => branchAt(m.id));
      acts.append(cp, br);
      if (m === lastAssistant) { const rt = el('button', { type: 'button', class: 'ghost' }, ic('retry'), el('span', { text: 'Retry with selected model' })); rt.addEventListener('click', retryLast); acts.append(rt); }
      box.append(acts); log.append(box);
    });
    const sc = $('#chat-scroll'); sc.scrollTop = sc.scrollHeight;
    $('#top-title').textContent = document.body.dataset.view === 'chat' && state.conv && state.conv.title ? state.conv.title : (document.body.dataset.view === 'chat' ? '' : $('#top-title').textContent);
  }
  function morphToConversation() {
    // FLIP: the composer glides from the centred hero position to the bottom dock.
    const box = $('#composer'); const before = box.getBoundingClientRect();
    return () => { if (reduceMotion() || !box.animate) return; const after = box.getBoundingClientRect(); const dy = before.top - after.top; if (Math.abs(dy) > 4) box.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' }); };
  }
  async function loadConversations() {
    try { const r = await getJson('/api/studio/chats.json'); const ul = $('#chat-list'); ul.replaceChildren();
      if (!r.conversations.length) ul.append(el('li', { class: 'empty-note', text: 'Your conversations appear here.' }));
      for (const c of r.conversations.slice(0, 60)) {
        const li = el('li', { class: 'conv-item', 'data-current': String(!!(state.conv && state.conv.id === c.id)) });
        const b = el('button', { type: 'button', class: 'conv', title: c.title }, c.title); if (c.parentId) b.append(el('span', { class: 'branch-mark', 'aria-label': '(branch)', text: '↳' }));
        if (state.conv && state.conv.id === c.id) b.setAttribute('aria-current', 'true');
        b.addEventListener('click', async () => { state.conv = await post('/api/studio/chats/get', { id: c.id }); state.activity = new Map(); state.lastRoute = null; location.hash = '#/chat'; renderConversation(); renderRouteChip(); loadConversations(); });
        const more = el('button', { type: 'button', class: 'icon-btn conv-more', 'aria-label': 'Options for ' + c.title, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, ic('more'));
        more.addEventListener('click', () => { const menu = $('#conv-menu'); menu.dataset.id = c.id; menu.dataset.title = c.title; menu.dataset.align = 'left'; if (openPopover(menu, more, 'left')) $('#conv-menu [role=menuitem]').focus(); });
        li.append(b, more); ul.append(li);
      }
    } catch (e) { setStatus('Conversations unavailable: ' + e.message); }
  }
  menuKeys($('#conv-menu'), '[role=menuitem]');
  $('#conv-rename').addEventListener('click', () => {
    const id = $('#conv-menu').dataset.id; const title = $('#conv-menu').dataset.title; closePop(false);
    const li = [...$$('#chat-list .conv-item')].find(x => x.querySelector('.conv-more') && x.querySelector('.conv-more').getAttribute('aria-label') === 'Options for ' + title); if (!li) return;
    const inp = el('input', { class: 'conv-edit', 'aria-label': 'Conversation title', maxlength: '80' }); inp.value = title; li.replaceChildren(inp); inp.focus(); inp.select();
    let ended = false; const done = async (save) => { if (ended) return; ended = true; if (save && inp.value.trim() && inp.value.trim() !== title) { try { const c = await post('/api/studio/chats/get', { id }); await post('/api/studio/chats/save', { id, title: inp.value.trim(), messages: c.messages }); if (state.conv && state.conv.id === id) state.conv.title = inp.value.trim(); } catch (e) { setStatus(e.message); } } loadConversations(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true), { once: true });
  });
  $('#conv-delete').addEventListener('click', async () => {
    const id = $('#conv-menu').dataset.id; closePop(false);
    if (!confirm('Delete this conversation?')) return;
    try { await post('/api/studio/chats/delete', { id }); if (state.conv && state.conv.id === id) newChat(); loadConversations(); } catch (e) { setStatus(e.message); }
  });
  async function persist() {
    const saved = await post('/api/studio/chats/save', state.conv.id ? { id: state.conv.id, messages: state.conv.messages } : { messages: state.conv.messages });
    state.conv = saved; loadConversations();
  }
  function stopBtn(on) { const b = $('#chat-send'); b.classList.toggle('stop', on); b.replaceChildren(ic(on ? 'stop' : 'arrowUp')); b.setAttribute('aria-label', on ? 'Stop generating' : 'Send message'); b.type = on ? 'button' : 'submit'; b.disabled = on ? false : (!hasDraft() || !candidates().length); }
  $('#chat-send').addEventListener('click', (e) => { if (state.busy) { e.preventDefault(); state.busy.abort(); } });
  async function streamReply(route) {
    state.lastRoute = route; renderRouteChip();
    const reply = { role: 'assistant', content: '', model: { kind: route.kind, model: route.model, locality: 'local' } };
    const history = state.conv.messages.map(m => ({ role: m.role, content: m.content }));
    state.conv.messages.push(reply); renderConversation();
    const body = $('#chat-log').lastElementChild.querySelector('.body'); const caret = el('span', { class: 'caret', 'aria-hidden': 'true' }); body.replaceChildren(caret);
    const ctrl = new AbortController(); state.busy = ctrl; stopBtn(true);
    setStatus('Connecting to ' + route.model + '…', true);
    try {
      const res = await fetch('/api/studio/chat', { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: route.kind, baseUrl: route.baseUrl, model: route.model, messages: history }) });
      if (!res.ok || !res.body) { const b = await res.json().catch(() => ({})); throw new Error((b.error && b.error.message) || ('HTTP ' + res.status)); }
      setStatus(''); const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; const textNode = document.createTextNode(''); body.replaceChildren(textNode, caret);
      for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line.startsWith('data:')) continue; const p = line.slice(5).trim(); if (p === '[DONE]') continue;
          try { const d = JSON.parse(p).choices[0].delta.content; if (typeof d === 'string') { reply.content += d; textNode.data = reply.content; const sc = $('#chat-scroll'); if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160) sc.scrollTop = sc.scrollHeight; } } catch {} } }
      await persist(); renderConversation(); setStatus('');
    } catch (e) {
      if (e.name === 'AbortError') { if (reply.content) { reply.content += '\n\n_(stopped)_'; await persist().catch(() => {}); } else state.conv.messages.pop(); renderConversation(); setStatus('Stopped.'); }
      else { state.conv.messages.pop(); renderConversation(); showError(e.message, route); }
    } finally { state.busy = null; stopBtn(false); input.focus(); }
  }
  function showError(message, route) {
    const retry = el('button', { type: 'button', class: 'ghost' }, ic('retry'), el('span', { text: 'Retry' }));
    const other = el('button', { type: 'button', class: 'ghost' }, ic('models'), el('span', { text: 'Use another model' }));
    const box = el('div', { class: 'err', role: 'alert' }, el('p', { text: route.model + ' did not answer: ' + message }), el('div', { class: 'msg-actions' }, retry, other));
    box.querySelector('.msg-actions').style.opacity = '1';
    retry.addEventListener('click', () => { box.remove(); streamReply(route); });
    other.addEventListener('click', () => $('#model-button').click());
    $('#chat-log').append(box); setStatus('');
  }
  async function gatherContext(text) {
    const parts = []; const acts = [];
    for (const f of state.files) parts.push('[File: ' + f.name + ']\n' + f.text);
    for (const p of state.pastes) parts.push('[Pasted text]\n' + p.text);
    if (state.web) {
      const urls = [...new Set((text.match(/https?:\/\/[^\s<>()\]]+/g) || []).slice(0, 3))];
      if (!urls.length) acts.push({ icon: 'web', label: 'Web is on, but the message has no link to read', detail: 'FuryPipe reads the pages you link. Web search needs a local SearXNG endpoint.' });
      for (const url of urls) { setStatus('Reading ' + url + '…', true);
        try { const r = await post('/api/studio/web', { action: 'FETCH', url }); parts.push('[Web: ' + r.url + '] ' + (r.title || '') + '\n' + String(r.text || '').slice(0, 6000)); acts.push({ icon: 'web', label: 'Read ' + (r.title || r.url), detail: r.url + ' · ' + r.bytes + ' bytes · receipt ' + (r.receiptId || 'n/a') }); }
        catch (e) { acts.push({ icon: 'web', label: 'Could not read ' + url, detail: e.message }); } }
    }
    if (state.kb && text.trim()) { setStatus('Searching project knowledge…', true);
      try { const r = await post('/api/studio/knowledge/search', { query: text.slice(0, 1000), limit: 5 });
        if (r.hits.length) { parts.push('[Knowledge]\nAnswer using these sources when relevant and cite them as [n].\n' + r.hits.map((h, i) => '[' + (i + 1) + '] ' + h.citation + '\n' + h.snippet).join('\n\n')); acts.push({ icon: 'knowledge', label: 'Found ' + r.hits.length + ' passage' + (r.hits.length === 1 ? '' : 's') + ' in project knowledge', detail: r.hits.map(h => h.citation).join('\n') }); }
        else acts.push({ icon: 'knowledge', label: 'No matching passage in project knowledge', detail: 'Index a folder in Knowledge to ground answers in your documents.' }); }
      catch (e) { acts.push({ icon: 'knowledge', label: 'Knowledge unavailable', detail: e.message }); } }
    setStatus('');
    return { content: text + (parts.length ? CTX + parts.join('\n\n') : ''), acts };
  }
  function activityNode(acts) {
    if (!acts.length) return null; const wrap = el('div', { class: 'activity' });
    for (const a of acts) wrap.append(el('details', {}, el('summary', {}, ic(a.icon), el('span', { text: a.label })), el('div', { class: 'detail', text: a.detail || '' })));
    return wrap;
  }
  $('#chat-form').addEventListener('submit', async (ev) => {
    ev.preventDefault(); if (state.busy) return;
    const text = input.value.trim(); if (!hasDraft()) return;
    const routeNow = currentRoute(text); if (!routeNow) { setStatus('No local model is running yet. Start one to chat privately on this machine.'); return; }
    const flip = !state.conv || !state.conv.messages.length ? morphToConversation() : null;
    const { content, acts } = await gatherContext(text);
    input.value = ''; state.files = []; state.pastes = []; renderTray(); autosize();
    if (!state.conv) state.conv = { messages: [] };
    state.conv.messages.push({ role: 'user', content });
    const node = activityNode(acts); if (node) state.activity.set(state.conv.messages.length - 1, node);
    renderConversation(); if (flip) flip();
    await streamReply(routeNow);
  });
  async function branchAt(messageId) {
    try { state.conv = await post('/api/studio/chats/branch', { id: state.conv.id, atMessage: messageId }); state.activity = new Map(); renderConversation(); loadConversations(); setStatus('Branched. The original conversation is unchanged.'); }
    catch (e) { setStatus(e.message); }
  }
  async function retryLast() {
    const msgs = state.conv.messages; const lastUser = [...msgs].reverse().find(m => m.role === 'user'); if (!lastUser) return;
    const r = currentRoute(splitContext(lastUser.content).text); if (!r) return;
    try { state.conv = await post('/api/studio/chats/branch', { id: state.conv.id, atMessage: lastUser.id }); state.activity = new Map(); renderConversation(); await streamReply(r); }
    catch (e) { setStatus(e.message); }
  }
  function newChat() { state.conv = null; state.activity = new Map(); state.lastRoute = null; renderConversation(); renderRouteChip(); loadConversations(); if (location.hash !== '#/chat' && location.hash !== '') location.hash = '#/chat'; setTimeout(() => input.focus(), 0); }
  $('#new-chat').addEventListener('click', () => { newChat(); setDrawer(false); });

  /* ---------- Command palette ---------- */
  let palItems = []; let palIndex = 0;
  function paletteItems() {
    const max = LEVELS.indexOf(document.body.dataset.mode || 'simple'); const items = [];
    items.push({ icon: 'compose', label: 'New chat', hint: 'Ctrl Shift O', run: newChat });
    items.push({ icon: 'models', label: 'Change model', run: () => { location.hash = '#/chat'; setTimeout(() => $('#model-button').click(), 30); } });
    for (const li of $$('.side-nav li[data-level]')) { if (LEVELS.indexOf(li.dataset.level) > max) continue; const a = li.querySelector('a'); items.push({ icon: a.dataset.view, label: 'Go to ' + a.textContent.trim(), run: () => { location.hash = '#/' + a.dataset.view; } }); }
    for (const m of LEVELS) items.push({ icon: 'settings', label: 'Switch to ' + MODE_TEXT[m] + ' mode', run: () => applyMode(m) });
    for (const b of $$('#chat-list .conv')) items.push({ icon: 'chat', label: b.textContent, hint: 'Conversation', run: () => b.click() });
    return items;
  }
  function renderPalette() {
    const q = $('#palette-input').value.toLowerCase().trim(); const ul = $('#palette-list'); ul.replaceChildren();
    palItems = paletteItems().filter(x => !q || x.label.toLowerCase().includes(q)).slice(0, 40); palIndex = Math.min(palIndex, Math.max(0, palItems.length - 1));
    if (!palItems.length) { ul.append(el('li', { class: 'p-empty', role: 'presentation', text: 'No match.' })); $('#palette-input').removeAttribute('aria-activedescendant'); return; }
    palItems.forEach((x, i) => { const li = el('li', { role: 'option', id: 'pal-' + i, 'aria-selected': String(i === palIndex) }, ic(x.icon), el('span', { text: x.label }), x.hint ? el('small', { text: x.hint }) : null);
      li.addEventListener('mousemove', () => { if (palIndex !== i) { palIndex = i; renderPalette(); } }); li.addEventListener('click', () => runPal(i)); ul.append(li); });
    $('#palette-input').setAttribute('aria-activedescendant', 'pal-' + palIndex);
    const sel = $('#pal-' + palIndex); if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  let palReturn = null;
  function openPalette() { closePop(false); palReturn = document.activeElement; $('#palette-overlay').hidden = false; $('#palette-input').value = ''; palIndex = 0; renderPalette(); $('#palette-input').focus(); }
  function closePalette() { $('#palette-overlay').hidden = true; if (palReturn && palReturn.focus) palReturn.focus(); }
  function runPal(i) { const x = palItems[i]; closePalette(); if (x) x.run(); }
  $('#palette-input').addEventListener('input', () => { palIndex = 0; renderPalette(); });
  $('#palette-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); palIndex = (palIndex + 1) % Math.max(1, palItems.length); renderPalette(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palIndex = (palIndex - 1 + palItems.length) % Math.max(1, palItems.length); renderPalette(); }
    else if (e.key === 'Enter') { e.preventDefault(); runPal(palIndex); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closePalette(); }
  });
  $('#palette-overlay').addEventListener('mousedown', (e) => { if (e.target === $('#palette-overlay')) closePalette(); });
  $('#search-btn').addEventListener('click', openPalette);
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); if ($('#palette-overlay').hidden) openPalette(); else closePalette(); }
    else if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'o') { e.preventDefault(); newChat(); }
    else if (e.key === 'Escape' && openPop) closePop();
    else if (e.key === 'Escape' && app.dataset.drawer === 'open') setDrawer(false);
  });

  async function loadConnections() {
    const grid = $('#connections-grid'); const status = $('#connections-status');
    status.textContent = 'Detecting AI connections…'; grid.replaceChildren();
    try {
      const r = await getJson('/api/studio/connections.json');
      for (const c of r.connections) {
        const card = el('div', { class: 'card connection-card' });
        const stateLabel = c.state === 'credential-configured' ? 'Credential configured' : c.state === 'runtime-detected' ? 'Runtime detected' : 'Not detected';
        const stateClass = c.state === 'credential-configured' ? 'ok' : c.state === 'runtime-detected' ? 'warn' : 'muted';
        card.append(el('div', { class: 'connection-top' }, ic('connections'), el('b', { text: c.displayName }), badge(stateLabel, stateClass)));
        const meta = el('div', { class: 'connection-meta' });
        if (c.configuredVia.length) meta.append(el('span', {}, ic('shield'), el('span', { text: 'Credential source: ' + c.configuredVia.join(', ') })));
        if (c.runtimes.length) meta.append(el('span', {}, ic('cpu'), el('span', { text: 'Installed runtime: ' + c.runtimes.map(x => x.displayName + (x.version ? ' ' + x.version : '')).join(', ') })));
        if (!c.configuredVia.length && c.runtimes.length) meta.append(el('span', {}, ic('info'), el('span', { text: 'Sign-in state is not inspected' })));
        if (!c.configuredVia.length && !c.runtimes.length) meta.append(el('span', {}, ic('info'), el('span', { text: 'No runtime or credential source detected' })));
        card.append(meta); grid.append(card);
      }
      status.textContent = 'Automatic detection completed. Secret values and browser sessions were not inspected.';
    } catch (e) { status.textContent = 'Connection detection failed: ' + e.message; }
  }

  async function loadHarnesses() {
    const body = $('#runtimes-body'); const status = $('#runtimes-status'); status.textContent = 'Discovering runtimes…';
    try {
      state.harnesses = await getJson('/api/studio/harnesses.json'); body.replaceChildren();
      for (const h of state.harnesses.harnesses) {
        body.append(el('tr', {}, el('td', { text: h.displayName }), el('td', {}, h.installed ? badge(h.versionStatus === 'builtin' ? 'built in' : 'installed', 'ok') : badge(h.versionStatus === 'not-executed' ? 'configure an endpoint' : 'not installed', 'muted')),
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
          if (!confirm(remote ? 'Contact the remote server ' + s.url + ' without credentials?' : 'Run this command on your machine to list its tools?\n\n' + s.command + ' ' + (s.args || []).join(' ') + '\n\nFrom: ' + s.configPath)) return;
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
  $('#web-form').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const out = $('#web-out'); const status = $('#web-status'); out.replaceChildren();
    const action = $('#web-action').value; const input = $('#web-input').value.trim();
    status.textContent = action === 'CRAWL' ? 'Crawling (same site, robots.txt honoured)…' : 'Working…';
    try { const r = await mcpPost('/api/studio/web', action === 'SEARCH' ? { action, query: input } : { action, url: input });
      if (action === 'SEARCH') { const ol = el('ol'); for (const x of r.results) ol.append(el('li', {}, el('b', { text: x.title || x.url }), el('div', { class: 'muted', text: x.url }), el('p', { text: x.snippet }))); out.append(ol); status.textContent = r.results.length + ' result(s) via ' + r.adapter + '.'; }
      else if (action === 'FETCH') { out.append(el('h2', { text: r.title || r.url }), el('p', { class: 'muted', text: r.status + ' · ' + r.contentType + ' · ' + r.bytes + ' bytes · sha256 ' + r.sha256.slice(0, 12) + (r.redirects.length ? ' · redirected ' + r.redirects.length + '×' : '') }), el('pre', { text: r.text.slice(0, 4000) })); status.textContent = 'Fetched without a browser; receipt ' + (r.receiptId || 'n/a') + '.'; }
      else if (action === 'MAP') { const ul = el('ul'); for (const l of r.sameOrigin) ul.append(el('li', { text: l.url + (l.text ? ' — ' + l.text : '') })); out.append(ul); status.textContent = r.sameOrigin.length + ' same-site link(s), ' + r.external.length + ' external.'; }
      else { const ul = el('ul'); for (const p of r.pages) ul.append(el('li', { text: p.url + ' — ' + (p.title || 'untitled') })); out.append(ul); status.textContent = r.pages.length + ' page(s), ' + r.skipped.length + ' skipped' + (r.truncated ? ', stopped at the page limit' : '') + '.'; }
    } catch (e) { status.textContent = 'Refused: ' + e.message; }
  });
  const age = (ms) => ms < 60000 ? 'just now' : ms < 3600000 ? Math.round(ms / 60000) + ' min ago' : ms < 86400000 ? Math.round(ms / 3600000) + ' h ago' : Math.round(ms / 86400000) + ' d ago';
  async function loadMemory() {
    const status = $('#mem-status'); const body = $('#mem-body');
    try { const r = await getJson('/api/studio/memory.json'); body.replaceChildren();
      $('#mem-forms').hidden = !r.enabled;
      if (!r.enabled) { status.textContent = r.reason; return; }
      for (const m of r.records) {
        const toggle = el('button', { type: 'button', class: 'secondary', text: m.state === 'active' ? 'Disable' : 'Enable' }); toggle.setAttribute('aria-label', toggle.textContent + ' memory ' + m.memoryId.slice(0, 8));
        toggle.addEventListener('click', () => memAct(m, m.state === 'active' ? 'DISABLE' : 'ACTIVATE'));
        const forget = el('button', { type: 'button', class: 'secondary', text: 'Forget' }); forget.setAttribute('aria-label', 'Forget memory ' + m.memoryId.slice(0, 8));
        forget.addEventListener('click', () => { if (confirm('Forget this memory permanently?')) memAct(m, 'FORGET'); });
        body.append(el('tr', {}, el('td', { class: 'code', text: m.memoryId.slice(0, 8) }), el('td', { text: m.state }), el('td', { text: m.memoryClass }), el('td', { text: m.scope }), el('td', { text: m.source + ' · ' + m.evidence }), el('td', { text: String(m.confidence) }), el('td', { text: age(m.ageMs) }), el('td', {}, toggle, forget)));
      }
      status.textContent = r.records.length + ' memory item(s). Recalled memory is data for the model, never instructions.';
    } catch (e) { status.textContent = 'Memory unavailable: ' + e.message; }
  }
  async function memAct(m, action) { try { await mcpPost('/api/studio/memory/act', { memoryId: m.memoryId, scope: m.scope === 'project' ? 'project' : 'user', action }); loadMemory(); } catch (e) { $('#mem-status').textContent = e.message; } }
  $('#mem-add-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await mcpPost('/api/studio/memory/remember', { text: $('#mem-text').value, scope: $('#mem-scope').value }); $('#mem-text').value = ''; loadMemory(); }
    catch (e) { $('#mem-status').textContent = 'Not saved: ' + e.message; }
  });
  $('#mem-search-form').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const out = $('#mem-results'); out.replaceChildren();
    try { const r = await mcpPost('/api/studio/memory/search', { query: $('#mem-query').value });
      if (!r.hits.length) { out.append(el('p', { class: 'empty', text: 'Nothing recalled for this question.' })); return; }
      const ol = el('ol'); for (const h of r.hits) ol.append(el('li', {}, el('p', { text: h.text }), el('p', { class: 'muted', text: h.scope + ' · ' + age(h.ageMs) + ' · why: ' + h.why }))); out.append(ol);
    } catch (e) { out.append(el('p', { class: 'bad', text: e.message })); }
  });
  async function loadIntegrations() {
    const body = $('#int-body'); const status = $('#int-status');
    try { const r = await getJson('/api/studio/integrations.json'); body.replaceChildren();
      for (const e of r.entries) {
        const st = e.status === 'ready' ? badge('ready', 'ok') : e.status === 'needs-credentials' ? badge('needs credentials', 'warn') : badge('invalid', 'bad');
        body.append(el('tr', {}, el('td', {}, el('b', { text: e.name }), el('div', { class: 'muted', text: e.endpoint || '' })), el('td', { text: e.kind }), el('td', {}, st),
          el('td', { text: e.auth.schemes.join(', ') + (e.auth.credentialNames.length ? ' (' + e.auth.credentialNames.join(', ') + ')' : '') }), el('td', { text: e.capabilities.join(', ') }), el('td', { text: e.defaultDecision }), el('td', { text: e.trust }),
          el('td', { text: (e.operations ? e.operations.length + ' operation(s). ' : '') + e.problems.join('; ') })));
      }
      status.textContent = r.entries.length + ' integration(s). Manifest: ' + r.manifest + (r.manifestError ? ' — ' + r.manifestError : '') + '. Credentials are shown by name only.';
    } catch (e) { status.textContent = 'Integrations unavailable: ' + e.message; }
  }
  async function loadTree(p) {
    try { const r = await post('/api/studio/code/tree', { path: p }); const ul = $('#tree'); ul.replaceChildren(); $('#tree-path').textContent = '/' + r.path;
      if (r.path) { const up = el('button', { type: 'button', class: 'linkish', text: '..' }); up.addEventListener('click', () => loadTree(r.path.split('/').slice(0, -1).join('/'))); ul.append(el('li', {}, up)); }
      for (const e of r.entries) { const full = (r.path ? r.path + '/' : '') + e.name; const b = el('button', { type: 'button', class: 'linkish', text: e.name + (e.kind === 'dir' ? '/' : '') });
        b.addEventListener('click', () => e.kind === 'dir' ? loadTree(full) : openFile(full)); ul.append(el('li', {}, b)); }
    } catch (e) { $('#tree-path').textContent = 'Files unavailable: ' + e.message; }
  }
  async function openFile(p) {
    try { const r = await post('/api/studio/code/file', { path: p }); $('#file-title').textContent = p; $('#file-view').textContent = r.binary ? '(binary file, ' + r.bytes + ' bytes)' : r.content; }
    catch (e) { $('#file-view').textContent = e.message; }
  }
  function renderDiff(patch) {
    const pre = $('#diff-view'); pre.replaceChildren(); pre.hidden = false;
    for (const line of patch.split('\n').slice(0, 5000)) pre.append(el('span', { class: line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : line.startsWith('@@') ? 'hunk' : '', text: line + '\n' }));
  }
  async function loadWorktrees() {
    try { const r = await getJson('/api/studio/code/worktrees.json'); const body = $('#wt-body'); body.replaceChildren();
      for (const w of r.worktrees) {
        const btn = el('button', { type: 'button', class: 'secondary', text: 'Show diff' }); btn.setAttribute('aria-label', 'Show diff of ' + (w.branch || w.path));
        btn.addEventListener('click', async () => { try { const d = await post('/api/studio/code/diff', { worktree: w.path }); $('#wt-status').textContent = d.files.length + ' file(s) changed in ' + (d.branch || d.worktree) + ' (' + d.base + ').'; renderDiff(d.patch || '(no changes)'); } catch (e) { $('#wt-status').textContent = e.message; } });
        body.append(el('tr', {}, el('td', { class: 'code', text: w.path }), el('td', { text: w.branch || (w.detached ? 'detached' : '—') }), el('td', { text: String(w.changedFiles) }),
          el('td', { text: w.workers.length ? w.workers.map(x => x.taskId + ' (' + x.state + ', ' + x.receipts + ' receipt' + (x.receipts === 1 ? '' : 's') + (x.verdict ? ', ' + x.verdict : '') + ')').join('; ') : '—' }), el('td', {}, btn)));
      }
      $('#wt-status').textContent = r.worktrees.length + ' worktree(s).';
    } catch (e) { $('#wt-status').textContent = 'Worktrees unavailable: ' + e.message; }
  }
  $('#cowork-run').addEventListener('click', async () => {
    const status = $('#cowork-status');
    const caps = {}; for (const cap of ['READ','WRITE','EXECUTE','NETWORK','EXTERNAL_ACTION']) caps[cap] = $('#perm-' + cap).value;
    const payload = { intent: $('#cowork-intent').value.trim(), plannedFiles: $('#cowork-files').value.split(/\n/).map(x => x.trim()).filter(Boolean), capabilities: caps, confirm: $('#cowork-confirm').checked };
    if (!payload.intent) { status.textContent = 'Describe the task first.'; return; }
    const start = async (approvedCapabilities) => {
      const res = await fetch('/api/studio/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, approvedCapabilities }) });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.approvalRequired) {
        const ok = confirm('This task asks for: ' + body.approvalRequired.join(', ') + '. Allow for this run? Cancel denies them.');
        if (!ok) { for (const c of body.approvalRequired) { caps[c] = 'DENY'; $('#perm-' + c).value = 'DENY'; } return start([]); }
        return start(body.approvalRequired);
      }
      if (!res.ok) throw new Error((body.error && body.error.message) || ('HTTP ' + res.status));
      return body;
    };
    try { const r = await start([]); status.textContent = 'Started ' + r.runId + '. Opening Mission Control…'; location.hash = '#/mission'; }
    catch (e) { status.textContent = 'Not started: ' + e.message; }
  });
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

  loadConversations();
  renderConversation();
  route();
  translateDom(document);
})();
`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const SCRIPT_FINAL = SCRIPT.replace('__ICONS__', () => JSON.stringify(ICONS).replace(/</gu, '\\u003c'));

export function renderStudioHtml(): { readonly html: string; readonly nonce: string } {
  const nonce = randomBytes(16).toString('base64');
  const perm = (cap: string, def: string) => `<div><label for="perm-${cap}">${cap.replace('_', ' ')}</label><select id="perm-${cap}">${['ALLOW', 'ASK', 'DENY'].map((d) => `<option${d === def ? ' selected' : ''}>${d}</option>`).join('')}</select></div>`;
  const nav = (view: string, level: string, label: string) => `<li data-level="${level}"><a class="nav-item" href="#/${view}" data-view="${view}" title="${label}">${icon(view)}<span class="label">${label}</span></a></li>`;
  const seg = (name: string, options: readonly (readonly [string, string])[]) => `<div class="seg" role="radiogroup" aria-label="${name}">${options.map(([v, t]) => `<label><input type="radio" name="pref-${name}" value="${v}"><span>${t}</span></label>`).join('')}</div>`;
  const modeItem = (mode: string, name: string, desc: string) => `<button type="button" class="opt" role="menuitemradio" aria-checked="false" data-mode="${mode}"><span class="t"><span class="n">${name}</span><span class="d">${desc}</span></span>${icon('check', 'i ck')}</button>`;
  const html = `<!doctype html>
<html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light"><meta name="theme-color" content="#050506">
<title>FuryPipe Studio</title><style nonce="${nonce}">${CSS}</style></head>
<body data-mode="simple" data-view="chat"><a class="skip" href="#main">Skip to content</a>
<svg class="defs" aria-hidden="true" focusable="false"><defs>
<radialGradient id="fury-core" cx="45%" cy="40%" r="60%"><stop offset="0" stop-color="#ffe2c7"/><stop offset=".45" stop-color="#ff8a3d"/><stop offset="1" stop-color="#d9480f"/></radialGradient>
<linearGradient id="fury-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a52"/><stop offset=".6" stop-color="rgba(255,138,61,.25)"/><stop offset="1" stop-color="rgba(255,255,255,.08)"/></linearGradient>
<linearGradient id="fury-flow" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d9480f"/><stop offset=".5" stop-color="#ff7a1a"/><stop offset="1" stop-color="#ffc08a"/></linearGradient>
</defs></svg>
<div class="app" id="app" data-collapsed="false" data-drawer="closed">
<aside class="side" id="side" aria-label="FuryPipe">
  <div class="side-top"><a class="brand" href="#/chat" aria-label="FuryPipe home">${MARK}<span>Fury<b>Pipe</b></span></a>
    <button type="button" id="side-collapse" class="icon-btn desktop-only" aria-label="Collapse sidebar" aria-expanded="true">${icon('panel')}</button></div>
  <button type="button" id="new-chat" class="new-chat" title="New chat">${icon('compose')}<span class="label">New chat</span></button>
  <button type="button" id="search-btn" class="search-btn" title="Search and commands (Ctrl K)">${icon('search')}<span class="label">Search</span><kbd>Ctrl K</kbd></button>
  <nav class="side-nav" aria-label="Workspace"><ul>
    ${nav('chat', 'simple', 'Chat')}${nav('cowork', 'power', 'Cowork')}${nav('code', 'engineer', 'Code')}${nav('agents', 'engineer', 'Agents')}${nav('mission', 'expert', 'Mission Control')}${nav('automations', 'engineer', 'Automations')}
    ${nav('knowledge', 'power', 'Knowledge')}${nav('web', 'power', 'Web')}${nav('memory', 'power', 'Memory')}
    ${nav('models', 'simple', 'Models')}${nav('connections', 'simple', 'Connections')}${nav('runtimes', 'engineer', 'Runtimes')}${nav('skills', 'power', 'Skills')}${nav('mcp', 'power', 'MCP')}${nav('integrations', 'engineer', 'Integrations')}
  </ul></nav>
  <div class="recent" aria-labelledby="recent-h"><h2 id="recent-h">Recent</h2><ul id="chat-list" aria-labelledby="recent-h"></ul></div>
  <div class="side-foot">
    <button type="button" id="mode-button" class="mode-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="mode-menu" title="Workspace mode"><span class="mode-dot" aria-hidden="true"></span><span class="label" id="mode-label">Simple</span><small class="label">mode</small>${icon('chevron')}</button>
    <a class="icon-btn" href="#/settings" aria-label="Settings" title="Settings">${icon('settings')}</a>
  </div>
</aside>
<div class="scrim" id="scrim"></div>
<div class="main-col">
<header class="top">
  <button type="button" id="side-open" class="icon-btn mobile-only" aria-label="Open sidebar" aria-expanded="false" aria-controls="side">${icon('menu')}</button>
  <div class="top-title" id="top-title"></div>
  <div class="top-right"><span class="privacy" id="privacy" hidden title="This conversation runs on your computer. Nothing is sent to a cloud provider.">${icon('shield')}Private · on this PC</span></div>
</header>
<main id="main">
<section data-view="chat" id="chat" class="chat is-empty" aria-labelledby="h-chat"><h1 id="h-chat" class="sr-only">Chat</h1>
  <div class="stage-bg" aria-hidden="true"></div>
  <div class="chat-scroll" id="chat-scroll"><div id="chat-log" class="log" role="log" aria-live="polite" aria-label="Conversation"></div></div>
  <div class="dock"><div class="dock-inner">
    <div class="hero">
      <div class="hero-mark" aria-hidden="true"><div class="hero-glow"></div><div class="orbit o3"></div><div class="orbit"></div><div class="orbit o2"></div>
        <svg class="hero-core" viewBox="0 0 80 80" focusable="false"><circle cx="40" cy="40" r="17" fill="url(#fury-core)"/><circle cx="40" cy="40" r="25" fill="none" stroke="rgba(255,160,90,.35)" stroke-width=".8"/><path class="flow" d="M2 52c14 0 20-24 38-24s24 24 38 24" fill="none" stroke="url(#fury-flow)" stroke-width="2.4" stroke-linecap="round"/></svg></div>
      <h2>How can FuryPipe help?</h2>
      <p>One workspace for every model, agent and tool, starting with the AI on this machine.</p>
    </div>
    <div id="chat-empty" class="setup" hidden>
      <h3>Run AI privately on this PC</h3>
      <p>No local model is running yet. Start one and FuryPipe finds it automatically, or use your cloud providers in the Gateway WebChat.</p>
      <div class="row"><a class="btn primary" href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">Set up Ollama</a><a class="btn" href="https://lmstudio.ai" target="_blank" rel="noopener noreferrer">Get LM Studio</a><a class="btn" href="#/models">See what fits</a><a class="btn" href="/gateway/webchat/">Use cloud AI</a></div>
    </div>
    <form id="chat-form" autocomplete="off">
      <div class="composer" id="composer">
        <div class="attach-tray" id="attach-tray" hidden></div>
        <label class="sr-only" for="chat-input">Message</label>
        <textarea id="chat-input" rows="1" placeholder="Ask FuryPipe anything…"></textarea>
        <div class="composer-bar">
          <div class="left">
            <button type="button" id="attach-btn" class="tool icon-only" aria-label="Attach text files" title="Attach text files">${icon('plus')}</button>
            <input type="file" id="attach-input" multiple hidden tabindex="-1">
            <button type="button" id="tool-web" class="tool" aria-label="Web" aria-pressed="false" title="Read the web pages you link">${icon('web')}<span>Web</span></button>
            <button type="button" id="tool-kb" class="tool" aria-label="Knowledge" aria-pressed="false" title="Ground answers in your indexed project documents">${icon('knowledge')}<span>Knowledge</span></button>
          </div>
          <div class="right">
            <button type="button" id="model-button" class="model-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="model-pop" title="Choose a model"><span class="fury-dot" aria-hidden="true"></span><span class="name" id="model-label">Fury Auto</span><svg class="i chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS.chevron}</svg></button>
            <button type="submit" id="chat-send" class="send" aria-label="Send message" disabled>${icon('arrowUp')}</button>
          </div>
        </div>
        <div class="drop" id="drop" hidden>Drop text files to add them to your message</div>
      </div>
      <div class="dock-foot"><button type="button" id="route-chip" class="route-chip" hidden aria-haspopup="dialog" aria-controls="route-pop"></button><span id="chat-status" class="status" role="status"></span><span class="disclaimer">AI can make mistakes. Check important information.</span></div>
    </form>
    <div class="suggest" aria-label="Suggestions">
      <button type="button" class="chip-btn" data-prompt="Research and explain: ">${icon('web')}Research</button>
      <button type="button" class="chip-btn" data-prompt="Help me write code that ">${icon('code')}Code</button>
      <button type="button" class="chip-btn" data-prompt="Draft a clear, well-structured ">${icon('compose')}Create</button>
      <button type="button" class="chip-btn" data-prompt="Plan the steps to ">${icon('cowork')}Work</button>
    </div>
  </div></div>
</section>
<section data-view="cowork" aria-labelledby="h-cowork" hidden><h1 id="h-cowork">Cowork</h1><p class="lead">Describe a task and decide what the agent may do. Denied permissions never run; anything set to Ask needs your approval before agents start.</p>
  <div class="card"><label for="cowork-intent">Task</label><textarea id="cowork-intent" placeholder="e.g. Tidy the docs folder and summarise open TODOs"></textarea>
  <fieldset class="row"><legend class="muted">Permissions</legend>${perm('READ', 'ALLOW')}${perm('WRITE', 'ASK')}${perm('EXECUTE', 'ASK')}${perm('NETWORK', 'DENY')}${perm('EXTERNAL_ACTION', 'DENY')}</fieldset>
  <label for="cowork-files">Files or folders it may change (one per line)</label><textarea id="cowork-files" placeholder="docs/"></textarea>
  <div class="row"><label for="cowork-confirm"><input id="cowork-confirm" type="checkbox"> I confirm starting agents on this repository (local runtimes only)</label></div>
  <p class="row"><button id="cowork-run" type="button">Run with agents</button><button id="cowork-plan" type="button" class="secondary">Plan with Agents</button></p><p id="cowork-status" class="status" role="status"></p></div></section>
<section data-view="code" aria-labelledby="h-code" hidden><h1 id="h-code">Code</h1><p class="lead">Project graph for this workspace (Graphify when present, native indexer otherwise) and change blast radius.</p>
  <div class="grid"><div class="card"><h2>Project graph</h2><table><tbody>
    <tr><th scope="row">Provider</th><td id="graph-provider">—</td></tr><tr><th scope="row">Files</th><td id="graph-files">—</td></tr>
    <tr><th scope="row">Edges</th><td id="graph-edges">—</td></tr><tr><th scope="row">Freshness</th><td id="graph-stale">—</td></tr>
    <tr><th scope="row">Outputs</th><td id="graph-outputs">—</td></tr></tbody></table><p id="graph-status" class="status muted" role="status"></p></div>
  <div class="card"><h2>Blast radius</h2><form id="blast-form"><label for="blast-files">Changed files (one per line)</label><textarea id="blast-files" placeholder="src/auth/session.ts"></textarea><button type="submit">Analyse</button></form><div id="blast-out" aria-live="polite"></div></div></div>
  <div class="grid"><div class="card"><h2>Files</h2><p class="muted" id="tree-path">/</p><ul id="tree" class="tree"></ul></div>
  <div class="card"><h2 id="file-title">File</h2><pre id="file-view" class="code-view" tabindex="0" aria-labelledby="file-title">Select a file.</pre></div></div>
  <div class="card"><h2>Worktrees</h2><p class="muted">Every agent writes in its own worktree. Diffs are read-only here; merging goes through FuryIntegrator.</p>
  <table><thead><tr><th scope="col">Worktree</th><th scope="col">Branch</th><th scope="col">Changed</th><th scope="col">Agents · receipts</th><th scope="col"></th></tr></thead><tbody id="wt-body"></tbody></table>
  <p id="wt-status" class="status muted" role="status"></p><pre id="diff-view" class="code-view" hidden tabindex="0" aria-label="Diff"></pre></div></section>
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
<section data-view="models" aria-labelledby="h-models" hidden><h1 id="h-models">Models</h1><p class="lead">Fury Auto routes each message to the best model available. Local models keep everything on this computer; probes stay on loopback.</p>
  <div class="models-top">
    <div class="card hw-card"><h2>Your machine</h2><p class="big" id="hw">—</p><div class="spec" id="hw-spec"></div><p class="muted" id="hw-rec"></p></div>
    <div class="card auto-card"><h2><span class="fury-dot" aria-hidden="true"></span>Fury Auto</h2><p>Picks a model per message from what is really running here: it prefers models that fit your hardware and coding models for code. Click the route under the composer to see why.</p></div>
  </div>
  <h2 class="sec-h">Local runtimes</h2><div id="backends" class="backend-grid"></div>
  <h2 class="sec-h">Cloud</h2><div class="card"><p>Claude, GPT, Gemini and other cloud models run through the governed Gateway WebChat, using the providers and budgets you configured.</p><a class="btn" href="/gateway/webchat/">${icon('cloud')}Open Gateway WebChat</a></div>
  <details class="adv"><summary>Advanced · endpoints</summary><div><table><thead><tr><th scope="col">Backend</th><th scope="col">Endpoint</th><th scope="col">State</th><th scope="col">Model</th><th scope="col">Fit</th></tr></thead><tbody id="models-body"></tbody></table></div></details>
  <p id="models-status" class="status muted" role="status"></p></section>
<section data-view="connections" aria-labelledby="h-connections" hidden><h1 id="h-connections">Connections</h1><p class="lead">FuryPipe automatically detects AI runtimes and safe credential hints on this machine. It never reads browser cookies, OAuth stores or secret values.</p>
  <div class="connection-head card"><div><h2>AI accounts &amp; providers</h2><p class="muted">Detection is local and privacy-preserving. A detected runtime does not mean the account is authenticated.</p></div><a class="btn" href="/gateway/webchat/">Open cloud setup</a></div>
  <div id="connections-grid" class="connection-grid" aria-live="polite"></div>
  <div class="card privacy-note"><h2>Privacy boundary</h2><p>Browser sessions and other applications' credential stores are never inspected automatically. FuryPipe only reports installed runtimes and the presence of supported environment credential sources; secret contents never leave the process.</p></div>
  <p id="connections-status" class="status muted" role="status"></p></section>
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
<section data-view="web" aria-labelledby="h-web" hidden><h1 id="h-web">Web</h1><p class="lead">Search, read and map public web pages without opening a browser. Private and internal addresses are always refused.</p>
  <div class="card"><form id="web-form"><div class="row"><div><label for="web-action">Action</label><select id="web-action"><option value="FETCH">Read a page</option><option value="MAP">List a page's links</option><option value="CRAWL">Crawl a site (10 pages)</option><option value="SEARCH">Search (local SearXNG)</option></select></div></div>
  <label for="web-input">URL or search query</label><input id="web-input" required autocomplete="off" placeholder="https://example.com/docs"><div class="row"><button type="submit">Go</button></div></form>
  <p id="web-status" class="status" role="status"></p><div id="web-out" aria-live="polite"></div></div></section>
<section data-view="memory" aria-labelledby="h-memory" hidden><h1 id="h-memory">Memory</h1><p class="lead">What FuryPipe remembers for this project and for you. Stored encrypted on this machine; you can disable or forget any item.</p>
  <p id="mem-status" class="status muted" role="status"></p>
  <div id="mem-forms" hidden><div class="card"><form id="mem-add-form"><label for="mem-text">Remember</label><textarea id="mem-text" required placeholder="e.g. We deploy on Tuesdays only"></textarea>
  <div class="row"><div><label for="mem-scope">For</label><select id="mem-scope"><option value="project">This project</option><option value="user">Me, everywhere</option></select></div><button type="submit">Save</button></div></form></div>
  <div class="card"><form id="mem-search-form"><label for="mem-query">Recall</label><input id="mem-query" required autocomplete="off"><div class="row"><button type="submit">Recall</button></div></form><div id="mem-results" aria-live="polite"></div></div>
  <div class="card"><table><thead><tr><th scope="col">ID</th><th scope="col">State</th><th scope="col">Kind</th><th scope="col">Scope</th><th scope="col">Source</th><th scope="col">Confidence</th><th scope="col">Age</th><th scope="col">Actions</th></tr></thead><tbody id="mem-body"></tbody></table></div></div></section>
<section data-view="integrations" aria-labelledby="h-integrations" hidden><h1 id="h-integrations">Integrations</h1><p class="lead">MCP servers, APIs (OpenAPI) and webhooks in one registry, with how each one authenticates, what it may do and whether you trust it. Declare APIs and webhooks in .furypipe/integrations.json.</p>
  <div class="card"><table><thead><tr><th scope="col">Integration</th><th scope="col">Kind</th><th scope="col">Status</th><th scope="col">Auth</th><th scope="col">Can</th><th scope="col">Default</th><th scope="col">Trust</th><th scope="col">Notes</th></tr></thead><tbody id="int-body"></tbody></table><p id="int-status" class="status muted" role="status"></p></div></section>
<section data-view="settings" aria-labelledby="h-settings" hidden><h1 id="h-settings">Settings</h1><p class="lead">Make FuryPipe yours. Preferences are stored in this browser.</p>
  <div class="settings"><nav class="settings-nav" aria-label="Settings sections"><a href="#set-general">General</a><a href="#set-appearance">Appearance</a><a href="#set-privacy">Privacy</a><a href="#set-advanced">Advanced</a></nav>
  <div>
    <div class="card set-group" id="set-general"><h2>General</h2>
      <div class="set-row"><div class="t"><b>Language</b><span>Automatically follows your browser language. You can override it here.</span></div>${seg('language', [['auto', 'Auto'], ['en', 'English'], ['fr', 'French']])}</div>
      <div class="set-row"><div class="t"><b>Workspace mode</b><span>How much of FuryPipe's control plane you see. Power features are always one switch away.</span></div>${seg('mode', [['simple', 'Simple'], ['power', 'Power'], ['engineer', 'Engineer'], ['expert', 'Expert']])}</div></div>
    <div class="card set-group" id="set-appearance"><h2>Appearance</h2>
      <div class="set-row"><div class="t"><b>Theme</b><span>Dark is the signature FuryPipe look. System follows your OS.</span></div>${seg('theme', [['dark', 'Dark'], ['system', 'System']])}</div>
      <div class="set-row"><div class="t"><b>Motion</b><span>Reduce animation everywhere.</span></div>${seg('motion', [['system', 'System'], ['reduced', 'Reduced']])}</div>
      <div class="set-row"><div class="t"><b>Density</b><span>Spacing around pages.</span></div>${seg('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']])}</div></div>
    <div class="card set-group" id="set-privacy"><h2>Privacy</h2>
      <p>Studio chat runs on local models only: messages stay on this computer. Studio listens on loopback, accepts same-origin requests only, and never reads other tools' credentials. Cloud providers run through the governed Gateway with explicit budgets.</p></div>
    <div class="card set-group" id="set-advanced"><h2>Advanced</h2>
      <p><a href="/control-plane">Control Plane</a>: the technical dashboard with sessions, compression, readiness, provider and MCP evidence.</p>
      <p class="muted">Engineer and Expert modes add Code, Agents, Runtimes, Integrations, Automations and Mission Control to the sidebar.</p></div>
  </div></div></section>
<section data-view="notfound" aria-labelledby="h-notfound" hidden><h1 id="h-notfound">Page not found</h1><p class="lead">This Studio view does not exist. <a href="#/chat">Go to Chat</a>.</p></section>
</main></div></div>
<div class="pop" id="model-pop" role="dialog" aria-label="Choose a model" hidden><input type="search" id="model-search" placeholder="Search models" aria-label="Search models" autocomplete="off"><div id="model-list" role="listbox" aria-label="Models"></div></div>
<div class="pop route-pop" id="route-pop" role="dialog" aria-label="Why this route?" hidden tabindex="-1"></div>
<div class="pop menu" id="mode-menu" role="menu" aria-label="Workspace mode" hidden>
  ${modeItem('simple', 'Simple', 'Chat and models. Nothing else in the way.')}${modeItem('power', 'Power', 'Adds Cowork, Knowledge, Web, Memory, Skills and MCP.')}${modeItem('engineer', 'Engineer', 'Adds Code, Agents, Automations, Runtimes and Integrations.')}${modeItem('expert', 'Expert', 'Adds Mission Control: live agents, receipts and replay.')}
</div>
<div class="pop menu" id="conv-menu" role="menu" aria-label="Conversation options" hidden><button type="button" class="opt" role="menuitem" id="conv-rename"><span class="t"><span class="n">Rename</span></span></button><button type="button" class="opt" role="menuitem" id="conv-delete"><span class="t"><span class="n">Delete</span></span></button></div>
<div class="overlay" id="palette-overlay" hidden><div class="palette" role="dialog" aria-modal="true" aria-label="Search and commands">
  <div class="palette-in">${icon('search')}<input id="palette-input" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" placeholder="Search conversations, pages and commands…" autocomplete="off"><kbd>Esc</kbd></div>
  <ul id="palette-list" role="listbox" aria-label="Results"></ul></div></div>
<script nonce="${nonce}">${SCRIPT_FINAL}</script></body></html>`;
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
