// Server-rendered HTML dashboard — htmx polls fragments, Alpine drives the toast tray.
// Presentation only; server code (src/dashboard.ts, src/node.ts) needs no edits.

import { HTMX_JS, ALPINE_JS } from './vendor.js';
import { CACHE_CREATE_RATE, CACHE_READ_RATE } from '../core/baseline.js';
import type { ControlRoomSnapshot } from '../control-room/index.js';
import { createI18n } from '../i18n/index.js';
import { CORE_CATALOGS } from '../i18n/catalogs.js';
import type {
  StatsPayload,
  RecentPayload,
  RecentRow,
  SessionsPayload,
  SessionRow,
  FullStatsPayload,
  CurrentSessionPayload,
} from './types.js';

// ---- helpers --------------------------------------------------------

const DASHBOARD_I18N = createI18n({ catalogs: CORE_CATALOGS, defaultLocale: 'en' });
const DASHBOARD_LOCALES = ['en', 'fr', 'en-XA', 'ar-XB'] as const;

function resolveDashboardLocale(locale: string | undefined) {
  try {
    return DASHBOARD_I18N.resolve(locale ?? 'en');
  } catch {
    return DASHBOARD_I18N.resolve('en');
  }
}

function dashboardT(locale: string | undefined, key: string, params?: Readonly<Record<string, string | number | boolean>>): string {
  const resolved = resolveDashboardLocale(locale);
  return DASHBOARD_I18N.translate(resolved.canonical, key, params ? { params } : undefined);
}

export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

function numFmt(n: number | null | undefined): string {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('en-US');
}

/** "12.3k" / "1.2M" compact formatter for headline numbers. */
function kFmt(n: number | null | undefined): string {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1_000_000) return (v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1) + 'M';
  if (a >= 1000) return (v / 1000).toFixed(a >= 100_000 ? 0 : 1) + 'k';
  return String(Math.round(v));
}

function formatDuration(s: number): string {
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (h ? h + 'h ' : '') + (m || h ? m + 'm ' : '') + sec + 's';
}

function shortPath(p: string | null | undefined): string {
  if (!p) return '-';
  const parts = String(p).split('/');
  return parts[parts.length - 1] || p;
}

// ---- compression toggle (kill switch) ------------------------------------

export function renderToggleFragment(enabled: boolean, locale = 'en'): string {
  const t = (key: string): string => dashboardT(locale, key);
  // NOTE: English default keeps legacy asserted strings stable.
  const banner = enabled
    ? ''
    : `<div class="banner"><strong>${escapeHtml(t('dashboard.toggle.passthroughMode'))}</strong> — ${escapeHtml(t('dashboard.toggle.passthroughDescription'))}</div>`;
  // Button POSTs the OPPOSITE of current state; 2s poll keeps it fresh.
  const confirm = enabled
    ? ` hx-confirm="${escapeHtml(t('dashboard.toggle.confirm'))}"`
    : '';
  return (
    banner +
    `<div class="switch">` +
    `<span class="switch-state ${enabled ? 'on' : 'off'}"><span class="switch-dot"></span>${escapeHtml(t(enabled ? 'dashboard.toggle.compressionOn' : 'dashboard.toggle.compressionOff'))}</span>` +
    `<button class="switch-btn" type="button" hx-post="/fragments/toggle" hx-target="#frag-toggle" hx-vals='{"enabled": ${!enabled}}'${confirm}>` +
    escapeHtml(t(enabled ? 'dashboard.toggle.disable' : 'dashboard.toggle.enable')) +
    `</button>` +
    `<span class="hint">${escapeHtml(t('dashboard.toggle.hint'))}</span>` +
    `</div>`
  );
}

// ---- compress scope (which models get imaged) ----------------------------

/** Chip catalog — UNION with env scope + active set, so env-var models stay toggleable. Labels are cosmetic. */
const MODEL_CATALOG: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-opus-5', label: 'Opus 5' },
];

const GPT_MODEL_CATALOG: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'gpt-5.6-sol', label: 'GPT 5.6 Sol' },
  { id: 'gpt-5.5', label: 'GPT 5.5' },
];

const GROK_MODEL_CATALOG: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'grok-4.6', label: 'Grok 4.6' },
  { id: 'grok-4.5', label: 'Grok 4.5' },
];

const GEMINI_MODEL_CATALOG: ReadonlyArray<{ id: string; label: string }> = [
  // `gemini` is the family base (default on): covers 3.6/3.7/3.8, Pro, 4, 5 and
  // whatever ships next. The per-version chips are for narrowing scope after
  // opting the family off.
  { id: 'gemini', label: 'Gemini (all versions)' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
];

export function renderModelsFragment(
  active: string[],
  configured: string[],
  enabled: boolean,
  locale = 'en',
): string {
  const t = (key: string): string => dashboardT(locale, key);
  const on = new Set(active);
  const labelOf = new Map(
    [...MODEL_CATALOG, ...GPT_MODEL_CATALOG, ...GROK_MODEL_CATALOG, ...GEMINI_MODEL_CATALOG].map((m) => [m.id, m.label]),
  );
  // Union the catalog with env-configured + active ids so PXPIPE_MODELS-enabled
  // families always show as toggles, then split into chip rows (Claude /
  // OpenAI Responses / Gemini) plus the PXPIPE_MODELS CSV textbox that mirrors the scope.
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of [
    ...MODEL_CATALOG.map((m) => m.id),
    ...GPT_MODEL_CATALOG.map((m) => m.id),
    ...GROK_MODEL_CATALOG.map((m) => m.id),
    ...GEMINI_MODEL_CATALOG.map((m) => m.id),
    ...configured,
    ...active,
  ]) {
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  const chipFor = (id: string): string => {
    const lit = on.has(id);
    const label = labelOf.get(id) ?? id;
    return (
      `<button class="chip${lit ? ' on' : ''}" type="button" ` +
      `hx-post="/fragments/models" hx-target="#frag-models" ` +
      `hx-vals='${escapeHtml(`{"model":${JSON.stringify(id)},"on":${!lit}}`)}'>${escapeHtml(label)}${lit ? ' ✓' : ''}</button>`
    );
  };
  const claudeChips = ids.filter((id) => id.startsWith('claude')).map(chipFor).join('');
  const geminiChips = ids.filter((id) => id.includes('gemini')).map(chipFor).join('');
  const gptChips = ids.filter((id) => id.startsWith('gpt')).map(chipFor).join('');
  const grokChips = ids.filter((id) => id.startsWith('grok')).map(chipFor).join('');
  const otherChips = ids
    .filter((id) => !id.startsWith('claude') && !id.startsWith('gpt') && !id.startsWith('grok') && !id.includes('gemini'))
    .map(chipFor)
    .join('');
  const moot = enabled
    ? ''
    : `<div class="models"><span class="hint">${escapeHtml(t('dashboard.models.offHint'))}</span></div>`;
  return (
    moot +
    `<div class="models">` +
    `<span class="models-label">${escapeHtml(t('dashboard.models.claude'))}</span>` +
    claudeChips +
    `<span class="hint">${escapeHtml(t('dashboard.models.unlisted'))}</span>` +
    `</div>` +
    `<div class="models">` +
    `<span class="models-label">${escapeHtml(t('dashboard.models.gemini'))}</span>` +
    geminiChips +
    `<span class="hint">${escapeHtml(t('dashboard.models.geminiHint'))}</span>` +
    `</div>` +
    `<div class="models">` +
    `<span class="models-label">${escapeHtml(t('dashboard.models.openai'))}</span>` +
    gptChips +
    grokChips +
    otherChips +
    `<span class="hint">${escapeHtml(t('dashboard.models.openaiHint'))}</span>` +
    `</div>` +
    `<div class="models">` +
    `<span class="models-label">PXPIPE_MODELS</span>` +
    `<input class="models-csv" id="models-csv" type="text" name="list" ` +
    `value="${escapeHtml(active.join(','))}" spellcheck="false" autocomplete="off" ` +
    `hx-post="/fragments/models" hx-target="#frag-models" hx-trigger="change">` +
    `<span class="hint">${escapeHtml(t('dashboard.models.csvHint'))}</span>` +
    `</div>`
  );
}

// ---- session hero --------------------------------------------------------

// Must stay in lockstep with ASSUMED_INPUT_USD_PER_MTOK in src/dashboard.ts.
const INPUT_USD_PER_MTOK = 10.0;
void INPUT_USD_PER_MTOK; // suppress unused-var; renderHeaderFragment uses the server's pricing block.

// Lifetime hero. Reads the SAME cumulative weighted totals as the header strip
// (serveStats), so the headline and the "$ saved" tiles can never disagree, and
// the number stops swinging on tiny per-session samples. Cache-weighted on
// purpose ("lifeweight"): it answers "did pxpipe move my real, cache-discounted
// bill since this proxy started", not a raw token count.
export function renderSessionSummaryFragment(s: StatsPayload, locale = 'en'): string {
  const t = (
    key: string,
    params?: Readonly<Record<string, string | number | boolean>>,
  ): string => dashboardT(locale, key, params);
  const measured = s.compressed_requests ?? 0;
  if (measured <= 0) {
    return (
      `<div class="hero hero-empty">` +
      `<div class="hero-eyebrow">${escapeHtml(t('dashboard.summary.sinceStart'))}</div>` +
      `<div class="hero-headline">${escapeHtml(t('dashboard.summary.warming'))}</div>` +
      `<div class="hero-sub">${escapeHtml(t('dashboard.summary.warmingHelp'))}</div>` +
      `</div>`
    );
  }
  // Cache-aware reduction — same basis as the Details panel + Saved column.
  // Raw count_tokens would over-claim: most of the text baseline would have been
  // cheap cache-reads (~0.1×), not full-price tokens. Weighting both sides at their
  // real cache rate is the only comparison that can't contradict the Saved column.
  // Input-only: pxpipe never touches output, so lumping it in just dampened the %.
  const baselineW = s.baseline_input_weighted ?? 0; // same context as text, cache-aware
  const actualW = s.actual_input_weighted ?? 0; // what we actually sent, cache-aware
  const outMult = s.pricing_assumptions?.output_multiplier || 5;
  const rawOutput = (s.output_weighted ?? 0) / outMult; // reply — never compressed
  const inputPct = baselineW > 0 ? (1 - actualW / baselineW) * 100 : 0;
  const positive = inputPct >= 0;
  const bigNum = `${Math.abs(inputPct).toFixed(0)}%`;
  const word = t(positive ? 'dashboard.summary.fewerTokens' : 'dashboard.summary.moreTokens');

  return (
    `<div class="hero${positive ? '' : ' hero-neg'}">` +
    `<div class="hero-eyebrow">${escapeHtml(t('dashboard.summary.sinceStart'))} · ${escapeHtml(t('dashboard.summary.imagedRequests', { count: numFmt(measured) }))}</div>` +
    `<div class="hero-headline"><span class="hero-num">${bigNum}</span> ${word}</div>` +
    `<div class="hero-sub">` +
    `<strong>${kFmt(actualW)}</strong> ${escapeHtml(t('dashboard.summary.accountedVs'))} <strong>${kFmt(baselineW)}</strong> ${escapeHtml(t('dashboard.summary.plainText'))} ${escapeHtml(t('dashboard.summary.latestUntouched'))}` +
    `</div>` +
    `<div class="hero-meta">` +
    `${escapeHtml(t('dashboard.summary.providerBasis'))} · ` +
    `${escapeHtml(t('dashboard.summary.outputUntouched'))} (${kFmt(rawOutput)}) · ${escapeHtml(t('dashboard.summary.noDollarAssumptions'))}` +
    `</div>` +
    `</div>`
  );
}

// ---- stat strip + "Show the math" drawer ----------------------------------

function mathRow(key: string, val: number | string | undefined, note = ''): string {
  const v = typeof val === 'number' ? numFmt(val) : String(val ?? '-');
  return `<div><span class="k">${key}:</span> <span class="v">${escapeHtml(v)}</span> <span class="k">${note}</span></div>`;
}

function mathBlock(title: string, body: string): string {
  return `<section class="math-block"><h4>${title}</h4><div class="formula">${body}</div></section>`;
}

/** Stat tile; `tip` adds a hover "?" explainer. */
function statTile(
  label: string,
  value: string,
  sub: string,
  cls = '',
  tip = '',
): string {
  const q = tip
    ? `<span class="q" tabindex="0" aria-label="${escapeHtml(tip)}" title="${escapeHtml(tip)}" data-tip="${escapeHtml(tip)}">?</span>`
    : '';
  return (
    `<div class="tile">` +
    `<div class="tile-label">${label}${q}</div>` +
    `<div class="tile-value ${cls}">${value}</div>` +
    `<div class="tile-sub">${sub}</div>` +
    `</div>`
  );
}

export function renderHeaderFragment(s: StatsPayload, port: number, locale = 'en'): string {
  const t = (
    key: string,
    params?: Readonly<Record<string, string | number | boolean>>,
  ): string => dashboardT(locale, key, params);
  const pa = s.pricing_assumptions;
  const unpricedImaged = Math.max(
    0,
    (s.compressed_requests ?? 0) - (s.compressed_paid_requests ?? 0),
  );
  const onlyUnpriced = unpricedImaged > 0 && (s.compressed_paid_requests ?? 0) === 0;

  // Compare the same imaged requests on both sides. Passthrough requests are
  // generally smaller because the profitability gate selected them, so their
  // average is not a valid "without pxpipe" counterfactual.
  const cAvg = s.compressed_avg_usd_per_request ?? 0;
  const paidImaged = s.compressed_paid_requests ?? 0;
  const withoutAvg = paidImaged > 0 ? cAvg + (s.saved_usd ?? 0) / paidImaged : 0;
  const costTile = paidImaged > 0
    ? statTile(
        t('dashboard.header.costPerRequest'),
        `$${cAvg.toFixed(4)}`,
        t('dashboard.header.vsWithout', { value: `$${withoutAvg.toFixed(4)}` }),
        cAvg <= withoutAvg ? 'pos' : 'neg',
        t('dashboard.header.costTip'),
      )
    : onlyUnpriced
      ? statTile(
          t('dashboard.header.costPerRequest'),
          '—',
          t('dashboard.header.pricingNotConfigured'),
          'muted-val',
          t('dashboard.header.tokenSavingsNoPricing'),
        )
      : statTile(
        t('dashboard.header.costPerRequest'),
        t('dashboard.header.collecting'),
        t('dashboard.header.waitingPaid'),
        'muted-val',
        t('dashboard.header.comparisonAfterUsage'),
      );

  const savedUsdTile = onlyUnpriced
    ? statTile(
        t('dashboard.header.estimatedSaved'),
        '—',
        t('dashboard.header.pricingNotConfigured'),
        'muted-val',
        t('dashboard.header.dollarRequiresPricing'),
      )
    : statTile(
        t('dashboard.header.estimatedSaved'),
        `$${(s.saved_usd ?? 0).toFixed(2)}`,
        unpricedImaged > 0
          ? t(unpricedImaged === 1 ? 'dashboard.header.excludedPricingOne' : 'dashboard.header.excludedPricing', { count: numFmt(unpricedImaged) })
          : t('dashboard.header.baseInputPrice', { value: `$${pa.input_per_mtok}` }),
        '',
        t('dashboard.header.estimateTip'),
      );

  const strip =
    `<div class="strip">` +
    statTile(t('dashboard.header.requests'), numFmt(s.requests), t('dashboard.header.turnedIntoImages', { count: numFmt(s.compressed_requests) })) +
    statTile(
      t('dashboard.header.inputTokensSaved'),
      numFmt(s.saved_input_tokens),
      t('dashboard.header.vsPlainText'),
      'pos',
       t('dashboard.header.inputSavingsTip'),
     ) +
    savedUsdTile +
    costTile +
    `</div>`;

  // math drawer
  const savedMath =
    `<div><span class="k">${escapeHtml(t('dashboard.math.formula'))}:</span> <span class="v">saved = baseline − actual</span></div>` +
    `<div><span class="k">${escapeHtml(t('dashboard.math.weights'))}:</span> <span class="v">input×1.0, cache_write_5m×1.25, cache_write_1h×2.0, cache_read×0.10</span></div>` +
    `<div class="sp"></div>` +
    mathRow('baseline', s.baseline_input_weighted, `(${escapeHtml(t('dashboard.math.cacheAwareBaseline'))})`) +
    mathRow('actual', s.actual_input_weighted, `(${escapeHtml(t('dashboard.math.actualInput'))})`) +
    mathRow('saved', s.saved_input_tokens, `<span class="op">=</span> baseline − actual`) +
    `<span class="src">${escapeHtml(t('dashboard.math.outputExcluded'))}</span>`;

  const usdMath = onlyUnpriced
    ? `<div><span class="v">${escapeHtml(t('dashboard.math.unavailableProvider'))}</span></div>` +
      `<span class="src">${escapeHtml(t('dashboard.math.tokenSavingsStill'))}</span>`
    :
    `<div><span class="k">${escapeHtml(t('dashboard.math.formula'))}:</span> <span class="v">$ saved = saved_tokens × $${pa.input_per_mtok}/Mtok</span></div>` +
    `<div class="sp"></div>` +
    mathRow('saved_tokens', s.saved_input_tokens, `(${escapeHtml(t('dashboard.math.inputSide'))})`) +
    mathRow('saved_usd', `$${(s.saved_usd || 0).toFixed(4)} `, `<span class="op">=</span> saved_tokens × input_rate / 1e6`) +
    `<span class="src">${escapeHtml(t('dashboard.math.source'))}: ${escapeHtml(pa.source || 'docs.anthropic.com pricing')}</span>`;

  const costPerRequestMath =
    `<div><span class="k">${escapeHtml(t('dashboard.math.formula'))}:</span> <span class="v">without_pxpipe = actual_imaged + measured_savings</span></div>` +
    `<div><span class="k">${escapeHtml(t('dashboard.math.why'))}:</span> <span class="v">${escapeHtml(t('dashboard.math.samePopulation'))}</span></div>` +
    `<div class="sp"></div>` +
    mathRow(`actual imaged (n=${paidImaged})`, `$${(s.compressed_actual_usd || 0).toFixed(4)}`, t('dashboard.math.totalAvg', { value: `$${cAvg.toFixed(4)}` })) +
    mathRow(t('dashboard.math.measuredSavings'), `$${(s.saved_usd || 0).toFixed(4)}`, escapeHtml(t('dashboard.math.cacheAwareTotal'))) +
    mathRow(t('dashboard.math.withoutPxpipe'), `$${withoutAvg.toFixed(4)}/req`, '<span class="op">=</span> (actual imaged + measured savings) / n') +
    `<span class="src">${escapeHtml(t('dashboard.math.unmeasuredZero'))}</span>`;

  const pctMath =
    `<div><span class="k">${escapeHtml(t('dashboard.math.formula'))}:</span> <span class="v">share_of_spend = saved / (all_baseline_equivalent + all_output × ${pa.output_multiplier})</span></div>` +
    `<div><span class="k">${escapeHtml(t('dashboard.math.diagnostic'))}:</span> <span class="v">${escapeHtml(t('dashboard.math.diagnosticExplanation'))}</span></div>` +
    `<div class="sp"></div>` +
    mathRow('saved', s.saved_input_tokens, `(${escapeHtml(t('dashboard.math.measuredNumerator'))})`) +
    mathRow('all_baseline_equivalent', s.all_baseline_equivalent_weighted, `(${escapeHtml(t('dashboard.math.everyPaidBaseline'))})`) +
    mathRow(`all_output × ${pa.output_multiplier}`, s.all_output_weighted, `(${escapeHtml(t('dashboard.math.everyPaidRequest'))})`) +
    mathRow('share_of_spend', (s.saved_pct_of_all_spend || 0).toFixed(1) + '%', `<span class="op">=</span> saved / counterfactual_total × 100`) +
    mathRow('all_usage_requests', s.all_usage_requests, `(${escapeHtml(t('dashboard.math.denominatorCount'))})`) +
    `<span class="src">${escapeHtml(t('dashboard.math.boundedCounterfactual'))}</span>`;

  const tokeqMath =
    `<div><span class="k">${escapeHtml(t('dashboard.math.formula'))}:</span> <span class="v">token_equivalent = input + output × ${pa.output_multiplier}</span></div>` +
    `<div><span class="k">${escapeHtml(t('dashboard.math.why'))}:</span> <span class="v">${escapeHtml(t('dashboard.math.weeklyWhy'))} ($${pa.input_per_mtok} input vs $${pa.input_per_mtok * pa.output_multiplier} output)</span></div>` +
    `<div class="sp"></div>` +
    mathRow('actual_token_equivalent', s.actual_token_equivalent) +
    mathRow('baseline_token_equivalent', s.baseline_token_equivalent, `(${escapeHtml(t('dashboard.math.unproxiedCounterfactual'))} ×${pa.output_multiplier})`) +
    `<div class="sp"></div>` +
    mathRow('events_with_measurement', s.events_with_measurement, `(${escapeHtml(t('dashboard.math.eventsMeasurement'))})`) +
    mathRow('measured_text_chars', s.measured_text_chars, '') +
    mathRow('measured_thinking_chars', s.measured_thinking_chars, '') +
    mathRow('measured_tool_use_chars', s.measured_tool_use_chars, '') +
    mathRow('measured_redacted_blocks', s.measured_redacted_block_count, `(${escapeHtml(t('dashboard.math.opaqueBlocks'))})`) +
    `<span class="src">${escapeHtml(t('dashboard.math.measuredNoEstimate'))}</span>`;

  const drawer =
    `<details class="drawer" id="math-drawer">` +
    `<summary>${escapeHtml(t('dashboard.math.show'))}</summary>` +
    `<div class="drawer-intro">${escapeHtml(t('dashboard.math.intro'))}</div>` +
    `<div class="math-grid">` +
    mathBlock(t('dashboard.header.inputTokensSaved'), savedMath) +
    mathBlock(t('dashboard.math.dollarsSaved'), usdMath) +
    mathBlock(t('dashboard.math.costImaged'), costPerRequestMath) +
    mathBlock(t('dashboard.math.shareSpend'), pctMath) +
    mathBlock(t('dashboard.math.tokenEquivalent'), tokeqMath) +
    `</div></details>`;

  // NOTE: tests assert the header fragment contains the port number.
  const updated = `<div class="updated"><span class="live-dot"></span>${escapeHtml(t('dashboard.math.live'))} · ${escapeHtml(t('dashboard.math.port'))} ${port} · ${escapeHtml(t('dashboard.math.uptime'))} ${formatDuration(s.uptime_sec)}</div>`;

  return strip + drawer + updated;
}

// ---- request x-ray (image vs text breakdown) -----------------------------

export interface ContextMapData {
  id: number; // first image id (matches recent-table link)
  baselineTokens: number; // RAW count_tokens as plain text (cache-blind; sub-line only)
  realInput: number; // RAW input + cache_create + cache_read (cache-blind)
  baselineInputEff: number; // cache-WEIGHTED baseline — what text would actually be billed
  actualInputEff: number; // cache-WEIGHTED actual — what the images were actually billed
  haveBaseline: boolean; // weighted pair is trustworthy (baseline probe resolved)
  cacheRead: number; // cache_read tokens this turn. >0 ⇒ the actual request hit cache.
  warm: boolean; // did the TEXT baseline's prefix read warm? Server-observed only:
  // true iff the actual request had cache_read > 0. This keeps the text baseline
  // on the same cache state as the image path; no wall-clock-only inference.
  output: number;
  imageCount: number;
  /** Image blocks the CLIENT sent. They spend from the provider's cap exactly
   *  like ours, so they explain a turn that compressed less than usual. */
  nativeImages?: number;
  /** Image blocks really on the wire. Lower than imageCount when the history
   *  collapse absorbed messages that already carried our images. */
  wireImages?: number;
  /** Imaging steps that degraded to text because the cap was full. */
  imageBudgetSkips?: number;
  baselineImagedTokens?: number;
  buckets: Partial<Record<string, number>>; // bucket → chars rendered to PNG
  imageIds: number[]; // image-ring ids for the gallery
  compressed: boolean;
  model?: string;
  responsesComposition?: {
    instructions: number; systemDeveloper: number; userAssistant: number;
    functionCalls: number; functionOutputs: number; reasoningEncrypted: number;
    compactionOpaque: number; toolsJson: number; other: number;
    totalLocal: number; imageParts: number;
    completedFunctionPairs?: number; recentNativeFunctionPairs?: number;
    oldFunctionPairs?: number; openFunctionCalls?: number;
    orphanFunctionOutputs?: number; malformedFunctionItems?: number;
    imageableFunctionCalls?: number; imageableFunctionOutputs?: number;
    collapsedFunctionPairs?: number; collapsedFunctionCalls?: number;
    collapsedFunctionOutputs?: number;
  };
  /** Difference between the provider text counterfactual and local o200k buckets.
   * Can include envelope, tokenizer, and server-side additions. */
  responsesUnexplainedTokens?: number;
  restored?: boolean; // rebuilt from JSONL after a restart — PNG thumbnails are gone
}

const CTXMAP_BUCKETS: ReadonlyArray<readonly [string, string]> = [
  ['static_slab', 'dashboard.context.bucket.static'],
  ['reminder', 'dashboard.context.bucket.reminder'],
  ['tool_result_prose', 'dashboard.context.bucket.toolProse'],
  ['tool_result_log', 'dashboard.context.bucket.toolLogs'],
  ['tool_result_json', 'dashboard.context.bucket.toolJson'],
  ['history', 'dashboard.context.bucket.history'],
];

/** Image-vs-text breakdown for one request. */
export function renderContextMapFragment(
  c: ContextMapData | undefined,
  history: ContextMapData[] = [],
  notFound = false,
  locale = 'en',
): string {
  const t = (
    key: string,
    params?: Readonly<Record<string, string | number | boolean>>,
  ): string => dashboardT(locale, key, params);
  const isLatest = c !== undefined && c.id === (history.at(-1)?.id ?? -1);
  if (notFound) {
    return `<div class="ctxmap"><div class="empty-note">${escapeHtml(t('dashboard.context.notFound'))}</div></div>`;
  }
  if (!c || (c.baselineTokens <= 0 && c.imageCount <= 0)) {
    return `<div class="ctxmap"><div class="empty-note">${escapeHtml(t('dashboard.context.empty'))}</div></div>`;
  }
  // Cache-aware billing-equivalent basis — identical to the recent row's
  // As-text / Sent / Saved/lost columns. These are not raw token counts; they apply
  // Anthropic's cache rates so create/read misses are visible in the comparison.
  // The two panels can never contradict each other. The raw
  // count_tokens ratio is cache-blind: it over-states savings whenever the
  // prefix would have been a cheap cache-read, so it must NOT drive the
  // headline. It survives only as a clarifying sub-line below.
  const showCompare = c.haveBaseline && c.baselineInputEff > 0;
  const base = c.baselineInputEff;
  const real = c.actualInputEff;
  const pct = showCompare ? Math.round((1 - real / base) * 100) : 0;
  const rawShrink = c.baselineTokens > 0 ? Math.round((1 - c.realInput / c.baselineTokens) * 100) : 0;
  const totalImagedChars = CTXMAP_BUCKETS.reduce((a, [key]) => a + (c.buckets[key] ?? 0), 0);

  const imgRows = CTXMAP_BUCKETS.map(([key, labelKey]) => [labelKey, c.buckets[key] ?? 0] as const)
    .filter(([, ch]) => ch > 0)
    .map(
      ([labelKey, ch]) =>
        `<div class="ctx-row"><span class="ctx-lbl">${escapeHtml(t(labelKey))}</span><span class="ctx-val">${kFmt(ch)} chars</span></div>`,
    )
    .join('');

  const rc = c.responsesComposition;
  const responseRows: ReadonlyArray<readonly [string, number]> = rc
    ? [
        ['dashboard.context.responses.instructions', rc.instructions],
        ['dashboard.context.responses.systemDeveloper', rc.systemDeveloper],
        ['dashboard.context.responses.userAssistant', rc.userAssistant],
        ['dashboard.context.responses.toolsJson', rc.toolsJson],
        ['dashboard.context.responses.functionCalls', rc.functionCalls],
        ['dashboard.context.responses.functionOutputs', rc.functionOutputs],
        ['dashboard.context.responses.eligibleOutputs', rc.imageableFunctionOutputs ?? 0],
        ['dashboard.context.responses.imagedOutputs', rc.collapsedFunctionOutputs ?? 0],
        ['dashboard.context.responses.reasoning', rc.reasoningEncrypted],
        ['dashboard.context.responses.compaction', rc.compactionOpaque],
        ['dashboard.context.responses.other', rc.other],
      ]
    : [];
  const responseBreakdown = rc
    ? `<div class="split-note" style="margin-top:12px"><strong>${escapeHtml(t('dashboard.context.responses.heading'))}</strong></div>` +
      responseRows.filter(([, n]) => n > 0).map(([labelKey, n]) =>
        `<div class="ctx-row"><span class="ctx-lbl">${escapeHtml(t(labelKey))}</span><span class="ctx-val">${kFmt(n)} tok</span></div>`,
      ).join('') +
      `<div class="ctx-row"><span class="ctx-lbl">${escapeHtml(t('dashboard.context.responses.imageableBaseline'))}</span><span class="ctx-val">${kFmt(c.baselineImagedTokens ?? 0)} tok</span></div>` +
      `<div class="ctx-row"><span class="ctx-lbl">${escapeHtml(t('dashboard.context.responses.completedPairs'))}</span><span class="ctx-val">${rc.completedFunctionPairs ?? 0} (${rc.oldFunctionPairs ?? 0} / ${rc.recentNativeFunctionPairs ?? 0} / ${rc.collapsedFunctionPairs ?? 0})</span></div>` +
      `<div class="ctx-row"><span class="ctx-lbl">${escapeHtml(t('dashboard.context.responses.openCalls'))}</span><span class="ctx-val">${rc.openFunctionCalls ?? 0}</span></div>` +
      `<div class="ctx-row"><span class="ctx-lbl">${escapeHtml(t('dashboard.context.responses.nativeImages'))}</span><span class="ctx-val">${rc.imageParts}</span></div>` +
      `<div class="ctx-row"><span class="ctx-lbl">${escapeHtml(t('dashboard.context.responses.unexplained'))}</span><span class="ctx-val">${kFmt(c.responsesUnexplainedTokens ?? 0)} tok</span></div>` +
      `<div class="split-note">${escapeHtml(t('dashboard.context.responses.diagnostic'))}</div>`
    : '';

  const ids = c.imageIds ?? [];
  const modelLabel = c.model ?? t('dashboard.context.modelFallback');
  const gallery = ids.length
    ? `<div class="pages-title">${escapeHtml(t('dashboard.context.gallery', { model: modelLabel, count: ids.length }))}</div>` +
      `<div class="pages">` +
      ids
        .map(
          (id) =>
            `<img class="page" src="/proxy-latest-png?id=${id}" alt="page ${id}" loading="lazy" title="${escapeHtml(t('dashboard.context.galleryTitle', { id }))}" onclick="ppPin(${id});ppSource(true)" onerror="this.classList.add('page-gone'); this.alt=${escapeHtml(JSON.stringify(t('dashboard.context.galleryExpired', { id })))};" />`,
        )
        .join('') +
      `</div>`
    : c.restored && c.imageCount > 0
      ? `<div class="pages-title">${escapeHtml(t('dashboard.context.galleryRestored', { count: c.imageCount }))}</div>`
      : '';

  // Did the TEXT baseline's prefix read warm this turn? This follows the actual
  // request's observed cache state: cache_read > 0 means warm, cache_read === 0
  // means cold. No wall-clock-only counterfactual is credited.
  const warm = showCompare && c.warm;
  const google = c.model?.startsWith('gemini-') === true;
  const textNoun = t(warm ? 'dashboard.context.cachedText' : 'dashboard.context.text');
  // Raw count_tokens can grow (imaging bloated a short prompt), so report the
  // direction explicitly instead of rendering a negative shrink percentage.
  const rawPhrase = rawShrink >= 0
    ? t('dashboard.context.rawShrank', { pct: rawShrink })
    : t('dashboard.context.rawGrew', { pct: -rawShrink });
  const headline = !showCompare
    ? `<strong>${kFmt(c.actualInputEff || c.realInput)}</strong> ${escapeHtml(t('dashboard.context.billingSent'))}`
    : pct >= 0
      ? google
        ? `<span class="ctx-big">${pct}%</span> ${escapeHtml(t('dashboard.context.smaller'))} — ${escapeHtml(t('dashboard.context.textWouldAccount'))} <strong>${kFmt(base)}</strong> ${escapeHtml(t('dashboard.context.inputTokens'))}; ${escapeHtml(t('dashboard.context.imagesAccount'))} <strong>${kFmt(real)}</strong>`
        : `<span class="ctx-big">${pct}%</span> ${escapeHtml(t('dashboard.context.smaller'))} — ${escapeHtml(textNoun)} ${escapeHtml(t('dashboard.context.wouldBill'))} <strong>${kFmt(base)}</strong> ${escapeHtml(t('dashboard.context.inputTokens'))}; ${escapeHtml(t('dashboard.context.imagesBilled'))} <strong>${kFmt(real)}</strong>`
      : google
        ? `<span class="ctx-big">${-pct}%</span> ${escapeHtml(t('dashboard.context.bigger'))} — ${escapeHtml(t('dashboard.context.imagesAccount'))} <strong>${kFmt(real)}</strong> ${escapeHtml(t('dashboard.context.inputTokens'))} ${escapeHtml(t('dashboard.context.vsText'))} <strong>${kFmt(base)}</strong>`
        : `<span class="ctx-big">${-pct}%</span> ${escapeHtml(t('dashboard.context.bigger'))} — ${escapeHtml(t('dashboard.context.imagesBilled'))} <strong>${kFmt(real)}</strong> ${escapeHtml(t('dashboard.context.inputTokens'))} ${escapeHtml(t('dashboard.context.vsText'))} <strong>${kFmt(base)}</strong> ${escapeHtml(t('dashboard.context.forNoun', { noun: textNoun }))}`;
  const subnote = !showCompare
    ? t('dashboard.context.noBaseline')
    : google
      ? `${t('dashboard.context.providerBasisGap')} ${rawPhrase}`
      : !warm
        ? `${t('dashboard.context.coldBasis')} ${rawPhrase}`
        : pct < 0 && rawShrink > 0
          ? t('dashboard.context.warmLoss', { pct: rawShrink })
          : `${t('dashboard.context.warmBasis')} ${rawPhrase}`;
  const title = t(isLatest ? 'dashboard.context.latestRequest' : 'dashboard.context.selectedRequest');

  // The provider caps a request at 100 image blocks and counts the CLIENT's
  // images against the same limit. Three facts are worth showing, and only when
  // they are true — a quiet turn should stay quiet:
  //   - the client brought its own images (they shrank our room),
  //   - we rendered more pages than we shipped (the collapse ate some),
  //   - we gave up on imaging something because the cap was full.
  const capBits: string[] = [];
  const nativeImages = c.nativeImages ?? 0;
  const imageBudgetSkips = c.imageBudgetSkips ?? 0;
  if (nativeImages > 0) {
    capBits.push(t(nativeImages === 1 ? 'dashboard.context.capNativeOne' : 'dashboard.context.capNative', { count: nativeImages }));
  }
  if (c.wireImages !== undefined && c.wireImages < c.imageCount + nativeImages) {
    const absorbed = c.imageCount + nativeImages - c.wireImages;
    capBits.push(t(absorbed === 1 ? 'dashboard.context.capAbsorbedOne' : 'dashboard.context.capAbsorbed', { count: absorbed, wire: c.wireImages }));
  }
  if (imageBudgetSkips > 0) {
    capBits.push(t(imageBudgetSkips === 1 ? 'dashboard.context.capSkippedOne' : 'dashboard.context.capSkipped', { count: imageBudgetSkips }));
  }
  const capNote = capBits.length
    ? `<div class="split-note cap-note">${capBits.map(escapeHtml).join(' · ')}</div>`
    : '';


  return (
    `<div class="ctxmap">` +
    `<div class="ctx-headline"><span class="ctx-title">${title}</span> ${headline}</div>` +
    `<div class="split-note ctx-subnote">${subnote}</div>` +
    `<div class="legend"><span class="tag tag-img">${escapeHtml(t('dashboard.context.becameImage'))}</span><span class="tag tag-txt">${escapeHtml(t('dashboard.context.stayedText'))}</span></div>` +
    `<div class="split">` +
    `<div class="split-col split-img">` +
    `<div class="split-head">${escapeHtml(t('dashboard.context.compressedImages'))} <span class="split-sum">${escapeHtml(t('dashboard.context.pagesSummary', { chars: kFmt(totalImagedChars), count: c.imageCount }))}</span></div>` +
    (imgRows || `<div class="ctx-row muted-row">${escapeHtml(t('dashboard.context.nothingImaged'))}</div>`) +
    capNote +
    `<div class="split-note">${escapeHtml(t('dashboard.context.imageApprox'))}</div>` +
    `</div>` +
    `<div class="split-col split-txt">` +
    `<div class="split-head">${escapeHtml(t('dashboard.context.keptPlain'))} <span class="split-sum">${escapeHtml(t('dashboard.context.byteExact'))}</span></div>` +
    `<div class="ctx-row"><span class="ctx-lbl">${escapeHtml(t('dashboard.context.latestMessages'))}</span><span class="ctx-val">${escapeHtml(t('dashboard.context.verbatim'))}</span></div>` +
    `<div class="ctx-row"><span class="ctx-lbl">${escapeHtml(t('dashboard.context.modelReply'))}</span><span class="ctx-val">${kFmt(c.output)} tok</span></div>` +
    `<div class="split-note">${escapeHtml(t('dashboard.context.exactSafe'))}</div>` +
    `</div>` +
    `</div>` +
    responseBreakdown +
    gallery +
    `</div>`
  );
}

// ---- recent requests table -----------------------------------------------

function statusCls(status: number): string {
  if (status >= 500) return 'bad';
  if (status >= 400) return 'warn';
  return 'good';
}

export function renderRecentFragment(p: RecentPayload, locale = 'en'): string {
  const t = (
    key: string,
    params?: Readonly<Record<string, string | number | boolean>>,
  ): string => dashboardT(locale, key, params);
  const rows = (p.recent ?? []).slice().reverse();
  const body =
    rows.length === 0
      ? `<tr><td colspan="10" class="empty-cell">${escapeHtml(t('dashboard.recent.empty'))}</td></tr>`
      : rows
          .map((e: RecentRow, i: number) => {
            const viewId = (e.img_ids ?? (e.img_id != null ? [e.img_id] : []))[0];
            const viewLink =
              viewId != null
                ? `<a class="row-view" href="#" hx-get="/fragments/context-map?req=${viewId}" hx-target="#frag-context-map" hx-swap="innerHTML">${escapeHtml(t('dashboard.recent.details'))}</a>`
                : `<span class="muted">—</span>`;
            const saved = e.session_saved_so_far_delta;
            // A loss that disappears when the newly written prefix is repriced at
            // the read rate is just the one-time cache-create premium — the
            // purchase price of the cheap cache reads on the turns that follow.
            // Mark it so create turns don't read as gate failures.
            const cc = e.cache_create ?? 0;
            const createLoss =
              saved != null &&
              saved < 0 &&
              cc > 0 &&
              saved + cc * (CACHE_CREATE_RATE - CACHE_READ_RATE) > 0;
            const createNote = createLoss
              ? ` <span class="mk-create" title="${escapeHtml(t('dashboard.recent.createTip', {
                  createRate: CACHE_CREATE_RATE,
                  tokens: numFmt(cc),
                  readRate: CACHE_READ_RATE,
                }))}">${escapeHtml(t('dashboard.recent.create'))}</span>`
              : '';
            const savedCell = saved == null
              ? `<td class="num muted">—</td>`
              : saved > 0
                ? `<td class="num pos">${numFmt(saved)}</td>`
                : saved < 0
                  ? `<td class="num neg">${numFmt(saved)}${createNote}</td>`
                  : `<td class="num">0</td>`;
            const imaged = e.cc_added
              ? `<span class="badge badge-img">${escapeHtml(t('dashboard.recent.image'))}</span>`
              : `<span class="badge badge-txt">${escapeHtml(t('dashboard.recent.text'))}</span>`;
            return (
              `<tr>` +
              `<td class="muted">${i + 1}</td>` +
              `<td><span class="pill pill-${statusCls(e.status)}">${e.status}</span></td>` +
              `<td class="endp">${escapeHtml(shortPath(e.path))}</td>` +
              `<td>${e.model ? `<code>${escapeHtml(e.model)}</code>` : '<span class="muted">—</span>'}</td>` +
              `<td>${imaged}</td>` +
              `<td class="num">${e.cache_read != null ? numFmt(e.cache_read) : '—'}</td>` +
              `<td class="num">${e.baseline_input != null ? numFmt(e.baseline_input) : '—'}</td>` +
              `<td class="num">${e.actual_input != null ? numFmt(e.actual_input) : '—'}</td>` +
              savedCell +
              `<td class="num">${viewLink}</td>` +
              `</tr>`
            );
          })
          .join('');
  return (
    `<table class="rtable"><thead><tr>` +
    `<th>#</th>` +
    `<th>${escapeHtml(t('dashboard.recent.result'))}</th>` +
    `<th>${escapeHtml(t('dashboard.recent.endpoint'))}</th>` +
    `<th>${escapeHtml(t('dashboard.recent.model'))}</th>` +
    `<th title="${escapeHtml(t('dashboard.recent.sentAsTip'))}">${escapeHtml(t('dashboard.recent.sentAs'))}</th>` +
    `<th class="num" title="${escapeHtml(t('dashboard.recent.cacheHitsTip'))}">${escapeHtml(t('dashboard.recent.cacheHits'))}</th>` +
    `<th class="num" title="${escapeHtml(t('dashboard.recent.asTextTip'))}">${escapeHtml(t('dashboard.recent.asText'))}</th>` +
    `<th class="num" title="${escapeHtml(t('dashboard.recent.sentTip'))}">${escapeHtml(t('dashboard.recent.sent'))}</th>` +
    `<th class="num" title="${escapeHtml(t('dashboard.recent.savedLostTip'))}">${escapeHtml(t('dashboard.recent.savedLost'))}</th>` +
    `<th></th>` +
    `</tr></thead><tbody>${body}</tbody></table>`
  );
}

// ---- image ↔ source inspector --------------------------------------------

export interface LatestFragmentInput {
  payload: RecentPayload;
  pin: number | null; // pinned image id, or null to follow latest
  showSource: boolean;
  sourceText: string | null; // null = not captured
}

export function renderLatestFragment(inp: LatestFragmentInput, locale = 'en'): string {
  const t = (
    key: string,
    params?: Readonly<Record<string, string | number | boolean>>,
  ): string => dashboardT(locale, key, params);
  const { payload, pin, showSource, sourceText } = inp;
  const hasPreview = payload.has_preview === true;
  const meta = payload.preview_meta ?? '';
  const imageIds = payload.image_ids ?? [];
  const pinnedEvicted = pin != null && !imageIds.includes(pin);

  // Pinned id, or latest (cache-busted by meta).
  const imgSrc =
    pin != null
      ? `/proxy-latest-png?id=${pin}`
      : `/proxy-latest-png?t=${encodeURIComponent(meta)}`;

  const pinBar =
    pin != null
      ? `<div class="viewer-bar"><button class="mini-btn" type="button" onclick="ppPin(null)">${escapeHtml(t('dashboard.latest.back'))}</button><span class="mini-label">${escapeHtml(t('dashboard.latest.image', { id: pin }))}</span></div>`
      : '';

  let main: string;
  if (pin != null && pinnedEvicted) {
    main = `<div class="evicted">${escapeHtml(t('dashboard.latest.evicted', { id: pin }))}</div>`;
  } else if (pin != null || hasPreview) {
    // When source pane is open the image appears inside the pairing — don't duplicate it.
    main = showSource ? '' : `<div class="frame"><img src="${imgSrc}" alt="${escapeHtml(t('dashboard.latest.renderedAlt'))}" /></div>`;
  } else {
    main = `<div class="empty-note">${escapeHtml(t('dashboard.latest.noImages'))}</div>`;
  }

  const showBtn = pin != null ? !pinnedEvicted : hasPreview;
  const caption =
    pin != null ? escapeHtml(t('dashboard.latest.image', { id: pin })) : meta ? `${escapeHtml(meta)} · ${escapeHtml(t('dashboard.latest.topLeft'))}` : '';
  const srcBtn = showBtn
    ? `<button class="mini-btn" type="button" onclick="ppSource(${showSource ? 'false' : 'true'})">${escapeHtml(t(showSource ? 'dashboard.latest.hideSource' : 'dashboard.latest.showSource'))}</button>`
    : '';

  let pane = '';
  if (showSource) {
    pane =
      sourceText == null
        ? `<div class="evicted">${escapeHtml(t('dashboard.latest.sourceMissing'))}</div>`
        : `<div class="pairing">` +
          `<div class="pair-col"><div class="pair-head pair-img">${escapeHtml(t('dashboard.latest.modelSees'))}</div><div class="frame frame-sm"><img src="${imgSrc}" alt="${escapeHtml(t('dashboard.latest.renderedAlt'))}" /></div></div>` +
          `<div class="pair-mid">${escapeHtml(t('dashboard.latest.madeFrom'))}</div>` +
          `<div class="pair-col"><div class="pair-head pair-txt">${escapeHtml(t('dashboard.latest.originalText'))}</div><pre class="src-pane">${escapeHtml(sourceText)}</pre></div>` +
          `</div>`;
  }

  return pinBar + main + `<div class="viewer-caption">${caption} ${srcBtn}</div>` + pane;
}

// ---- sessions bar chart --------------------------------------------------

const TOP_N = 8;

export function renderSessionsUnavailableFragment(locale = 'en'): string {
  return `<div class="status">${escapeHtml(dashboardT(locale, 'dashboard.sessions.unavailable'))}</div>`;
}

export function renderSessionsFragment(p: SessionsPayload, locale = 'en'): string {
  const t = (key: string): string => dashboardT(locale, key);
  const all = p.sessions ?? [];
  const rows = [...all]
    .sort((a, b) => (b.tokensSavedEst ?? 0) - (a.tokensSavedEst ?? 0))
    .slice(0, TOP_N);
  const max = rows.reduce((m, s) => Math.max(m, s.tokensSavedEst ?? 0), 0);

  const label = (s: SessionRow) => {
    const proj = s.claudeCode?.projectPath || s.project;
    return proj ? shortPath(proj) : s.id.slice(0, 8);
  };
  const barPct = (v: number) => (max <= 0 || v <= 0 ? 0 : (v / max) * 100);

  const status = `<div class="status">${all.length} ${escapeHtml(t('dashboard.sessions.tracked'))}</div>`;
  if (rows.length === 0) return status + `<div class="empty">${escapeHtml(t('dashboard.sessions.empty'))}</div>`;

  const chart = rows
    .map((s) => {
      const v = s.tokensSavedEst ?? 0;
      const pct = barPct(v);
      const fill = pct > 0 ? `<div class="bar-fill" style="width:max(3px,${pct}%)"></div>` : '';
      return (
        `<div class="bar-row">` +
        `<div class="bar-label" title="${escapeHtml(s.claudeCode?.projectPath || s.project || s.id)}">${escapeHtml(label(s))}</div>` +
        `<div class="bar-track">${fill}</div>` +
        `<div class="bar-val${v < 0 ? ' neg' : ''}">${numFmt(v)}</div>` +
        `</div>`
      );
    })
    .join('');

  return (
    status +
    `<div class="bars">${chart}</div>` +
    `<div class="axis">${escapeHtml(t('dashboard.sessions.axis'))} · top ${rows.length} of ${all.length}</div>`
  );
}

// ---- Control Room V5 ------------------------------------------------------

export function renderControlRoomFragment(snapshot: ControlRoomSnapshot | null, locale = 'en'): string {
  const t = (key: string): string => dashboardT(locale, key);
  if (!snapshot) {
    return (
      `<div class="status"><strong>Control Room V5 · NOT_AVAILABLE</strong> — ${escapeHtml(t('dashboard.controlRoom.noEvidence'))}</div>` +
      `<table class="dtable"><tbody></tbody></table>`
    );
  }

  const labels: Readonly<Record<keyof ControlRoomSnapshot['sections'], string>> = {
    receipts: t('dashboard.controlRoom.receipts'),
    recovery: t('dashboard.controlRoom.recovery'),
    agent: t('dashboard.controlRoom.agent'),
    learning: t('dashboard.controlRoom.learning'),
    provider: t('dashboard.controlRoom.provider'),
    mcp: t('dashboard.controlRoom.mcp'),
    i18n: t('dashboard.controlRoom.i18n'),
    webStudio: t('dashboard.controlRoom.webStudio'),
    security: t('dashboard.controlRoom.security'),
    benchmarks: t('dashboard.controlRoom.benchmarks'),
    release: t('dashboard.controlRoom.releaseReadiness'),
  };

  const rows = (Object.entries(snapshot.sections) as Array<[
    keyof ControlRoomSnapshot['sections'],
    ControlRoomSnapshot['sections'][keyof ControlRoomSnapshot['sections']],
  ]>).map(([key, section]) =>
    `<tr><td>${escapeHtml(labels[key])}</td><td class="num">${escapeHtml(section.status)}</td></tr>`
  ).join('');

  const warnings = Object.values(snapshot.sections)
    .flatMap((section) => section.warnings)
    .map((warning) => `<div class="status">⚠ ${escapeHtml(warning)}</div>`)
    .join('');

  const release = snapshot.sections.release.evidence;
  const releaseSummary =
    `<div class="status">${escapeHtml(t('dashboard.controlRoom.releaseReadiness'))} · <strong>${escapeHtml(release.technicalStatus)}</strong>` +
    ` · ${escapeHtml(t('dashboard.controlRoom.requiredGates'))} ${numFmt(release.verifiedRequiredGates)}/${numFmt(release.requiredGates)}` +
    ` · ${escapeHtml(t('dashboard.controlRoom.blockers'))} ${numFmt(release.blockers)} · ${escapeHtml(t('dashboard.controlRoom.releaseActions'))}</div>`;

  return (
    `<div class="status"><strong>Control Room V5 · ${escapeHtml(snapshot.overall)}</strong> · commit <code>${escapeHtml(snapshot.sourceCommit.slice(0, 12))}</code></div>` +
    releaseSummary +
    `<table class="dtable"><tbody>${rows}</tbody></table>` +
    warnings
  );
}

// ---- full-history stats table --------------------------------------------

export function renderStatsTableFragment(p: FullStatsPayload, locale = 'en'): string {
  const t = (key: string): string => dashboardT(locale, key);
  if (p.error || !p.summary) {
    return `<div class="status">${escapeHtml(p.error || t('dashboard.stats.noData'))}</div><table class="dtable"><tbody></tbody></table>`;
  }
  const s = p.summary;
  const totalIn = (s.inputTokensTotal || 0) + (s.cacheCreateTokensTotal || 0) + (s.cacheReadTokensTotal || 0);
  const hitRateTok = totalIn > 0 ? ((s.cacheReadTokensTotal / totalIn) * 100).toFixed(1) + '%' : '-';
  const hitRateEv =
    s.eventsWithUsage > 0 ? ((s.cacheHitEvents / s.eventsWithUsage) * 100).toFixed(1) + '%' : '-';
  const charRatio =
    s.origCharsTotal > 0 ? ((s.imageBytesTotal / s.origCharsTotal) * 100).toFixed(3) + 'x' : '-';

  // NOTE: the literal word "requests" is asserted by tests.
  const tr = (k: string, v: string) => `<tr><td>${k}</td><td class="num">${v}</td></tr>`;
  return (
    `<div class="status">${numFmt(p.parsed)} ${escapeHtml(t('dashboard.stats.eventsParsed'))}</div>` +
    `<table class="dtable"><tbody>` +
    tr(t('dashboard.stats.requests'), numFmt(s.total)) +
    tr('2xx / 4xx / 5xx', `${numFmt(s.ok2xx)} / ${numFmt(s.err4xx)} / ${numFmt(s.err5xx)}`) +
    tr(t('dashboard.stats.compressed'), numFmt(s.compressed)) +
    tr(t('dashboard.stats.passthrough'), numFmt(s.passthrough)) +
    tr(t('dashboard.stats.inputTokens'), numFmt(s.inputTokensTotal)) +
    tr(t('dashboard.stats.cacheCreate'), numFmt(s.cacheCreateTokensTotal)) +
    tr(t('dashboard.stats.cacheRead'), numFmt(s.cacheReadTokensTotal)) +
    tr(t('dashboard.stats.cacheHitTokens'), hitRateTok) +
    tr(t('dashboard.stats.cacheHitEvents'), hitRateEv) +
    tr(t('dashboard.stats.originalChars'), numFmt(s.origCharsTotal)) +
    tr(t('dashboard.stats.imageBytes'), numFmt(s.imageBytesTotal)) +
    tr(t('dashboard.stats.bytesChar'), charRatio) +
    (s.pinEvents
      ? tr(
          t('dashboard.stats.pinFooter'),
          `${numFmt(s.pinCharsTotal ?? 0)} chars / ${numFmt(s.pinEvents)} req`,
        )
      : '') +
    tr(t('dashboard.stats.latency'), `${numFmt(s.durationP50)} / ${numFmt(s.durationP95)} ms`) +
    tr(t('dashboard.stats.firstByte'), `${numFmt(s.firstByteP50)} / ${numFmt(s.firstByteP95)} ms`) +
    `</tbody></table>`
  );
}

// ---- page shell -------------------------------------------------------------

// Favicon mirrors the .flame-dot glyph: a glossy flame sphere (radial highlight
// at 35%/30%, --flame -> --flame-strong) ringed by a faint --flame-tint halo.
// Inlined as a URL-encoded SVG data URI so the dashboard stays self-contained
// (no extra route/static asset). Keep colors in sync with :root in CSS below.
const FAVICON =
  "data:image/svg+xml," +
  "%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E" +
  "%3Cdefs%3E%3CradialGradient%20id='f'%20cx='35%25'%20cy='30%25'%20r='80%25'%3E" +
  "%3Cstop%20offset='0%25'%20stop-color='%23ffd0a8'/%3E" +
  "%3Cstop%20offset='55%25'%20stop-color='%23ff5a1f'/%3E" +
  "%3Cstop%20offset='100%25'%20stop-color='%23e8420a'/%3E" +
  "%3C/radialGradient%3E%3C/defs%3E" +
  "%3Ccircle%20cx='16'%20cy='16'%20r='15.5'%20fill='%23fff1ea'/%3E" +
  "%3Ccircle%20cx='16'%20cy='16'%20r='10'%20fill='url(%23f)'/%3E%3C/svg%3E";

const CSS = `
  :root {
    --bg: #faf6f2; --surface: #ffffff; --surface-2: #fbf4ee;
    --border: #efe5db; --border-strong: #e4d6c8;
    --ink: #241f1b; --ink-2: #5d534a; --muted: #9b9189;
    --flame: #ff5a1f; --flame-strong: #e8420a; --flame-ink: #bd3a08; --flame-tint: #fff1ea;
    --good: #1f9d57; --good-tint: #e7f6ee; --bad: #d8483b; --bad-tint: #fcebe9; --warn: #b7791f; --warn-tint: #fbf0db;
    --img: #ff5a1f; --img-ink: #bd3a08; --img-tint: #fff1ea;
    --txt: #2f7db0; --txt-ink: #1f5f8b; --txt-tint: #e9f3fb;
    --radius: 14px;
    --shadow: 0 1px 2px rgba(60,35,15,.05), 0 8px 24px rgba(60,35,15,.05);
    --mono: 'SF Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color-scheme: light;
  }
  /* Dark theme: same warm-flame identity, inverted neutrals. Set before first
     paint by the <head> script (localStorage 'pp-theme' else system pref);
     toggled by ppTheme(). Accents (flame/img/txt) are lifted for contrast. */
  :root[data-theme="dark"] {
    --bg: #17120f; --surface: #211a15; --surface-2: #2a211b;
    --border: #352a22; --border-strong: #46382e;
    --ink: #f6efe8; --ink-2: #cabbac; --muted: #9a8c7d;
    --flame: #ff6a33; --flame-strong: #e8420a; --flame-ink: #ff9a63; --flame-tint: #3a2318;
    --good: #3fbd76; --good-tint: #15291f; --bad: #f0645a; --bad-tint: #341b18; --warn: #d99a3a; --warn-tint: #33260f;
    --img: #ff6a33; --img-ink: #ff9a63; --img-tint: #3a2318;
    --txt: #5aa3d6; --txt-ink: #8cc3ea; --txt-tint: #142631;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 10px 28px rgba(0,0,0,.45);
    color-scheme: dark;
  }
  /* Dark fix-ups for the few intentionally hard-coded (light) spots. */
  :root[data-theme="dark"] .banner { border-color: #6e342c; color: #f4b9b1; }
  :root[data-theme="dark"] .banner strong { color: #ffd6cf; }
  :root[data-theme="dark"] .toast { box-shadow: 0 8px 24px rgba(0,0,0,.5); }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 22px 26px 64px; background: var(--bg); color: var(--ink-2);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased; }
  b, strong { color: var(--ink); }
  .good { color: var(--good); } .bad { color: var(--bad); }
  .muted { color: var(--muted); }

  /* topbar */
  .topbar { display: flex; align-items: flex-start; justify-content: space-between;
    gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .flame-dot { width: 14px; height: 14px; border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #ffd0a8, var(--flame) 55%, var(--flame-strong));
    box-shadow: 0 0 0 4px var(--flame-tint); flex: none; }
  .wordmark { font-size: 22px; font-weight: 800; color: var(--ink); letter-spacing: -0.02em; }
  .wordmark-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  /* Which machine is this? Two dashboards from two hosts look identical otherwise. */
  .hostchip { font-size: 11.5px; font-weight: 600; color: var(--muted); padding: 1px 7px;
    border: 1px solid var(--line); border-radius: 999px; white-space: nowrap; }
  .tagline { font-size: 12.5px; color: var(--muted); margin-top: 1px; max-width: 460px; }
  .controls { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }

  /* kill switch */
  .banner { display: block; margin: 0 0 8px; padding: 9px 13px; background: var(--bad-tint);
    border: 1px solid #f3b6af; border-radius: 9px; color: #9c2b20; font-size: 12px; max-width: 520px; }
  .banner strong { color: #8a2117; }
  .switch { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; justify-content: flex-end; }
  .switch-state { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
    padding: 3px 10px; border-radius: 999px; }
  .switch-state.on { color: var(--good); background: var(--good-tint); }
  .switch-state.off { color: var(--bad); background: var(--bad-tint); }
  .switch-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .switch-btn { background: var(--surface); color: var(--ink); border: 1px solid var(--border-strong);
    padding: 6px 13px; cursor: pointer; border-radius: 8px; font: inherit; font-size: 12px; font-weight: 600;
    box-shadow: var(--shadow); }
  .switch-btn:hover { border-color: var(--flame); color: var(--flame-ink); }
  .hint { color: var(--muted); font-size: 11px; }
  .theme-btn { background: var(--surface); color: var(--ink-2); border: 1px solid var(--border-strong);
    padding: 5px 11px; cursor: pointer; border-radius: 8px; font: inherit; font-size: 12px; font-weight: 600;
    box-shadow: var(--shadow); display: inline-flex; align-items: center; gap: 6px; line-height: 1; }
  .theme-btn:hover { border-color: var(--flame); color: var(--flame-ink); }

  /* model chips */
  .models { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 18px; }
  .models-label { color: var(--ink-2); font-size: 12px; font-weight: 600; }
  .models-csv { flex: 1 1 260px; min-width: 220px; color: var(--ink); background: var(--surface);
    border: 1px solid var(--border-strong); border-radius: 6px; padding: 4px 8px;
    font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .models-csv:focus { outline: none; border-color: var(--flame-ink); }
  .models-routing { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 18px; }
  #routing-help { border: 1px solid var(--border-strong); border-radius: 10px; background: var(--surface);
    color: var(--ink); max-width: 600px; padding: 16px 20px; }
  #routing-help::backdrop { background: rgba(20, 12, 6, .4); }
  #routing-help h3 { margin: 0 0 8px; font-size: 14px; color: var(--ink); }
  #routing-help p, #routing-help li { font-size: 12px; line-height: 1.55; color: var(--ink-2); margin: 6px 0; }
  #routing-help ul { margin: 6px 0; padding-left: 18px; }
  #routing-help code { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink); }
  #routing-help pre { background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px;
    padding: 8px 10px; margin: 8px 0; overflow-x: auto;
    font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink); }
  .chip { background: var(--surface); color: var(--ink-2); border: 1px solid var(--border-strong);
    border-radius: 999px; padding: 4px 12px; cursor: pointer; font: inherit; font-size: 12px; }
  .chip:hover { border-color: var(--flame); color: var(--flame-ink); }
  .chip.on { background: var(--flame-tint); color: var(--flame-ink); border-color: var(--flame);
    font-weight: 600; }

  /* collapsed model-scope section (#116): the default compress scope is Fable 5
     only, so the three family rows stay hidden until the user opts in. The
     <details> wrapper lives in the static shell — NOT inside #frag-models —
     because the every-2s innerHTML poll would otherwise reset its open state. */
  .models-collapse { margin: 0 0 18px; }
  .models-collapse .models { margin: 0 0 10px; }
  .models-collapse .models:last-child { margin-bottom: 0; }
  .models-summary { cursor: pointer; color: var(--ink-2); font-size: 12px; font-weight: 600;
    margin: 0 0 8px; user-select: none; }
  .models-summary:hover { color: var(--flame-ink); }
  .models-warning { color: var(--ink-2); background: var(--surface); border: 1px solid var(--border-strong);
    border-left: 3px solid var(--bad); border-radius: 8px; padding: 8px 12px; font-size: 12px;
    margin: 0 0 12px; }

  /* session hero */
  #frag-session { display: block; margin-bottom: 16px; }
  .hero { background: linear-gradient(135deg, var(--flame-tint), var(--surface) 60%); border: 1px solid var(--border);
    border-left: 4px solid var(--flame); border-radius: var(--radius); padding: 20px 24px; box-shadow: var(--shadow); }
  .hero-neg { border-left-color: var(--bad); }
  .hero-eyebrow { font-size: 11.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--muted); margin-bottom: 8px; }
  .hero-headline { font-size: 28px; font-weight: 700; color: var(--ink); letter-spacing: -0.02em; line-height: 1.1; }
  .hero-num { font-size: 56px; font-weight: 800; line-height: 1; margin-right: 8px;
    background: linear-gradient(135deg, #ff9a4d, var(--flame) 55%, var(--flame-strong));
    -webkit-background-clip: text; background-clip: text; color: transparent;
    font-variant-numeric: tabular-nums; }
  .hero-neg .hero-num { background: linear-gradient(135deg, #f0857a, var(--bad));
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  .hero-sub { font-size: 14.5px; color: var(--ink-2); margin-top: 12px; max-width: 720px; }
  .hero-meta { font-size: 12px; color: var(--muted); margin-top: 10px; padding-top: 10px;
    border-top: 1px dashed var(--border-strong); }
  .hero-empty .hero-headline { color: var(--muted); font-size: 24px; }

  /* stat strip */
  .strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 14px; }
  @media (max-width: 1000px) { .strip { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 560px) { .strip { grid-template-columns: 1fr; } }
  .tile { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 14px 16px; box-shadow: var(--shadow); }
  .tile-label { font-size: 11.5px; font-weight: 600; color: var(--ink-2); margin-bottom: 8px;
    display: flex; align-items: center; gap: 5px; }
  .tile-value { font-size: 26px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em; line-height: 1.1; }
  .tile-value.pos { color: var(--good); } .tile-value.neg { color: var(--bad); }
  .tile-value.muted-val { color: var(--muted); font-size: 18px; font-weight: 600; }
  .tile-sub { font-size: 11.5px; color: var(--muted); margin-top: 6px; }
  .q { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px;
    border-radius: 50%; background: var(--surface-2); border: 1px solid var(--border-strong);
    color: var(--muted); font-size: 9px; font-weight: 700; cursor: help; position: relative; outline: none; }
  .q:hover, .q:focus-visible { color: var(--flame-ink); border-color: var(--flame); }
  .q::after { content: attr(data-tip); position: absolute; z-index: 50; left: 0; bottom: calc(100% + 8px);
    width: min(280px, calc(100vw - 32px)); transform: translateY(4px); padding: 8px 10px; border-radius: 7px;
    background: var(--ink); color: var(--surface); box-shadow: var(--shadow); font-size: 11px; font-weight: 500;
    line-height: 1.4; text-align: left; pointer-events: none; opacity: 0; visibility: hidden; display: none;
    transition: opacity .12s, transform .12s, visibility .12s; }
  .q::before { content: ''; position: absolute; z-index: 51; left: 2px; bottom: calc(100% + 3px);
    border: 5px solid transparent; border-top-color: var(--ink);
    pointer-events: none; opacity: 0; visibility: hidden; display: none; transition: opacity .12s, visibility .12s; }
  .tile:nth-child(3) .q::after, .tile:nth-child(4) .q::after { left: auto; right: 0; }
  .tile:nth-child(3) .q::before, .tile:nth-child(4) .q::before { left: auto; right: 2px; }
  .q:hover::after, .q:focus-visible::after { display: block; opacity: 1; visibility: visible; transform: translateY(0); }
  .q:hover::before, .q:focus-visible::before { display: block; opacity: 1; visibility: visible; }
  @media (max-width: 1000px) {
    .tile:nth-child(odd) .q::after { left: 0; right: auto; }
    .tile:nth-child(odd) .q::before { left: 2px; right: auto; }
    .tile:nth-child(even) .q::after { left: auto; right: 0; }
    .tile:nth-child(even) .q::before { left: auto; right: 2px; }
  }
  @media (max-width: 560px) {
    .tile .q::after { left: 0; right: auto; }
    .tile .q::before { left: 2px; right: auto; }
  }

  /* drawer */
  .drawer { margin: 0 0 14px; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  .drawer > summary { cursor: pointer; user-select: none; list-style: none; padding: 12px 16px;
    font-size: 13px; font-weight: 600; color: var(--flame-ink); display: flex; align-items: center; gap: 8px; }
  .drawer > summary::-webkit-details-marker { display: none; }
  .drawer > summary::before { content: '▸'; color: var(--flame); font-size: 11px; }
  .drawer[open] > summary::before { content: '▾'; }
  .drawer > summary:hover { background: var(--surface-2); }
  .drawer-intro { padding: 0 16px 10px; font-size: 12px; color: var(--ink-2); }
  .drawer-intro em { color: var(--flame-ink); font-style: normal; font-weight: 600; }
  .math-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; padding: 0 16px 16px; }
  @media (max-width: 860px) { .math-grid { grid-template-columns: 1fr; } }
  .math-block h4 { margin: 0 0 6px; font-size: 12px; color: var(--ink); }
  .formula { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px;
    padding: 9px 11px; font: 11px/1.55 var(--mono); color: var(--ink-2); white-space: pre-wrap;
    word-break: break-word; }
  .formula .k { color: var(--muted); } .formula .v { color: var(--ink); } .formula .op { color: var(--flame); }
  .formula .sp { height: 6px; }
  .formula .src { color: var(--muted); font-size: 10px; display: block; margin-top: 7px;
    border-top: 1px solid var(--border); padding-top: 6px; }
  .updated { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
  .live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--good); animation: pulse 2s infinite; }
  @keyframes pulse { 50% { opacity: 0.35; } }

  /* sections */
  .section { margin-top: 26px; }
  .section-head { font-size: 14px; font-weight: 700; color: var(--ink); margin: 0 0 12px;
    display: flex; align-items: baseline; gap: 10px; }
  .section-sub { font-size: 12px; font-weight: 400; color: var(--muted); }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 16px 18px; box-shadow: var(--shadow); min-width: 0; }
  .card-head { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted); margin: 0 0 12px; }
  .card-head.spaced { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--border); }

  /* x-ray */
  .xray { display: grid; grid-template-columns: 1.15fr 1fr; gap: 16px; align-items: start; }
  @media (max-width: 1000px) { .xray { grid-template-columns: 1fr; } }

  /* context map */
  .ctxmap { font-size: 13px; }
  .empty-note { color: var(--muted); font-size: 12.5px; padding: 14px; background: var(--surface-2);
    border: 1px dashed var(--border-strong); border-radius: 10px; }
  .ctx-headline { font-size: 13px; color: var(--ink-2); margin-bottom: 10px; }
  .ctx-title { display: inline-block; font-weight: 700; color: var(--ink); margin-right: 6px; }
  .ctx-big { font-size: 22px; font-weight: 800; color: var(--flame); font-variant-numeric: tabular-nums; }
  .legend { display: flex; gap: 8px; margin-bottom: 10px; }
  .tag { font-size: 11px; font-weight: 600; padding: 3px 9px 3px 22px; border-radius: 999px; position: relative; }
  .tag::before { content: ''; position: absolute; left: 9px; top: 50%; transform: translateY(-50%);
    width: 8px; height: 8px; border-radius: 2px; }
  .tag-img { background: var(--img-tint); color: var(--img-ink); }
  .tag-img::before { background: var(--img); }
  .tag-txt { background: var(--txt-tint); color: var(--txt-ink); }
  .tag-txt::before { background: var(--txt); }
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  @media (max-width: 560px) { .split { grid-template-columns: 1fr; } }
  .split-col { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; background: var(--surface); }
  .split-img { border-top: 3px solid var(--img); background: linear-gradient(180deg, var(--img-tint), var(--surface) 40%); }
  .split-txt { border-top: 3px solid var(--txt); background: linear-gradient(180deg, var(--txt-tint), var(--surface) 40%); }
  .split-head { font-size: 12px; font-weight: 700; color: var(--ink); margin-bottom: 8px; display: flex;
    flex-direction: column; gap: 2px; }
  .split-sum { font-size: 10.5px; font-weight: 600; color: var(--muted); }
  .ctx-row { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; padding: 4px 0;
    border-bottom: 1px solid var(--border); }
  .ctx-row:last-of-type { border-bottom: none; }
  .ctx-lbl { color: var(--ink-2); } .ctx-val { color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .muted-row { color: var(--muted); font-style: italic; }
  .split-note { font-size: 10.5px; color: var(--muted); margin-top: 7px; }
  /* Cap notes explain a turn that compressed less than the user expects, so they
     must read as a reason, not as fine print. Warm tint, not an error colour —
     nothing here is broken. */
  .cap-note { color: var(--ink); border-left: 2px solid var(--flame); padding-left: 7px; }
  .pages-title { font-size: 11px; color: var(--ink-2); margin: 12px 0 6px; }
  .pages { display: flex; flex-wrap: wrap; gap: 6px; max-height: 320px; overflow: auto;
    background: var(--surface-2); padding: 6px; border: 1px solid var(--border); border-radius: 8px; }
  .page { height: 130px; width: auto; max-width: 230px; object-fit: contain; object-position: top left;
    image-rendering: pixelated; background: #fff; border: 1px solid var(--border-strong); border-radius: 4px;
    cursor: pointer; transition: border-color .12s, transform .12s; }
  .page:hover { border-color: var(--flame); transform: translateY(-1px); }
  .page.page-gone { width: 150px; height: 56px; background: var(--surface-2); border: 1px dashed var(--border-strong);
    color: var(--muted); font-size: 10px; cursor: default; }

  /* recent requests */
  .row-view { color: var(--flame-ink); font-weight: 600; text-decoration: none; cursor: pointer; white-space: nowrap; }
  .row-view:hover { text-decoration: underline; }
  table.rtable, table.dtable { width: 100%; border-collapse: collapse; font-size: 12px; }
  .rtable th, .dtable th { text-align: left; color: var(--muted); font-weight: 600; padding: 7px 8px;
    border-bottom: 1px solid var(--border-strong); white-space: nowrap; }
  .rtable td, .dtable td { padding: 7px 8px; border-bottom: 1px solid var(--border);
    font-variant-numeric: tabular-nums; vertical-align: middle; color: var(--ink-2); }
  .rtable tr:last-child td, .dtable tr:last-child td { border-bottom: none; }
  .rtable tbody tr:hover, .rtable tbody tr:hover { background: var(--surface-2); }
  /* Keep wide tables inside their card: scroll horizontally rather than
     pushing the card border out. Fires only when the nowrap columns exceed
     the card width (narrow x-ray column / small window); no scrollbar when
     they fit. The table keeps width:100% so it fills at wide widths. */
  #frag-recent, #frag-stats { overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
  #frag-recent table, #frag-stats table { min-width: max-content; }
  #frag-latest { overflow: auto; scrollbar-width: thin; }
  th.num, td.num { text-align: right; }
  td.pos { color: var(--good); font-weight: 600; }
  td.neg { color: var(--bad); font-weight: 600; }
  .endp { color: var(--ink); font-family: var(--mono); font-size: 11px; }
  .empty-cell { color: var(--muted); text-align: center; padding: 18px; }
  .pill { display: inline-block; min-width: 38px; text-align: center; font-size: 11px; font-weight: 700;
    padding: 2px 8px; border-radius: 999px; font-variant-numeric: tabular-nums; }
  .pill-good { background: var(--good-tint); color: var(--good); }
  .pill-warn { background: var(--warn-tint); color: var(--warn); }
  .pill-bad { background: var(--bad-tint); color: var(--bad); }
  .badge { font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
  .mk-create { font-size: 9.5px; font-weight: 700; color: var(--muted); border: 1px solid var(--muted);
    border-radius: 999px; padding: 0 5px; margin-left: 4px; vertical-align: 1px; cursor: help; white-space: nowrap; }
  .badge-img { background: var(--img-tint); color: var(--img-ink); }
  .badge-txt { background: var(--txt-tint); color: var(--txt-ink); }

  /* inspector */
  .viewer-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .mini-btn { font-size: 11px; background: var(--surface); color: var(--flame-ink); border: 1px solid var(--border-strong);
    border-radius: 7px; padding: 3px 9px; cursor: pointer; font-weight: 600; }
  .mini-btn:hover { border-color: var(--flame); }
  .mini-label { font-size: 11px; color: var(--muted); }
  .frame { background: #fff; border: 1px solid var(--border-strong); border-radius: 8px; padding: 5px;
    overflow: auto; max-height: 360px; scrollbar-width: thin; }
  .frame img { display: block; width: auto; height: auto; max-width: none; image-rendering: pixelated; }
  .frame-sm { max-height: 260px; }
  .viewer-caption { font-size: 11px; color: var(--muted); margin-top: 8px; display: flex; align-items: center;
    gap: 10px; flex-wrap: wrap; }
  .pairing { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 10px; }
  .pair-head { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 6px; display: inline-block;
    margin-bottom: 6px; }
  .pair-img { background: var(--img-tint); color: var(--img-ink); }
  .pair-txt { background: var(--txt-tint); color: var(--txt-ink); }
  .pair-mid { font-size: 11px; font-weight: 600; color: var(--muted); text-align: center; }
  .src-pane { margin: 0; max-height: 280px; overflow: auto; background: var(--surface-2);
    border: 1px solid var(--border); border-radius: 8px; padding: 9px; font: 11px/1.45 var(--mono);
    white-space: pre-wrap; word-break: break-word; color: var(--ink-2); }
  .evicted { font-size: 11.5px; color: var(--muted); padding: 12px; background: var(--surface-2);
    border: 1px dashed var(--border-strong); border-radius: 8px; }

  /* sessions bars */
  .status { margin-bottom: 12px; color: var(--muted); font-size: 12px; }
  .bars { display: flex; flex-direction: column; gap: 8px; }
  .bar-row { display: flex; align-items: center; gap: 12px; font-size: 12px; }
  .bar-label { width: 150px; flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--ink); font-family: var(--mono); font-size: 11px; }
  .bar-track { flex: 1; min-width: 0; height: 16px; background: var(--surface-2); border-radius: 5px;
    overflow: hidden; border: 1px solid var(--border); }
  .bar-fill { height: 100%; border-radius: 5px 0 0 5px;
    background: linear-gradient(90deg, #ffa766, var(--flame)); }
  .bar-val { width: 78px; flex: none; text-align: right; font-variant-numeric: tabular-nums;
    color: var(--flame-ink); font-weight: 600; }
  .bar-val.neg { color: var(--bad); }
  .axis { margin-top: 12px; color: var(--muted); font-size: 11px; }
  .empty { text-align: center; color: var(--muted); padding: 22px; font-size: 12px; }

  /* toast tray */
  .tray { position: fixed; bottom: 16px; right: 16px; display: flex; flex-direction: column; gap: 8px;
    z-index: 1000; pointer-events: none; }
  .toast { background: var(--surface); color: var(--bad); border: 1px solid #f0b3ab; border-radius: 9px;
    padding: 10px 14px; font-size: 12px; box-shadow: 0 8px 24px rgba(60,35,15,.14); display: flex;
    align-items: center; gap: 12px; pointer-events: auto; max-width: 360px; }
  .toast button { background: transparent; color: inherit; border: 0; cursor: pointer; font-size: 16px;
    line-height: 1; padding: 0; }
`;

// Client glue: window.pp (pin+source state) → hx-vals; preserves <details> open state across swaps; routes htmx errors to toast tray.
const GLUE_JS = `
  window.pp = { pin: null, src: false };
  function ppPin(id) {
    window.pp.pin = id;
    htmx.trigger('#frag-latest', 'pp-refresh');
  }
  function ppSource(on) {
    window.pp.src = on;
    htmx.trigger('#frag-latest', 'pp-refresh');
  }
  document.body.addEventListener('htmx:beforeSwap', function (ev) {
    const open = [];
    ev.detail.target.querySelectorAll('details[open][id]').forEach(function (d) { open.push(d.id); });
    ev.detail.target.__ppOpen = open;
  });
  document.body.addEventListener('htmx:afterSwap', function (ev) {
    (ev.detail.target.__ppOpen || []).forEach(function (id) {
      const d = document.getElementById(id);
      if (d) d.setAttribute('open', '');
    });
  });
  document.body.addEventListener('htmx:responseError', function (ev) {
    window.dispatchEvent(new CustomEvent('pp-toast', {
      detail: { text: ev.detail.xhr.status + ' ' + ev.detail.requestConfig.path }
    }));
  });
  document.body.addEventListener('htmx:sendError', function (ev) {
    window.dispatchEvent(new CustomEvent('pp-toast', {
      detail: { text: 'proxy unreachable: ' + ev.detail.requestConfig.path }
    }));
  });
`;

// Theme: light/dark via data-theme on <html>; saved in localStorage, defaults to system pref.
const THEME_JS = `
  (function () {
    function apply(t) {
      document.documentElement.dataset.theme = t;
      var b = document.getElementById('theme-btn');
      if (b) {
        b.textContent = t === 'dark' ? '☀ ' + b.dataset.lightLabel : '☾ ' + b.dataset.darkLabel;
        b.setAttribute('aria-label', b.dataset.toggleLabel || '');
      }
    }
    window.ppTheme = function () {
      var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('pp-theme', next); } catch (e) {}
      apply(next);
    };
    apply(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  })();
`;

/** `hostLabel` names the machine this proxy runs on. The dashboard is otherwise
 *  byte-identical across hosts, so a tab opened against a remote host through
 *  the tailnet front is indistinguishable from the local one - which is how a
 *  session gets read on the wrong box. Empty label = render as before. */
export function renderPage(port: number, hostLabel = '', locale = 'en'): string {
  const host = escapeHtml(hostLabel.trim());
  const localeResolution = resolveDashboardLocale(locale);
  const activeLocale = localeResolution.canonical;
  const t = (
    key: string,
    params?: Readonly<Record<string, string | number | boolean>>,
  ): string => dashboardT(activeLocale, key, params);
  const languageOptions = DASHBOARD_LOCALES.map((candidate) =>
    `<option value="${candidate}"${candidate === activeLocale ? ' selected' : ''}>${candidate}</option>`
  ).join('');
  // hx-trigger="load, every Ns": paint on load then poll (2s live, 5s aggregates).
  return `<!doctype html>
<html lang="${escapeHtml(activeLocale)}" dir="${localeResolution.direction}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${host ? `${host} · ${escapeHtml(dashboardT(activeLocale, 'dashboard.title'))}` : escapeHtml(dashboardT(activeLocale, 'dashboard.liveTitle'))}</title>
<link rel="icon" href="${FAVICON}" />
<style>${CSS}</style>
<script>
  // Set theme before first paint (no flash): saved choice wins, else system preference.
  (function () {
    try {
      var s = localStorage.getItem('pp-theme');
      var dark = s ? s === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    } catch (e) { document.documentElement.dataset.theme = 'light'; }
  })();
  window.ppLocale = ${JSON.stringify(activeLocale)};
  (function () {
    try {
      var params = new URLSearchParams(location.search);
      var requested = params.get('locale');
      var saved = localStorage.getItem('furypipe-locale');
      if (!requested && saved && saved !== window.ppLocale) {
        params.set('locale', saved);
        location.replace(location.pathname + '?' + params.toString() + location.hash);
        return;
      }
      localStorage.setItem('furypipe-locale', window.ppLocale);
    } catch (e) {}
    window.ppSetLocale = function (next) {
      try { localStorage.setItem('furypipe-locale', next); } catch (e) {}
      var params = new URLSearchParams(location.search);
      params.set('locale', next);
      location.search = params.toString();
    };
    document.addEventListener('htmx:configRequest', function (event) {
      if (event.detail && event.detail.parameters) event.detail.parameters.locale = window.ppLocale;
    });
  })();
</script>
</head>
<body>

<header class="topbar">
  <div class="brand">
    <span class="flame-dot"></span>
    <div>
      <div class="wordmark-row">
        <div class="wordmark">pxpipe</div>
        ${host ? `<span class="hostchip" title="${escapeHtml(t('dashboard.page.proxyHost'))}">${host}</span>` : ''}
      </div>
      <div class="tagline">${escapeHtml(dashboardT(activeLocale, 'dashboard.tagline'))}</div>
    </div>
  </div>
  <div class="controls">
    <label class="hint">${escapeHtml(dashboardT(activeLocale, 'dashboard.language'))} <select class="mini-btn" onchange="ppSetLocale(this.value)">${languageOptions}</select></label>
    <button type="button" id="theme-btn" class="theme-btn" onclick="ppTheme()"
      data-dark-label="${escapeHtml(dashboardT(activeLocale, 'dashboard.themeDark'))}"
      data-light-label="${escapeHtml(dashboardT(activeLocale, 'dashboard.themeLight'))}"
      data-toggle-label="${escapeHtml(dashboardT(activeLocale, 'dashboard.themeToggle'))}"
      aria-label="${escapeHtml(dashboardT(activeLocale, 'dashboard.themeToggle'))}"
      title="${escapeHtml(dashboardT(activeLocale, 'dashboard.themeToggle'))}">☾ ${escapeHtml(dashboardT(activeLocale, 'dashboard.themeDark'))}</button>
    <div id="frag-toggle" hx-get="/fragments/toggle" hx-trigger="load, every 2s" hx-swap="innerHTML"></div>
  </div>
</header>

<details class="models-collapse">
  <summary class="models-summary">${escapeHtml(t('dashboard.page.connectAgent'))} <span class="hint">${escapeHtml(t('dashboard.page.connectHint'))}</span></summary>
  <p>${escapeHtml(t('dashboard.page.warpIntro'))}</p>
  <pre>pxpipe warp -- claude
pxpipe warp -- codex
pxpipe warp -- cursor-agent</pre>
  <p>${escapeHtml(t('dashboard.page.aliasHelp'))}<br><code>pxpipe warp -- pp</code> · <code>--route PATTERN=http://host:port</code> · <code>ANTHROPIC_BASE_URL=http://127.0.0.1:${port}</code></p>
  <p>${escapeHtml(t('dashboard.page.pinIntro'))}</p>
  <pre>@pxpipe pin be concise, no walls of text
@pxpipe unpin 2
@pxpipe unpin all</pre>
  <p>${escapeHtml(t('dashboard.page.pinList'))}</p>
  <p>${escapeHtml(t('dashboard.page.pinFileHelp'))} <code>CLAUDE.md</code> / <code>AGENTS.md</code></p>
</details>

<details class="models-collapse">
  <summary class="models-summary">${escapeHtml(t('dashboard.page.modelScope'))} <span class="hint">${escapeHtml(t('dashboard.page.modelScopeHint'))}</span></summary>
  <div class="models-warning">⚠ ${escapeHtml(t('dashboard.page.modelScopeWarning'))}</div>
  <div id="frag-models" hx-get="/fragments/models" hx-trigger="load, every 2s [!document.activeElement || document.activeElement.id !== 'models-csv']" hx-swap="innerHTML"></div>
  <div class="models-routing"><span class="hint">${escapeHtml(t('dashboard.page.routingHint'))}</span> <button class="mini-btn" type="button" onclick="document.getElementById('routing-help').showModal()">${escapeHtml(t('dashboard.page.routingHelp'))}</button></div>
</details>

<dialog id="routing-help" onclick="if (event.target === this) this.close()">
  <h3>${escapeHtml(t('dashboard.page.routingTitle'))}</h3>
  <p>${escapeHtml(t('dashboard.page.routingIntro'))}</p>
  <ul>
    <li><code>OPENAI_MODELS</code> — ${escapeHtml(t('dashboard.page.routingOpenAI'))} (<code>OPENAI_UPSTREAM</code> + <code>OPENAI_API_KEY</code>)</li>
    <li><code>CLOUDFLARE_MODELS</code> — ${escapeHtml(t('dashboard.page.routingCloudflare'))} (<code>CLOUDFLARE_ACCOUNT_ID</code> + <code>CLOUDFLARE_API_TOKEN</code>)</li>
  </ul>
  <p>${escapeHtml(t('dashboard.page.routingPrecedence'))} <code>CLOUDFLARE_MODELS &gt; OPENAI_MODELS &gt; default routing</code>.</p>
  <pre>OPENAI_UPSTREAM=https://api.openai.com \\
OPENAI_API_KEY=your-openai-key \\
OPENAI_MODELS=gpt-5.6-sol \\
CLOUDFLARE_ACCOUNT_ID=your-account-id \\
CLOUDFLARE_API_TOKEN=your-cloudflare-token \\
CLOUDFLARE_MODELS=moonshotai/kimi-k3 \\
npx pxpipe-proxy</pre>
  <p>${escapeHtml(t('dashboard.page.routingPrefix'))} ${escapeHtml(t('dashboard.page.routingSwitch'))}</p>
  <p><code>PXPIPE_MODELS</code> — ${escapeHtml(t('dashboard.page.scopeSeparate'))} ${escapeHtml(t('dashboard.page.routingEvidence'))}</p>
  <button class="mini-btn" type="button" onclick="this.closest('dialog').close()">${escapeHtml(t('dashboard.page.close'))}</button>
</dialog>

<div id="frag-session" hx-get="/fragments/session-summary" hx-trigger="load, every 2s" hx-swap="innerHTML">
  <div class="hero hero-empty"><div class="hero-headline">${escapeHtml(t('dashboard.page.connecting'))}</div></div>
</div>

<div id="frag-header" hx-get="/fragments/header" hx-trigger="load, every 2s" hx-swap="innerHTML"></div>

<section class="section">
  <h2 class="section-head">${escapeHtml(t('dashboard.page.contextTitle'))} <span class="section-sub">${escapeHtml(t('dashboard.page.contextSub'))}</span></h2>
  <div class="xray">
    <div class="card">
      <h3 class="card-head">${escapeHtml(t('dashboard.page.recent'))}</h3>
      <div id="frag-recent" hx-get="/fragments/recent" hx-trigger="load, every 2s" hx-swap="innerHTML"></div>
    </div>
    <div class="card">
      <h3 class="card-head">${escapeHtml(t('dashboard.page.breakdown'))}</h3>
      <div id="frag-context-map" hx-get="/fragments/context-map" hx-trigger="load" hx-swap="innerHTML"></div>
      <h3 class="card-head spaced">${escapeHtml(t('dashboard.page.inspector'))}</h3>
      <div id="frag-latest" hx-get="/fragments/latest" hx-trigger="load, every 2s, pp-refresh" hx-swap="innerHTML"
           hx-vals='js:{pin: window.pp.pin == null ? "" : window.pp.pin, source: window.pp.src ? "1" : ""}'></div>
    </div>
  </div>
</section>

<section class="section">
  <h2 class="section-head">${escapeHtml(t('dashboard.page.topSessions'))} <span class="section-sub">${escapeHtml(t('dashboard.page.bySaved'))}</span></h2>
  <div class="card">
    <div id="frag-sessions" hx-get="/fragments/sessions" hx-trigger="load, every 5s" hx-swap="innerHTML"></div>
  </div>
</section>

<section class="section">
  <h2 class="section-head">Control Room V5 <span class="section-sub">${escapeHtml(t('dashboard.page.controlRoomSub'))}</span></h2>
  <div class="card">
    <div id="frag-control-room" hx-get="/fragments/control-room" hx-trigger="load, every 5s" hx-swap="innerHTML">
      <div class="status">${escapeHtml(t('dashboard.page.loadingControlRoom'))}</div>
    </div>
  </div>
</section>

<section class="section">
  <h2 class="section-head">Full history <span class="section-sub">every event on disk</span></h2>
  <div class="card">
    <div id="frag-stats" hx-get="/fragments/stats" hx-trigger="load, every 5s" hx-swap="innerHTML"></div>
  </div>
</section>

<div class="tray" x-data="{ toasts: [], next: 1 }"
     @pp-toast.window="const id = next++; toasts.push({ id, text: $event.detail.text }); setTimeout(() => toasts = toasts.filter(t => t.id !== id), 5000)">
  <template x-for="t in toasts" :key="t.id">
    <div class="toast"><span x-text="t.text"></span><button type="button" @click="toasts = toasts.filter(x => x.id !== t.id)" aria-label="dismiss">&times;</button></div>
  </template>
</div>

<script>${HTMX_JS}</script>
<script>${GLUE_JS}</script>
<script>${THEME_JS}</script>
<script>${ALPINE_JS}</script>
</body>
</html>`;
}
