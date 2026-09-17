// Server-rendered HTML dashboard — htmx polls fragments, Alpine drives the toast tray.
// Presentation only; server code (src/dashboard.ts, src/node.ts) needs no edits.

import { HTMX_JS, ALPINE_JS } from './vendor.js';
import { CACHE_CREATE_RATE, CACHE_READ_RATE } from '../core/baseline.js';
import type { ControlRoomSnapshot } from '../control-room/index.js';
import type { ControlPlaneDomainId, ControlPlaneSnapshot } from '../control-plane.js';
import type { ModelFabricEntry } from '../core/model-fabric.js';
import type { FuryPipeModelScopeMode, FuryPipeVisualPolicy } from '../core/applicability.js';
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
  ModelRuntimeActivity,
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

/** Manual scope controls are generated from runtime/provider observations.
 * Model support is never represented by a release-time chip catalog. */
export function renderModelsFragment(
  active: string[],
  configured: string[],
  enabled: boolean,
  locale = 'en',
  discovered: readonly ModelFabricEntry[] = [],
  visualPolicy: FuryPipeVisualPolicy = 'auto',
  runtimeActivity: ReadonlyMap<string, ModelRuntimeActivity> = new Map(),
  scopeMode: FuryPipeModelScopeMode = 'automatic',
): string {
  const t = (key: string): string => dashboardT(locale, key);
  const on = new Set(active);
  const labelOf = new Map(discovered.map((model) => [
    model.id,
    model.displayName || model.id,
  ] as const));
  // Manual scope controls are the union of actual observed/discovered ids plus
  // existing configured/active overrides. This deliberately avoids presenting
  // a hard-coded chip list as if it were FuryPipe's compatibility catalog.
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of [
    ...configured,
    ...active,
    ...discovered.slice(0, 250).map((model) => model.id),
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
  const scopeChips = ids.slice(0, 100).map(chipFor).join('');
  const moot = enabled
    ? ''
    : `<div class="models"><span class="hint">${escapeHtml(t('dashboard.models.offHint'))}</span></div>`;
  const scopeModeLabel = scopeMode === 'automatic'
    ? t('dashboard.models.scopeAutomatic')
    : scopeMode === 'explicit'
      ? t('dashboard.models.scopeExplicit')
      : t('dashboard.models.scopeOff');
  const scopeModeHint = scopeMode === 'automatic'
    ? t('dashboard.models.scopeAutomaticHint')
    : scopeMode === 'explicit'
      ? t('dashboard.models.scopeExplicitHint')
      : t('dashboard.models.scopeOffHint');
  const scopeStatus = `<div class="model-scope-status" data-model-scope="${scopeMode}">` +
    `<span class="models-label">${escapeHtml(t('dashboard.models.scopeMode'))}</span>` +
    `<strong>${escapeHtml(scopeModeLabel)}</strong>` +
    `<span class="hint">${escapeHtml(scopeModeHint)}</span>` +
    (scopeMode === 'automatic' ? '' :
      `<button class="mini-btn" type="button" hx-post="/fragments/models" hx-target="#frag-models" ` +
      `hx-vals='${escapeHtml('{"mode":"automatic"}')}'>${escapeHtml(t('dashboard.models.restoreAutomatic'))}</button>`) +
    `</div>`;

  const discoveredRows = discovered.slice(0, 250).map((model) => {
    const imageState = model.modalities.imageInput.toUpperCase();
    const profile = model.visual.profile.toUpperCase();
    const policy = model.visual.policy.toUpperCase();
    const lifecycle = model.lifecycle.toUpperCase();
    const runtime = runtimeActivity.get(model.id);
    const observedAt = runtime?.lastObservedAt ?? model.lastObservedAt;
    const observed = observedAt ? observedAt.replace('T', ' ').replace(/\.\d{3}Z$/u, 'Z') : '—';
    const runtimeSummary = runtime && runtime.requests > 0
      ? (
          `${numFmt(runtime.requests)} req · ${numFmt(runtime.compressedRequests)} visual · ${numFmt(runtime.passthroughRequests)} text` +
          (runtime.recentEligibilityCauses.operator_scope_excluded
            ? ` · ${t('dashboard.models.operatorScopeExcluded')}`
            : '') +
          (runtime.lastReason ? ` · ${runtime.lastReason}` : '')
        )
      : t('dashboard.models.noRuntimeActivity');
    return `<tr>` +
      `<td class="model-name"><strong>${escapeHtml(model.displayName || model.id)}</strong><span class="model-id">${escapeHtml(model.id)}</span></td>` +
      `<td>${escapeHtml(model.provider)}</td>` +
      `<td><span class="model-state model-state-${escapeHtml(model.modalities.imageInput)}">IMAGE ${escapeHtml(imageState)}</span></td>` +
      `<td><span class="model-state">${escapeHtml(profile)}</span></td>` +
      `<td><span class="model-state">${escapeHtml(policy)}</span></td>` +
      `<td>${escapeHtml(lifecycle)}</td>` +
      `<td class="model-activity">${escapeHtml(runtimeSummary)}</td>` +
      `<td class="model-observed">${escapeHtml(observed)}</td>` +
      `</tr>`;
  }).join('');

  const policyOption = (value: FuryPipeVisualPolicy, label: string): string =>
    `<option value="${value}"${visualPolicy === value ? ' selected' : ''}>${escapeHtml(label)}</option>`;

  const modelFabric = `<section class="model-fabric" aria-labelledby="model-fabric-title">` +
    `<div class="model-fabric-head"><div><strong id="model-fabric-title">${escapeHtml(t('dashboard.models.fabricTitle'))}</strong>` +
    `<span class="hint">${escapeHtml(t('dashboard.models.fabricHint'))}</span></div>` +
    `<div class="model-fabric-actions"><label for="visual-policy">${escapeHtml(t('dashboard.models.visualPolicy'))}</label>` +
    `<select id="visual-policy" name="policy" hx-post="/fragments/models" hx-target="#frag-models" hx-trigger="change">` +
    policyOption('auto', 'AUTO') +
    policyOption('max_savings', 'MAX SAVINGS') +
    policyOption('safe_exact', 'SAFE EXACT') +
    policyOption('text_only', 'TEXT ONLY') +
    `</select><a class="mini-btn" href="/api/models.json" target="_blank" rel="noopener">JSON</a></div></div>` +
    (discoveredRows
      ? `<div class="model-fabric-scroll"><table class="model-fabric-table"><thead><tr>` +
        `<th>${escapeHtml(t('dashboard.models.columnModel'))}</th><th>${escapeHtml(t('dashboard.models.columnProvider'))}</th><th>${escapeHtml(t('dashboard.models.columnVision'))}</th><th>${escapeHtml(t('dashboard.models.columnProfile'))}</th><th>${escapeHtml(t('dashboard.models.columnPolicy'))}</th><th>${escapeHtml(t('dashboard.models.columnLifecycle'))}</th><th>${escapeHtml(t('dashboard.models.columnActivity'))}</th><th>${escapeHtml(t('dashboard.models.columnLastObserved'))}</th>` +
        `</tr></thead><tbody>${discoveredRows}</tbody></table></div>`
      : `<div class="model-fabric-empty">${escapeHtml(t('dashboard.models.catalogEmpty'))}</div>`) +
    `</section>`;

  const manualScope = `<details class="model-scope-override">` +
    `<summary class="models-summary">${escapeHtml(t('dashboard.page.modelScope'))}</summary>` +
    `<div class="models">` +
    (scopeChips || `<span class="hint">${escapeHtml(t('dashboard.models.unlisted'))}</span>`) +
    `</div>` +
    `<div class="models">` +
    `<span class="models-label">FURYPIPE_MODELS</span>` +
    `<input class="models-csv" id="models-csv" type="text" name="list" ` +
    `value="${escapeHtml(active.join(','))}" spellcheck="false" autocomplete="off" ` +
    `hx-post="/fragments/models" hx-target="#frag-models" hx-trigger="change">` +
    `<span class="hint">${escapeHtml(t('dashboard.models.csvHint'))}</span>` +
    `</div></details>`;

  return modelFabric + moot + scopeStatus + manualScope;
}

// ---- session hero --------------------------------------------------------

// Must stay in lockstep with ASSUMED_INPUT_USD_PER_MTOK in src/dashboard.ts.
const INPUT_USD_PER_MTOK = 10.0;
void INPUT_USD_PER_MTOK; // suppress unused-var; renderHeaderFragment uses the server's pricing block.

// Lifetime hero. Reads the SAME cumulative weighted totals as the header strip
// (serveStats), so the headline and the "$ saved" tiles can never disagree, and
// the number stops swinging on tiny per-session samples. Cache-weighted on
// purpose ("lifeweight"): it answers "did FuryPipe move my real, cache-discounted
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
  // Input-only: FuryPipe never touches output, so lumping it in just dampened the %.
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
  // average is not a valid "without FuryPipe" counterfactual.
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
    `<div><span class="k">${escapeHtml(t('dashboard.math.formula'))}:</span> <span class="v">without_furypipe = actual_imaged + measured_savings</span></div>` +
    `<div><span class="k">${escapeHtml(t('dashboard.math.why'))}:</span> <span class="v">${escapeHtml(t('dashboard.math.samePopulation'))}</span></div>` +
    `<div class="sp"></div>` +
    mathRow(`actual imaged (n=${paidImaged})`, `$${(s.compressed_actual_usd || 0).toFixed(4)}`, t('dashboard.math.totalAvg', { value: `$${cAvg.toFixed(4)}` })) +
    mathRow(t('dashboard.math.measuredSavings'), `$${(s.saved_usd || 0).toFixed(4)}`, escapeHtml(t('dashboard.math.cacheAwareTotal'))) +
    mathRow(t('dashboard.math.withoutFuryPipe'), `$${withoutAvg.toFixed(4)}/req`, '<span class="op">=</span> (actual imaged + measured savings) / n') +
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
            `<img class="page" src="/proxy-latest-png?id=${id}" alt="page ${id}" loading="lazy" title="${escapeHtml(t('dashboard.context.galleryTitle', { id }))}" onclick="furyPin(${id});furySource(true)" onerror="this.classList.add('page-gone'); this.alt=${escapeHtml(JSON.stringify(t('dashboard.context.galleryExpired', { id })))};" />`,
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
            const savedLabel = escapeHtml(t('dashboard.recent.savedLost'));
            const savedCell = saved == null
              ? `<td class="num muted" data-label="${savedLabel}">—</td>`
              : saved > 0
                ? `<td class="num pos" data-label="${savedLabel}">${numFmt(saved)}</td>`
                : saved < 0
                  ? `<td class="num neg" data-label="${savedLabel}">${numFmt(saved)}${createNote}</td>`
                  : `<td class="num" data-label="${savedLabel}">0</td>`;
            const imaged = e.cc_added
              ? `<span class="badge badge-img">${escapeHtml(t('dashboard.recent.image'))}</span>`
              : `<span class="badge badge-txt">${escapeHtml(t('dashboard.recent.text'))}</span>`;
            return (
              `<tr>` +
              `<td class="muted" data-label="#">${i + 1}</td>` +
              `<td data-label="${escapeHtml(t('dashboard.recent.result'))}"><span class="pill pill-${statusCls(e.status)}">${e.status}</span></td>` +
              `<td class="endp" data-label="${escapeHtml(t('dashboard.recent.endpoint'))}">${escapeHtml(shortPath(e.path))}</td>` +
              `<td data-label="${escapeHtml(t('dashboard.recent.model'))}">${e.model ? `<code>${escapeHtml(e.model)}</code>` : '<span class="muted">—</span>'}</td>` +
              `<td data-label="${escapeHtml(t('dashboard.recent.sentAs'))}">${imaged}</td>` +
              `<td class="num" data-label="${escapeHtml(t('dashboard.recent.cacheHits'))}">${e.cache_read != null ? numFmt(e.cache_read) : '—'}</td>` +
              `<td class="num" data-label="${escapeHtml(t('dashboard.recent.asText'))}">${e.baseline_input != null ? numFmt(e.baseline_input) : '—'}</td>` +
              `<td class="num" data-label="${escapeHtml(t('dashboard.recent.sent'))}">${e.actual_input != null ? numFmt(e.actual_input) : '—'}</td>` +
              savedCell +
              `<td class="num recent-details" data-label="${escapeHtml(t('dashboard.recent.details'))}">${viewLink}</td>` +
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
      ? `<div class="viewer-bar"><button class="mini-btn" type="button" onclick="furyPin(null)">${escapeHtml(t('dashboard.latest.back'))}</button><span class="mini-label">${escapeHtml(t('dashboard.latest.image', { id: pin }))}</span></div>`
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
    ? `<button class="mini-btn" type="button" onclick="furySource(${showSource ? 'false' : 'true'})">${escapeHtml(t(showSource ? 'dashboard.latest.hideSource' : 'dashboard.latest.showSource'))}</button>`
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

  const agent = snapshot.sections.agent.evidence;
  const capabilityCountsAvailable = agent.skillExecutions !== undefined
    || agent.mcpExecutions !== undefined
    || agent.subagentExecutions !== undefined
    || agent.automaticCapabilityExecutions !== undefined
    || agent.manualCapabilityExecutions !== undefined;
  const recentCapabilityExecutions = agent.recentCapabilityExecutions ?? [];
  const capabilityExecutionSummary = capabilityCountsAvailable
    ? (
        `<div class="status"><strong>${escapeHtml(t('dashboard.controlRoom.capabilityExecutions'))}</strong>` +
        ` · ${escapeHtml(t('dashboard.controlRoom.skillsExecuted'))} ${numFmt(agent.skillExecutions ?? 0)}` +
        ` · ${escapeHtml(t('dashboard.controlRoom.mcpExecuted'))} ${numFmt(agent.mcpExecutions ?? 0)}` +
        ` · ${escapeHtml(t('dashboard.controlRoom.subagentsExecuted'))} ${numFmt(agent.subagentExecutions ?? 0)}` +
        ` · ${escapeHtml(t('dashboard.controlRoom.automaticExecuted'))} ${numFmt(agent.automaticCapabilityExecutions ?? 0)}` +
        ` · ${escapeHtml(t('dashboard.controlRoom.manualExecuted'))} ${numFmt(agent.manualCapabilityExecutions ?? 0)}</div>` +
        (recentCapabilityExecutions.length > 0
          ? (
              `<div class="status"><strong>${escapeHtml(t('dashboard.controlRoom.recentExecutions'))}</strong></div>` +
              `<table class="dtable"><tbody>${recentCapabilityExecutions.slice(-12).map((execution) =>
                `<tr><td><code>${escapeHtml(execution.kind)}:${escapeHtml(execution.id)}</code></td>` +
                `<td class="num">${escapeHtml(execution.stage)} · ${escapeHtml(execution.invocation)}</td></tr>`
              ).join('')}</tbody></table>`
            )
          : `<div class="status">${escapeHtml(t('dashboard.controlRoom.noCapabilityExecution'))}</div>`)
      )
    : '';

  return (
    `<div class="status"><strong>Control Room V5 · ${escapeHtml(snapshot.overall)}</strong> · commit <code>${escapeHtml(snapshot.sourceCommit.slice(0, 12))}</code></div>` +
    releaseSummary +
    capabilityExecutionSummary +
    `<table class="dtable"><tbody>${rows}</tbody></table>` +
    warnings
  );
}

// ---- Control Plane V2 -----------------------------------------------------

export type ControlPlaneFragmentSurface =
  | 'all'
  | 'overview'
  | 'visual-engine'
  | 'capabilities'
  | 'topology'
  | 'evidence';

/**
 * Render one bounded Control Plane surface from the exact same snapshot
 * contract. The legacy `all` surface remains available to API consumers; the
 * page shell composes the smaller surfaces so the Control Plane owns the page
 * structure rather than being appended below the legacy dashboard.
 */
export function renderControlPlaneFragment(
  snapshot: ControlPlaneSnapshot,
  locale = 'en',
  surface: ControlPlaneFragmentSurface = 'all',
): string {
  const t = (
    key: string,
    params?: Readonly<Record<string, string | number | boolean>>,
  ): string => dashboardT(locale, key, params);
  const labels: Readonly<Record<ControlPlaneDomainId, string>> = {
    capabilities: t('dashboard.controlPlane.domain.capabilities'),
    skills: t('dashboard.controlPlane.domain.skills'),
    mcp: t('dashboard.controlPlane.domain.mcp'),
    agents: t('dashboard.controlPlane.domain.agents'),
    providers: t('dashboard.controlPlane.domain.providers'),
    'visual-engine': t('dashboard.controlPlane.domain.visualEngine'),
    'fury-link': t('dashboard.controlPlane.domain.furyLink'),
    'context-fabric': t('dashboard.controlPlane.domain.contextFabric'),
    memory: t('dashboard.controlPlane.domain.memory'),
    knowledge: t('dashboard.controlPlane.domain.knowledge'),
    learning: t('dashboard.controlPlane.domain.learning'),
    recovery: t('dashboard.controlPlane.domain.recovery'),
    security: t('dashboard.controlPlane.domain.security'),
    evidence: t('dashboard.controlPlane.domain.evidence'),
    sessions: t('dashboard.controlPlane.domain.sessions'),
    settings: t('dashboard.controlPlane.domain.settings'),
  };
  const rows = snapshot.domains.map((domain) => {
    const searchable = `${labels[domain.id]} ${domain.source} ${domain.status}`.toLowerCase();
    const lifecycle = domain.lifecycle
      .map((step) => `<span class="cp-life">${escapeHtml(step)}</span>`)
      .join('');
    return (
      `<button type="button" class="cp-row" data-cp-row data-cp-id="${escapeHtml(domain.id)}" ` +
      `data-cp-label="${escapeHtml(labels[domain.id])}" data-cp-search="${escapeHtml(searchable)}" ` +
      `data-cp-status="${escapeHtml(domain.status)}" data-cp-source="${escapeHtml(domain.source)}" ` +
      `data-cp-lifecycle="${escapeHtml(domain.lifecycle.join(' · '))}" ` +
      `data-cp-warnings="${escapeHtml(domain.warnings.join(' · '))}" aria-controls="cp-inspector">` +
      `<span class="cp-row-title">${escapeHtml(labels[domain.id])}</span>` +
      `<span class="cp-row-source"><code>${escapeHtml(domain.source)}</code></span>` +
      `<span class="cp-row-life" aria-label="${escapeHtml(t('dashboard.controlPlane.lifecycle'))}">${lifecycle}</span>` +
      `<span class="cp-state cp-state-${escapeHtml(domain.status.toLowerCase())}">${escapeHtml(domain.status)}</span>` +
      `</button>`
    );
  }).join('');
  const source = snapshot.sourceCommit ?? t('dashboard.controlPlane.unknown');
  const models = snapshot.runtime.activeModels.length === 0
    ? t('dashboard.controlPlane.none')
    : snapshot.runtime.activeModels.join(', ');
  const evidence = snapshot.evidence.map((entry) => {
    const freshness = entry.status === 'STALE'
      ? t('dashboard.controlPlane.stale')
      : entry.evidenceSha === null ? t('dashboard.controlPlane.notAvailable') : t('dashboard.controlPlane.fresh');
    return (
    `<tr>` +
    `<td data-label="${escapeHtml(t('dashboard.controlPlane.evidence'))}">${escapeHtml(entry.id)}</td>` +
    `<td data-label="${escapeHtml(t('dashboard.controlPlane.status'))}"><span class="cp-state cp-state-${escapeHtml(entry.status.toLowerCase())}">${escapeHtml(entry.status)}</span></td>` +
    `<td data-label="${escapeHtml(t('dashboard.controlPlane.sourceSha'))}"><code>${escapeHtml(entry.sourceSha?.slice(0, 12) ?? t('dashboard.controlPlane.unknown'))}</code></td>` +
    `<td data-label="${escapeHtml(t('dashboard.controlPlane.evidenceSha'))}"><code>${escapeHtml(entry.evidenceSha?.slice(0, 12) ?? t('dashboard.controlPlane.unknown'))}</code></td>` +
    `<td class="num" data-label="${escapeHtml(t('dashboard.controlPlane.runId'))}">${entry.runId === null ? '—' : numFmt(entry.runId)}</td>` +
    `<td data-label="${escapeHtml(t('dashboard.controlPlane.evidenceFreshness'))}"><span class="cp-freshness cp-freshness-${entry.status === 'STALE' ? 'stale' : entry.evidenceSha === null ? 'missing' : 'current'}">${escapeHtml(freshness)}</span></td>` +
    `</tr>`
    );
  }).join('');
  const decisionStatus = snapshot.runtime.compressionEnabled
    ? (snapshot.runtime.compressedRequests > 0 ? 'EXECUTED' : 'EXECUTABLE')
    : 'DISABLED';
  const decisionDescription = decisionStatus === 'EXECUTED'
    ? t('dashboard.controlPlane.decisionExecuted')
    : decisionStatus === 'DISABLED'
      ? t('dashboard.controlPlane.decisionDisabled')
      : t('dashboard.controlPlane.decisionExecutable');
  const bindings = snapshot.domains.map((domain) => (
    `<li><span>${escapeHtml(labels[domain.id])}</span><span aria-hidden="true">→</span><code>${escapeHtml(domain.source)}</code></li>`
  )).join('');
  const overview =
    `<section class="cp-runtime-lane" aria-labelledby="cp-runtime-title">` +
    `<div class="fury-core" aria-hidden="true"><span></span><i></i><b></b></div>` +
    `<div class="cp-runtime-copy"><span class="eyebrow">${escapeHtml(t('dashboard.controlPlane.instrumentPanel'))}</span><h2 id="cp-runtime-title">${escapeHtml(t('dashboard.controlPlane.runtimeLane'))}</h2><p>${escapeHtml(t('dashboard.controlPlane.runtimeHealthy'))} · <code>${numFmt(snapshot.runtime.port)}</code> · ${escapeHtml(t('dashboard.controlPlane.requests'))} <strong>${numFmt(snapshot.runtime.requests)}</strong></p></div>` +
    `<dl class="cp-metrics"><div><dt>${escapeHtml(t('dashboard.controlPlane.saved'))}</dt><dd>${numFmt(snapshot.runtime.savedInputTokens)}</dd></div><div><dt>${escapeHtml(t('dashboard.controlPlane.models'))}</dt><dd>${escapeHtml(models)}</dd></div><div><dt>${escapeHtml(t('dashboard.controlPlane.sourceSha'))}</dt><dd><code>${escapeHtml(source.slice(0, 12))}</code></dd></div></dl>` +
    `</section>`;
  const visualEngine =
    `<section class="cp-decision-lens" aria-labelledby="cp-decision-title"><div><span class="eyebrow">${escapeHtml(t('dashboard.controlPlane.visualEngine'))}</span><h2 id="cp-decision-title">${escapeHtml(t('dashboard.controlPlane.decisionLens'))}</h2><p>${escapeHtml(decisionDescription)}</p></div><div class="cp-decision-state"><span class="cp-state cp-state-${decisionStatus.toLowerCase()}">${escapeHtml(decisionStatus)}</span><span>${escapeHtml(t('dashboard.controlPlane.decisionReason'))}: ${escapeHtml(t('dashboard.controlPlane.decisionUnavailable'))}</span></div></section>`;
  const capabilities =
    `<section class="cp-explorer instrument-section" data-cp-root aria-labelledby="cp-explorer-title">` +
    `<div class="instrument-section-head"><div><span class="eyebrow">${escapeHtml(t('dashboard.controlPlane.instrumentPanel'))}</span><h2 id="cp-explorer-title">${escapeHtml(t('dashboard.controlPlane.explorer'))}</h2></div><output data-cp-result-count data-cp-result-label="${escapeHtml(t('dashboard.controlPlane.observedDomains'))}">${escapeHtml(t('dashboard.controlPlane.resultCount', { count: snapshot.domains.length }))}</output></div>` +
    `<div class="cp-tools">` +
    `<label>${escapeHtml(t('dashboard.controlPlane.search'))}<input data-cp-search-input type="search" placeholder="${escapeHtml(t('dashboard.controlPlane.searchPlaceholder'))}" /></label>` +
    `<label>${escapeHtml(t('dashboard.controlPlane.filter'))}<select data-cp-filter><option value="ALL">${escapeHtml(t('dashboard.controlPlane.filterAll'))}</option>${[...new Set(snapshot.domains.map((domain) => domain.status))].map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join('')}</select></label>` +
    `<label>${escapeHtml(t('dashboard.controlPlane.sort'))}<select data-cp-sort><option value="name">${escapeHtml(t('dashboard.controlPlane.sortName'))}</option><option value="status">${escapeHtml(t('dashboard.controlPlane.sortStatus'))}</option></select></label>` +
    `</div><div class="cp-list" role="list">${rows}</div>` +
    `<aside class="cp-inspector" id="cp-inspector" data-cp-inspector data-no-warnings="${escapeHtml(t('dashboard.controlPlane.noWarnings'))}" aria-live="polite"><span class="eyebrow">${escapeHtml(t('dashboard.controlPlane.inspector'))}</span><h3 data-cp-inspector-title>${escapeHtml(t('dashboard.controlPlane.inspector'))}</h3><p data-cp-inspector-empty>${escapeHtml(t('dashboard.controlPlane.inspectorEmpty'))}</p><dl hidden data-cp-inspector-details><div><dt>${escapeHtml(t('dashboard.controlPlane.status'))}</dt><dd data-cp-inspector-status></dd></div><div><dt>${escapeHtml(t('dashboard.controlPlane.inspectorSource'))}</dt><dd><code data-cp-inspector-source></code></dd></div><div><dt>${escapeHtml(t('dashboard.controlPlane.lifecycle'))}</dt><dd data-cp-inspector-lifecycle></dd></div><div><dt>${escapeHtml(t('dashboard.controlPlane.inspectorWarnings'))}</dt><dd data-cp-inspector-warnings></dd></div></dl><details hidden data-cp-inspector-raw><summary>${escapeHtml(t('dashboard.controlPlane.inspectorRaw'))}</summary><pre data-cp-inspector-json></pre></details></aside></section>`;
  const topology =
    `<section class="cp-topology instrument-section" aria-labelledby="cp-topology-title"><div class="instrument-section-head"><div><span class="eyebrow">${escapeHtml(t('dashboard.controlPlane.instrumentPanel'))}</span><h2 id="cp-topology-title">${escapeHtml(t('dashboard.controlPlane.sourceBindings'))}</h2><p>${escapeHtml(t('dashboard.controlPlane.sourceBindingsSub'))}</p></div></div><ol class="cp-bindings">${bindings}</ol></section>`;
  const evidenceSurface =
    `<section class="cp-evidence-lens instrument-section" aria-labelledby="cp-evidence-title"><div class="instrument-section-head"><div><span class="eyebrow">${escapeHtml(t('dashboard.controlPlane.instrumentPanel'))}</span><h2 id="cp-evidence-title">${escapeHtml(t('dashboard.controlPlane.evidenceTitle'))}</h2></div></div><div class="table-wrap"><table class="dtable cp-evidence"><thead><tr>` +
    `<th>${escapeHtml(t('dashboard.controlPlane.evidence'))}</th><th>${escapeHtml(t('dashboard.controlPlane.status'))}</th><th>${escapeHtml(t('dashboard.controlPlane.sourceSha'))}</th><th>${escapeHtml(t('dashboard.controlPlane.evidenceSha'))}</th><th>${escapeHtml(t('dashboard.controlPlane.runId'))}</th><th>${escapeHtml(t('dashboard.controlPlane.evidenceFreshness'))}</th>` +
    `</tr></thead><tbody>${evidence}</tbody></table></div></section>`;

  const surfaces: Readonly<Record<Exclude<ControlPlaneFragmentSurface, 'all'>, string>> = {
    overview,
    'visual-engine': visualEngine,
    capabilities,
    topology,
    evidence: evidenceSurface,
  };
  return surface === 'all'
    ? overview + visualEngine + capabilities + topology + evidenceSurface
    : surfaces[surface];
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

// FuryPipe favicon: three linked nodes on a midnight field. It mirrors the
// FuryLink / Context Fabric identity rather than the historical warm-flame mark.
const FAVICON =
  "data:image/svg+xml," +
  "%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E" +
  "%3Crect%20x='1'%20y='1'%20width='30'%20height='30'%20rx='8'%20fill='%23050914'%20stroke='%231b3156'/%3E" +
  "%3Cpath%20d='M8%2010h8l8%206-8%206H8'%20fill='none'%20stroke='%236f9dff'%20stroke-width='2.4'%20stroke-linecap='round'%20stroke-linejoin='round'/%3E" +
  "%3Ccircle%20cx='8'%20cy='10'%20r='2.4'%20fill='%23f6f0e4'/%3E" +
  "%3Ccircle%20cx='24'%20cy='16'%20r='2.4'%20fill='%236f9dff'/%3E" +
  "%3Ccircle%20cx='8'%20cy='22'%20r='2.4'%20fill='%23f6f0e4'/%3E%3C/svg%3E";

const CSS = `
  :root {
    --bg: #f4eee3; --surface: #fffaf1; --surface-2: #ece5d9;
    --border: #dcd2c3; --border-strong: #cbbdac;
    --ink: #10213a; --ink-2: #42526a; --muted: #7d8795;
    --accent: #4f7cff; --accent-strong: #2f5ee8; --accent-ink: #244fc5; --accent-tint: #e8eeff;
    --good: #168a68; --good-tint: #e2f4ec; --bad: #c94f62; --bad-tint: #f8e7e9; --warn: #9a6a19; --warn-tint: #f5ecd8;
    --img: #4f7cff; --img-ink: #244fc5; --img-tint: #e8eeff;
    --txt: #168f91; --txt-ink: #0f696b; --txt-tint: #e2f3f1;
    --radius: 2px;
    --shadow: none;
    --mono: 'SF Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color-scheme: light;
  }
  /* FuryPipe midnight theme. Applied before first paint from the FuryPipe-owned
     theme preference, then toggled by furyTheme(). Cobalt and teal accents are
     lifted independently from the neutral navy/black surface stack. */
  :root[data-theme="dark"] {
    --bg: #03060c; --surface: #07111f; --surface-2: #0c192b;
    --border: #152641; --border-strong: #22395d;
    --ink: #f4f1e9; --ink-2: #b8c5d8; --muted: #778ba7;
    --accent: #6f9dff; --accent-strong: #4e7ff0; --accent-ink: #9ab8ff; --accent-tint: #10234a;
    --good: #32c39a; --good-tint: #0b2b25; --bad: #ef6d7b; --bad-tint: #32141c; --warn: #e0a94f; --warn-tint: #30230e;
    --img: #6f9dff; --img-ink: #a8c2ff; --img-tint: #10234a;
    --txt: #4ed2cf; --txt-ink: #88e7e2; --txt-tint: #0b292c;
    --shadow: none;
    color-scheme: dark;
  }
  /* Dark fix-ups for the few intentionally hard-coded (light) spots. */
  :root[data-theme="dark"] .banner { border-color: #603041; color: #ffc2cb; }
  :root[data-theme="dark"] .banner strong { color: #ffdce1; }
  :root[data-theme="dark"] .toast { box-shadow: none; }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; padding: 0 0 72px; color: var(--ink-2);
    background: var(--bg);
    font: 14px/1.5 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased; }
  .workspace { width: min(1480px, calc(100% - 40px)); margin: 0 auto; }
  b, strong { color: var(--ink); }
  .good { color: var(--good); } .bad { color: var(--bad); }
  .muted { color: var(--muted); }

  /* topbar */
  .topbar { position: sticky; top: 0; z-index: 30; display: flex; align-items: center; justify-content: space-between;
    gap: 18px; flex-wrap: wrap; margin: 0 -8px 14px; padding: 16px 10px 14px;
    background: var(--bg); backdrop-filter: none;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent); }
  .brand { display: flex; align-items: center; gap: 12px; }
  .pulse-mark { position: relative; width: 34px; height: 34px; border-radius: 2px;
    background-image: none; background-color: var(--surface);
    border: 1px solid var(--border-strong); box-shadow: none; flex: none; }
  .pulse-mark::before, .pulse-mark::after { content: ''; position: absolute; top: 15px; width: 8px; height: 4px;
    border-radius: 0; background: var(--accent); box-shadow: none; }
  .pulse-mark::before { left: 5px; } .pulse-mark::after { right: 5px; }
  .wordmark { font-size: 22px; font-weight: 800; color: var(--ink); letter-spacing: -0.03em; }
  .brand-kicker { margin-left: 8px; color: var(--accent-ink); font: 700 10px/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; }
  .wordmark-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  /* Which machine is this? Two dashboards from two hosts look identical otherwise. */
  .hostchip { font-size: 11.5px; font-weight: 600; color: var(--muted); padding: 1px 7px;
    border: 1px solid var(--border); border-radius: 2px; white-space: nowrap; }
  .tagline { font-size: 12.5px; color: var(--muted); margin-top: 1px; max-width: 460px; }
  .controls { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
  .command-nav { display: flex; gap: 7px; overflow-x: auto; scrollbar-width: none; margin: 0 0 18px;
    padding: 8px; border: 1px solid var(--border); border-radius: 0;
    background: var(--surface); box-shadow: none; }
  .command-nav::-webkit-scrollbar { display: none; }
  .command-nav a { flex: 0 0 auto; color: var(--ink-2); text-decoration: none; font-size: 12px; font-weight: 650;
    padding: 7px 11px; border-radius: 0; border: 1px solid transparent; }
  .command-nav a:hover { color: var(--accent-ink); background: var(--accent-tint); border-color: var(--border-strong); }
  .connect-panel { margin: 0 0 18px; padding: 2px 0; border: 1px solid var(--border); border-radius: 0;
    background: var(--surface); box-shadow: none; overflow: hidden; }
  .connect-panel > summary { padding: 13px 16px; }
  .connect-panel[open] > summary { border-bottom: 1px solid var(--border); }
  .connect-panel > p, .connect-panel > pre { margin-left: 16px; margin-right: 16px; }
  .connect-panel > p:last-child { margin-bottom: 16px; }
  .connect-panel pre { color: var(--ink); background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 2px; padding: 11px 13px; overflow-x: auto; font: 12px/1.55 var(--mono); }

  /* kill switch */
  .banner { display: block; margin: 0 0 8px; padding: 9px 13px; background: var(--bad-tint);
    border: 1px solid #f3b6af; border-radius: 2px; color: #9c2b20; font-size: 12px; max-width: 520px; }
  .banner strong { color: #8a2117; }
  .switch { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; justify-content: flex-end; }
  .switch-state { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
    padding: 3px 10px; border-radius: 2px; }
  .switch-state.on { color: var(--good); background: var(--good-tint); }
  .switch-state.off { color: var(--bad); background: var(--bad-tint); }
  .switch-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .switch-btn { background: var(--surface); color: var(--ink); border: 1px solid var(--border-strong);
    padding: 6px 13px; cursor: pointer; border-radius: 2px; font: inherit; font-size: 12px; font-weight: 600;
    box-shadow: none; }
  .switch-btn:hover { border-color: var(--accent); color: var(--accent-ink); }
  .hint { color: var(--muted); font-size: 11px; }
  .theme-btn { background: var(--surface); color: var(--ink-2); border: 1px solid var(--border-strong);
    padding: 5px 11px; cursor: pointer; border-radius: 2px; font: inherit; font-size: 12px; font-weight: 600;
    box-shadow: none; display: inline-flex; align-items: center; gap: 6px; line-height: 1; }
  .theme-btn:hover { border-color: var(--accent); color: var(--accent-ink); }

  /* model chips */
  .models { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 18px; }
  .models-label { color: var(--ink-2); font-size: 12px; font-weight: 600; }
  .models-csv { flex: 1 1 260px; min-width: 220px; color: var(--ink); background: var(--surface);
    border: 1px solid var(--border-strong); border-radius: 2px; padding: 4px 8px;
    font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .models-csv:focus { outline: none; border-color: var(--accent-ink); }
  .model-fabric { margin: 0 0 18px; padding: 12px 0 4px; border-top: 1px solid var(--border); }
  .model-fabric-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 10px; }
  .model-fabric-head > div { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
  .model-fabric-actions { display: flex; align-items: center; gap: 8px; }
  .model-fabric-actions label { color: var(--ink-2); font-size: 11px; font-weight: 600; }
  .model-fabric-actions select { color: var(--ink); background: var(--surface); border: 1px solid var(--border-strong); border-radius: 6px; padding: 5px 8px; font: 600 11px/1.2 var(--mono); }
  .model-fabric-actions select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .model-fabric-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
  .model-fabric-table { width: 100%; min-width: 900px; border-collapse: collapse; font-size: 12px; }
  .model-fabric-table th, .model-fabric-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; }
  .model-fabric-table th { color: var(--ink-2); font-weight: 600; background: var(--surface-2); position: sticky; top: 0; }
  .model-fabric-table tbody tr:last-child td { border-bottom: 0; }
  .model-name { min-width: 230px; }
  .model-id { display: block; margin-top: 2px; color: var(--ink-2); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; }
  .model-state { display: inline-block; padding: 2px 5px; border: 1px solid var(--border-strong); border-radius: 4px; color: var(--ink-2); font-size: 10px; font-weight: 600; }
  .model-state-yes { color: var(--good); }
  .model-state-no { color: var(--bad); }
  .model-observed { white-space: nowrap; color: var(--ink-2); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; }
  .model-fabric-empty { padding: 10px 12px; border-left: 2px solid var(--border-strong); color: var(--ink-2); font-size: 12px; }
  @media (max-width: 640px) {
    .model-fabric-table { min-width: 0; }
    .model-fabric-table thead { display: none; }
    .model-fabric-table, .model-fabric-table tbody, .model-fabric-table tr, .model-fabric-table td { display: block; width: 100%; }
    .model-fabric-table tr { padding: 8px 10px; border-bottom: 1px solid var(--border); }
    .model-fabric-table td { padding: 3px 0; border: 0; }
    .model-fabric-table td:not(.model-name):not(.model-observed) { display: inline-block; width: auto; margin-right: 8px; }
    .model-observed { margin-top: 4px; }
  }
  .models-routing { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 18px; }
  #routing-help { border: 1px solid var(--border-strong); border-radius: 2px; background: var(--surface);
    color: var(--ink); max-width: 600px; padding: 16px 20px; }
  #routing-help::backdrop { background: rgba(2, 7, 18, .62); }
  #routing-help h3 { margin: 0 0 8px; font-size: 14px; color: var(--ink); }
  #routing-help p, #routing-help li { font-size: 12px; line-height: 1.55; color: var(--ink-2); margin: 6px 0; }
  #routing-help ul { margin: 6px 0; padding-left: 18px; }
  #routing-help code { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink); }
  #routing-help pre { background: var(--surface-2); border: 1px solid var(--border); border-radius: 2px;
    padding: 8px 10px; margin: 8px 0; overflow-x: auto;
    font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink); }
  .chip { background: var(--surface); color: var(--ink-2); border: 1px solid var(--border-strong);
    border-radius: 2px; padding: 4px 12px; cursor: pointer; font: inherit; font-size: 12px; }
  .chip:hover { border-color: var(--accent); color: var(--accent-ink); }
  .chip.on { background: var(--accent-tint); color: var(--accent-ink); border-color: var(--accent);
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
  .models-summary:hover { color: var(--accent-ink); }
  .models-warning { color: var(--ink-2); background: var(--surface); border: 1px solid var(--border-strong);
    border-left: 3px solid var(--bad); border-radius: 0; padding: 8px 12px; font-size: 12px;
    margin: 0 0 12px; }

  /* session hero */
  #frag-session { display: block; margin-bottom: 16px; }
  .hero { position: relative; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 0; padding: 22px 24px; box-shadow: none; }
  .hero::after { display: none; }
  .hero-neg { border-left-color: var(--bad); }
  .hero-eyebrow { font-size: 11.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--muted); margin-bottom: 8px; }
  .hero-headline { font-size: 28px; font-weight: 700; color: var(--ink); letter-spacing: -0.02em; line-height: 1.1; }
  .hero-num { font-size: 56px; font-weight: 800; line-height: 1; margin-right: 8px;
    background: none; -webkit-background-clip: initial; background-clip: initial; color: var(--accent);
    font-variant-numeric: tabular-nums; }
  .hero-neg .hero-num { background: none; -webkit-background-clip: initial; background-clip: initial; color: var(--bad); }
  .hero-sub { font-size: 14.5px; color: var(--ink-2); margin-top: 12px; max-width: 720px; }
  .hero-meta { font-size: 12px; color: var(--muted); margin-top: 10px; padding-top: 10px;
    border-top: 1px dashed var(--border-strong); }
  .hero-empty .hero-headline { color: var(--muted); font-size: 24px; }

  /* stat strip */
  .strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 14px; }
  @media (max-width: 1000px) { .strip { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 560px) { .strip { grid-template-columns: 1fr; } }
  .tile { background: var(--surface); border: 1px solid var(--border); border-radius: 0;
    padding: 14px 16px; box-shadow: none; }
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
  .q:hover, .q:focus-visible { color: var(--accent-ink); border-color: var(--accent); }
  .q::after { content: attr(data-tip); position: absolute; z-index: 50; left: 0; bottom: calc(100% + 8px);
    width: min(280px, calc(100vw - 32px)); transform: translateY(4px); padding: 8px 10px; border-radius: 2px;
    background: var(--ink); color: var(--surface); box-shadow: none; font-size: 11px; font-weight: 500;
    line-height: 1.4; text-align: left; pointer-events: none; opacity: 0; visibility: hidden; display: none;
    transition: opacity .12s, transform .12s, visibility .12s; }
  .q::before { content: ''; position: absolute; z-index: 51; left: 2px; bottom: calc(100% + 3px);
    border: 5px solid transparent; border-top-color: var(--ink);
    pointer-events: none; opacity: 0; visibility: hidden; display: none; transition: opacity .12s, visibility .12s; }
  .tile:nth-child(3) .q::after, .tile:nth-child(4) .q::after { left: auto; right: 0; }
  .tile:nth-child(3) .q::before, .tile:nth-child(4) .q::before { left: auto; right: 2px; }
  @media (min-width: 1001px) {
    [dir="rtl"] .tile:nth-child(3) .q::after, [dir="rtl"] .tile:nth-child(4) .q::after { left: 0; right: auto; }
    [dir="rtl"] .tile:nth-child(3) .q::before, [dir="rtl"] .tile:nth-child(4) .q::before { left: 2px; right: auto; }
  }
  .q:hover::after, .q:focus-visible::after { display: block; opacity: 1; visibility: visible; transform: translateY(0); }
  .q:hover::before, .q:focus-visible::before { display: block; opacity: 1; visibility: visible; }
  @media (max-width: 1000px) {
    .tile:nth-child(odd) .q::after { left: 0; right: auto; }
    .tile:nth-child(odd) .q::before { left: 2px; right: auto; }
    .tile:nth-child(even) .q::after { left: auto; right: 0; }
    .tile:nth-child(even) .q::before { left: auto; right: 2px; }
    [dir="rtl"] .tile:nth-child(odd) .q::after { left: auto; right: 0; }
    [dir="rtl"] .tile:nth-child(odd) .q::before { left: auto; right: 2px; }
    [dir="rtl"] .tile:nth-child(even) .q::after { left: 0; right: auto; }
    [dir="rtl"] .tile:nth-child(even) .q::before { left: 2px; right: auto; }
  }
  @media (max-width: 560px) {
    .tile .q::after { left: 0; right: auto; }
    .tile .q::before { left: 2px; right: auto; }
  }

  /* drawer */
  .drawer { margin: 0 0 14px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 0; box-shadow: none; overflow: hidden; }
  .drawer > summary { cursor: pointer; user-select: none; list-style: none; padding: 12px 16px;
    font-size: 13px; font-weight: 600; color: var(--accent-ink); display: flex; align-items: center; gap: 8px; }
  .drawer > summary::-webkit-details-marker { display: none; }
  .drawer > summary::before { content: '▸'; color: var(--accent); font-size: 11px; }
  .drawer[open] > summary::before { content: '▾'; }
  .drawer > summary:hover { background: var(--surface-2); }
  .drawer-intro { padding: 0 16px 10px; font-size: 12px; color: var(--ink-2); }
  .drawer-intro em { color: var(--accent-ink); font-style: normal; font-weight: 600; }
  .math-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; padding: 0 16px 16px; }
  @media (max-width: 860px) { .math-grid { grid-template-columns: 1fr; } }
  .math-block h4 { margin: 0 0 6px; font-size: 12px; color: var(--ink); }
  .formula { background: var(--surface-2); border: 1px solid var(--border); border-radius: 2px;
    padding: 9px 11px; font: 11px/1.55 var(--mono); color: var(--ink-2); white-space: pre-wrap;
    word-break: break-word; }
  .formula .k { color: var(--muted); } .formula .v { color: var(--ink); } .formula .op { color: var(--accent); }
  .formula .sp { height: 6px; }
  .formula .src { color: var(--muted); font-size: 10px; display: block; margin-top: 7px;
    border-top: 1px solid var(--border); padding-top: 6px; }
  .updated { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
  .live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--good); animation: none; }
  @keyframes pulse { 50% { opacity: 0.35; } }

  /* sections */
  .section { margin-top: 26px; }
  .section-head { font-size: 14px; font-weight: 700; color: var(--ink); margin: 0 0 12px;
    display: flex; align-items: baseline; gap: 10px; }
  .section-sub { font-size: 12px; font-weight: 400; color: var(--muted); }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 0;
    padding: 16px 18px; box-shadow: none; min-width: 0; }
  .card-head { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted); margin: 0 0 12px; }
  .card-head.spaced { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--border); }

  /* x-ray */
  .xray { display: grid; grid-template-columns: 1.15fr 1fr; gap: 16px; align-items: start; }
  @media (max-width: 1000px) { .xray { grid-template-columns: 1fr; } }

  /* context map */
  .ctxmap { font-size: 13px; }
  .empty-note { color: var(--muted); font-size: 12.5px; padding: 14px; background: var(--surface-2);
    border: 1px dashed var(--border-strong); border-radius: 0; }
  .ctx-headline { font-size: 13px; color: var(--ink-2); margin-bottom: 10px; }
  .ctx-title { display: inline-block; font-weight: 700; color: var(--ink); margin-right: 6px; }
  .ctx-big { font-size: 22px; font-weight: 800; color: var(--accent); font-variant-numeric: tabular-nums; }
  .legend { display: flex; gap: 8px; margin-bottom: 10px; }
  .tag { font-size: 11px; font-weight: 600; padding: 3px 9px 3px 22px; border-radius: 2px; position: relative; }
  .tag::before { content: ''; position: absolute; left: 9px; top: 50%; transform: translateY(-50%);
    width: 8px; height: 8px; border-radius: 2px; }
  .tag-img { background: var(--img-tint); color: var(--img-ink); }
  .tag-img::before { background: var(--img); }
  .tag-txt { background: var(--txt-tint); color: var(--txt-ink); }
  .tag-txt::before { background: var(--txt); }
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  @media (max-width: 560px) { .split { grid-template-columns: 1fr; } }
  .split-col { border: 1px solid var(--border); border-radius: 0; padding: 10px 12px; background: var(--surface); }
  .split-img { border-top: 3px solid var(--img); background: var(--surface); }
  .split-txt { border-top: 3px solid var(--txt); background: var(--surface); }
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
  .cap-note { color: var(--ink); border-left: 2px solid var(--accent); padding-left: 7px; }
  .pages-title { font-size: 11px; color: var(--ink-2); margin: 12px 0 6px; }
  .pages { display: flex; flex-wrap: wrap; gap: 6px; max-height: 320px; overflow: auto;
    background: var(--surface-2); padding: 6px; border: 1px solid var(--border); border-radius: 0; }
  .page { height: 130px; width: auto; max-width: 230px; object-fit: contain; object-position: top left;
    image-rendering: pixelated; background: #fff; border: 1px solid var(--border-strong); border-radius: 4px;
    cursor: pointer; transition: border-color .12s, transform .12s; }
  .page:hover { border-color: var(--accent); transform: none; }
  .page.page-gone { width: 150px; height: 56px; background: var(--surface-2); border: 1px dashed var(--border-strong);
    color: var(--muted); font-size: 10px; cursor: default; }

  /* recent requests */
  .row-view { color: var(--accent-ink); font-weight: 600; text-decoration: none; cursor: pointer; white-space: nowrap; }
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
  @media (max-width: 640px) {
    #frag-recent { overflow: visible; }
    #frag-recent table.rtable { min-width: 0; display: block; }
    #frag-recent .rtable thead { display: none; }
    #frag-recent .rtable tbody { display: grid; gap: 10px; }
    #frag-recent .rtable tr { display: block; padding: 6px 10px; border: 1px solid var(--border);
      border-radius: 0; background: color-mix(in srgb, var(--surface) 94%, var(--accent-tint)); }
    #frag-recent .rtable td { display: grid; grid-template-columns: minmax(92px, .8fr) minmax(0, 1.2fr);
      gap: 10px; align-items: baseline; padding: 7px 0; border-bottom: 1px solid var(--border);
      text-align: start; white-space: normal; overflow-wrap: anywhere; }
    #frag-recent .rtable td:last-child { border-bottom: 0; }
    #frag-recent .rtable td::before { content: attr(data-label); color: var(--muted);
      font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    #frag-recent .rtable td.empty-cell { display: block; text-align: center; border: 0; padding: 16px 8px; }
    #frag-recent .rtable td.empty-cell::before { content: none; }
    #frag-recent .rtable td.recent-details { grid-template-columns: 1fr; }
    #frag-recent .rtable td.recent-details::before { display: none; }
  }
  #frag-latest { overflow: auto; scrollbar-width: thin; }
  th.num, td.num { text-align: right; }
  td.pos { color: var(--good); font-weight: 600; }
  td.neg { color: var(--bad); font-weight: 600; }
  .endp { color: var(--ink); font-family: var(--mono); font-size: 11px; }
  .empty-cell { color: var(--muted); text-align: center; padding: 18px; }
  .pill { display: inline-block; min-width: 38px; text-align: center; font-size: 11px; font-weight: 700;
    padding: 2px 8px; border-radius: 2px; font-variant-numeric: tabular-nums; }
  .pill-good { background: var(--good-tint); color: var(--good); }
  .pill-warn { background: var(--warn-tint); color: var(--warn); }
  .pill-bad { background: var(--bad-tint); color: var(--bad); }
  .badge { font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 2px; }
  .mk-create { font-size: 9.5px; font-weight: 700; color: var(--muted); border: 1px solid var(--muted);
    border-radius: 2px; padding: 0 5px; margin-left: 4px; vertical-align: 1px; cursor: help; white-space: nowrap; }
  .badge-img { background: var(--img-tint); color: var(--img-ink); }
  .badge-txt { background: var(--txt-tint); color: var(--txt-ink); }

  /* inspector */
  .viewer-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .mini-btn { font-size: 11px; background: var(--surface); color: var(--accent-ink); border: 1px solid var(--border-strong);
    border-radius: 2px; padding: 3px 9px; cursor: pointer; font-weight: 600; }
  .mini-btn:hover { border-color: var(--accent); }
  .mini-label { font-size: 11px; color: var(--muted); }
  .frame { background: #fff; border: 1px solid var(--border-strong); border-radius: 2px; padding: 5px;
    overflow: auto; max-height: 360px; scrollbar-width: thin; }
  .frame img { display: block; width: auto; height: auto; max-width: none; image-rendering: pixelated; }
  .frame-sm { max-height: 260px; }
  .viewer-caption { font-size: 11px; color: var(--muted); margin-top: 8px; display: flex; align-items: center;
    gap: 10px; flex-wrap: wrap; }
  .pairing { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 10px; }
  .pair-head { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 2px; display: inline-block;
    margin-bottom: 6px; }
  .pair-img { background: var(--img-tint); color: var(--img-ink); }
  .pair-txt { background: var(--txt-tint); color: var(--txt-ink); }
  .pair-mid { font-size: 11px; font-weight: 600; color: var(--muted); text-align: center; }
  .src-pane { margin: 0; max-height: 280px; overflow: auto; background: var(--surface-2);
    border: 1px solid var(--border); border-radius: 2px; padding: 9px; font: 11px/1.45 var(--mono);
    white-space: pre-wrap; word-break: break-word; color: var(--ink-2); }
  .evicted { font-size: 11.5px; color: var(--muted); padding: 12px; background: var(--surface-2);
    border: 1px dashed var(--border-strong); border-radius: 0; }

  /* sessions bars */
  .status { margin-bottom: 12px; color: var(--muted); font-size: 12px; }
  .cp-summary { display: grid; gap: 5px; margin-bottom: 14px; color: var(--ink-2); font-size: 12px; }
  .cp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(205px, 1fr)); gap: 10px; }
  .cp-tools { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 10px; }
  .cp-tools label { display: grid; gap: 3px; min-width: min(100%, 175px); color: var(--muted); font-size: 10px; }
  .cp-tools input { min-width: 0; }
  .cp-status { color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
  .cp-life-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  .cp-life { border: 1px solid var(--border-strong); border-radius: 2px; padding: 2px 5px; color: var(--accent-ink); font-size: 10px; font-weight: 700; }
  .cp-warnings { margin-top: 7px; color: var(--muted); font-size: 10px; overflow-wrap: anywhere; }
  .cp-details { margin-top: 7px; color: var(--muted); font-size: 10px; }
  .cp-details summary { cursor: pointer; color: var(--accent-ink); }
  @media (max-width: 640px) {
    #frag-control-plane .table-wrap, #frag-cp-evidence .table-wrap { overflow: visible; }
    #frag-control-plane .cp-evidence, #frag-cp-evidence .cp-evidence { min-width: 0; display: block; }
    #frag-control-plane .cp-evidence thead, #frag-cp-evidence .cp-evidence thead { display: none; }
    #frag-control-plane .cp-evidence tbody, #frag-cp-evidence .cp-evidence tbody { display: grid; gap: 10px; }
    #frag-control-plane .cp-evidence tr, #frag-cp-evidence .cp-evidence tr { display: block; padding: 6px 10px; border: 1px solid var(--border);
      border-radius: 0; background: color-mix(in srgb, var(--surface) 94%, var(--accent-tint)); }
    #frag-control-plane .cp-evidence td, #frag-cp-evidence .cp-evidence td { display: grid; grid-template-columns: minmax(92px, .8fr) minmax(0, 1.2fr);
      gap: 10px; align-items: baseline; padding: 7px 0; border-bottom: 1px solid var(--border);
      text-align: start; white-space: normal; overflow-wrap: anywhere; }
    #frag-control-plane .cp-evidence td:last-child, #frag-cp-evidence .cp-evidence td:last-child { border-bottom: 0; }
    #frag-control-plane .cp-evidence td::before, #frag-cp-evidence .cp-evidence td::before { content: attr(data-label); color: var(--muted);
      font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  }
  .bars { display: flex; flex-direction: column; gap: 8px; }
  .bar-row { display: flex; align-items: center; gap: 12px; font-size: 12px; }
  .bar-label { width: 150px; flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--ink); font-family: var(--mono); font-size: 11px; }
  .bar-track { flex: 1; min-width: 0; height: 16px; background: var(--surface-2); border-radius: 2px;
    overflow: hidden; border: 1px solid var(--border); }
  .bar-fill { height: 100%; border-radius: 2px 0 0 2px;
    background: var(--accent); }
  .bar-val { width: 78px; flex: none; text-align: right; font-variant-numeric: tabular-nums;
    color: var(--accent-ink); font-weight: 600; }
  .bar-val.neg { color: var(--bad); }
  .axis { margin-top: 12px; color: var(--muted); font-size: 11px; }
  .empty { text-align: center; color: var(--muted); padding: 22px; font-size: 12px; }

  /* toast tray */
  .tray { position: fixed; bottom: 16px; right: 16px; display: flex; flex-direction: column; gap: 8px;
    z-index: 1000; pointer-events: none; }
  .toast { background: var(--surface); color: var(--bad); border: 1px solid #f0b3ab; border-radius: 2px;
    padding: 10px 14px; font-size: 12px; box-shadow: none; display: flex;
    align-items: center; gap: 12px; pointer-events: auto; max-width: 360px; }
  .toast button { background: transparent; color: inherit; border: 0; cursor: pointer; font-size: 16px;
    line-height: 1; padding: 0; }

  /* Control Plane V4 — Fury Instrument Panel.
     Surfaces are deliberately sparse: canvas, section rail, raised inspector.
     Status is always written as text; colour reinforces but never carries state. */
  :root {
    --canvas: #f4eee3; --surface: #fffaf1; --raised: #ece5d9;
    --border: #dcd2c3; --border-strong: #cbbdac; --ink: #10213a;
    --ink-2: #42526a; --muted: #778ba7; --accent: #4f7cff;
    --accent-ink: #244fc5; --accent-tint: #e8eeff; --radius: 4px; --shadow: none;
  }
  :root[data-theme="dark"] {
    --canvas: #03060c; --surface: #07111f; --raised: #0c192b;
    --border: #152641; --border-strong: #22395d; --ink: #f4f1e9;
    --ink-2: #b8c5d8; --muted: #778ba7; --accent: #4f7cff;
    --accent-ink: #9ab8ff; --accent-tint: #10213a; --shadow: none;
  }
  html { scroll-padding-top: 112px; }
  body { background: var(--canvas); color: var(--ink-2); }
  body::before { content: ''; position: fixed; inset: 0 auto 0 0; width: 3px; background: var(--accent); pointer-events: none; z-index: 200; }
  .workspace { width: min(1440px, calc(100% - 48px)); }
  .topbar { min-width: 0; margin: 0; padding: 18px 0 14px; gap: 14px; background: var(--canvas); backdrop-filter: none; }
  .brand, .wordmark-row, .wordmark, .tagline { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
  .pulse-mark { width: 30px; height: 30px; border-radius: 2px; background: var(--surface); box-shadow: none; }
  .pulse-mark::before, .pulse-mark::after { border-radius: 0; box-shadow: none; }
  .wordmark { font-size: 20px; letter-spacing: -.025em; }
  .brand-kicker { margin-left: 6px; color: var(--muted); letter-spacing: .1em; }
  .hostchip { border-radius: 2px; padding: 2px 6px; font-family: var(--mono); font-size: 10px; }
  .controls { gap: 5px; }
  .theme-btn, .mini-btn, .switch-btn { border-radius: 3px; box-shadow: none; }
  .command-nav { position: sticky; top: 81px; z-index: 25; margin: 0 0 22px; padding: 0; gap: 0; border: 0; border-radius: 0; background: var(--canvas); box-shadow: none; border-bottom: 1px solid var(--border); }
  .command-nav a { padding: 9px 11px 10px; border-radius: 0; border: 0; border-bottom: 2px solid transparent; font-size: 11px; letter-spacing: .025em; }
  .command-nav a:hover, .command-nav a:focus-visible { background: transparent; border-color: var(--accent); color: var(--accent-ink); }
  .command-trigger { margin-left: auto; align-self: center; border: 1px solid var(--border); border-radius: 3px; background: transparent; color: var(--ink-2); padding: 5px 8px; font: 600 11px/1 var(--mono); cursor: pointer; }
  .command-trigger:hover, .command-trigger:focus-visible { color: var(--accent-ink); border-color: var(--accent); }
  .connect-panel, .models-collapse { border-radius: 0; box-shadow: none; background: transparent; border-inline: 0; }
  .connect-panel { border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .connect-panel pre, #routing-help pre { border-radius: 2px; }
  .models-warning { border-radius: 0; background: transparent; }
  .hero, .tile, .drawer, .card { background: transparent; box-shadow: none; border-radius: 0; }
  .hero { border-inline: 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); border-left: 3px solid var(--accent); padding: 18px 0 18px 16px; }
  .hero::after { display: none; }
  .hero-num { background: none; color: var(--accent); font-size: clamp(42px, 6vw, 64px); }
  .hero-neg .hero-num { background: none; color: var(--bad); }
  .strip { gap: 0; margin: 0 0 26px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .tile { padding: 13px 16px; border: 0; border-right: 1px solid var(--border); }
  .tile:last-child { border-right: 0; }
  .tile-label { margin-bottom: 5px; }
  .section { margin-top: 42px; scroll-margin-top: 112px; }
  .section-head { margin-bottom: 16px; font-size: 16px; letter-spacing: -.01em; }
  .section-sub { max-width: 64ch; }
  .xray { gap: 26px; grid-template-columns: minmax(0, 1.1fr) minmax(320px, .9fr); }
  .xray > .card { padding: 0; }
  .xray > .card + .card { border-left: 1px solid var(--border); padding-left: 26px; }
  .card-head { letter-spacing: .09em; }
  .split-col, .empty-note, .evicted { border-radius: 0; background: transparent; }
  .split-img, .split-txt { background: transparent; }
  .page, .frame, .src-pane { border-radius: 2px; }
  .page:hover { transform: none; }
  .live-dot { animation: none; }
  .pill, .badge, .tag, .switch-state, .cp-life { border-radius: 2px; }
  .pill, .badge, .tag { padding-inline: 6px; }
  .cp-runtime-lane { display: grid; min-width: 0; max-width: 100%; grid-template-columns: 76px minmax(0, 1fr) minmax(260px, .7fr); gap: 20px; align-items: center; padding: 20px 0; border-top: 2px solid var(--accent); border-bottom: 1px solid var(--border); scroll-margin-top: 112px; }
  .fury-core { width: 64px; height: 64px; display: grid; place-items: center; position: relative; border: 1px solid var(--border-strong); border-radius: 50%; }
  .fury-core::before, .fury-core::after { content: ''; position: absolute; border: 1px solid var(--accent); border-radius: 50%; }
  .fury-core::before { inset: 10px; } .fury-core::after { inset: 21px; border-color: var(--ink); }
  .fury-core span, .fury-core i, .fury-core b { position: absolute; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); }
  .fury-core span { top: 8px; } .fury-core i { right: 8px; background: var(--ink); } .fury-core b { bottom: 8px; background: var(--txt); }
  .eyebrow { display: block; color: var(--muted); font: 700 10px/1.2 var(--mono); letter-spacing: .11em; text-transform: uppercase; margin-bottom: 7px; }
  .cp-runtime-copy { min-width: 0; overflow-wrap: anywhere; }.cp-runtime-copy h2, .instrument-section h2, .cp-decision-lens h2 { margin: 0; color: var(--ink); font-size: 18px; line-height: 1.2; letter-spacing: -.01em; }
  .cp-runtime-copy p, .cp-decision-lens p, .instrument-section-head p { margin: 7px 0 0; font-size: 12px; color: var(--ink-2); }
  .cp-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; margin: 0; border-left: 1px solid var(--border); }
  .cp-metrics div { min-width: 0; padding: 0 12px; border-right: 1px solid var(--border); }
  .cp-metrics div:last-child { border-right: 0; }
  .cp-metrics dt { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
  .cp-metrics dd { margin: 4px 0 0; color: var(--ink); font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
  .cp-decision-lens { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, .65fr); gap: 24px; margin-top: 18px; padding: 16px 0; border-bottom: 1px solid var(--border); }
  .cp-decision-state { display: grid; gap: 8px; align-content: center; color: var(--muted); font-size: 11px; }
  .instrument-section { padding: 0; border: 0; }
  .instrument-section-head { display: flex; justify-content: space-between; gap: 18px; align-items: end; padding-bottom: 11px; border-bottom: 1px solid var(--border-strong); }
  .instrument-section-head output { flex: none; font: 600 10px/1.3 var(--mono); color: var(--muted); }
  .cp-explorer { display: grid; grid-template-columns: minmax(0, 1fr) minmax(330px, .48fr); column-gap: 24px; align-items: start; }
  .cp-explorer > .instrument-section-head { grid-column: 1 / -1; }
  .cp-explorer > .cp-tools, .cp-explorer > .cp-list { grid-column: 1; }
  .cp-tools { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(130px, .45fr) minmax(110px, .35fr); gap: 10px; margin: 14px 0 0; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
  .cp-tools label { gap: 5px; color: var(--muted); font: 700 10px/1.2 var(--mono); letter-spacing: .04em; text-transform: uppercase; }
  .cp-tools input, .cp-tools select { width: 100%; min-height: 32px; color: var(--ink); background: transparent; border: 1px solid var(--border-strong); border-radius: 2px; padding: 5px 8px; font: 12px/1.4 inherit; }
  .cp-tools input:focus-visible, .cp-tools select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .cp-list { border-bottom: 1px solid var(--border); }
  .cp-row { width: 100%; display: grid; grid-template-columns: minmax(130px, .8fr) minmax(180px, 1.2fr) minmax(190px, 1fr) auto; gap: 12px; align-items: center; text-align: left; padding: 11px 8px; border: 0; border-bottom: 1px solid var(--border); border-radius: 0; background: transparent; color: var(--ink-2); font: inherit; cursor: pointer; }
  .cp-row:last-child { border-bottom: 0; }
  .cp-row:hover { background: var(--raised); }
  .cp-row:focus-visible, .cp-row[aria-pressed="true"] { outline: 2px solid var(--accent); outline-offset: -2px; background: var(--accent-tint); }
  .cp-row-title { color: var(--ink); font-weight: 700; }
  .cp-row-source, .cp-row-life { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
  .cp-row-life { display: flex; flex-wrap: wrap; gap: 4px; white-space: normal; }
  .cp-state, .cp-freshness { display: inline-block; width: fit-content; border: 1px solid currentColor; padding: 2px 5px; border-radius: 2px; font: 700 10px/1.25 var(--mono); letter-spacing: .02em; white-space: nowrap; }
  .cp-state-verified, .cp-state-executed, .cp-state-available, .cp-state-executable, .cp-freshness-current { color: var(--good); }
  .cp-state-stale, .cp-freshness-stale { color: var(--warn); }
  .cp-state-failed, .cp-state-disabled { color: var(--bad); }
  .cp-state-not_available, .cp-state-not_executed, .cp-state-partial, .cp-state-unknown, .cp-freshness-missing { color: var(--muted); }
  .cp-inspector { grid-column: 2; grid-row: 2 / span 2; position: sticky; top: 130px; z-index: 15; display: grid; gap: 8px; margin: 14px 0 0; max-width: none; padding: 15px 16px; background: var(--raised); border: 1px solid var(--border-strong); border-left: 3px solid var(--accent); border-radius: 0; box-shadow: none; }
  .cp-inspector h3 { margin: 0; color: var(--ink); font-size: 15px; }.cp-inspector p { margin: 0; color: var(--muted); font-size: 12px; }
  .cp-inspector dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px 16px; margin: 2px 0 0; }.cp-inspector dl div { min-width: 0; }.cp-inspector dt { color: var(--muted); font: 700 10px/1.2 var(--mono); text-transform: uppercase; letter-spacing: .05em; }.cp-inspector dd { margin: 4px 0 0; color: var(--ink); overflow-wrap: anywhere; font-size: 12px; }
  .cp-inspector details { font-size: 11px; color: var(--muted); }.cp-inspector pre { margin: 7px 0 0; padding: 8px; border: 1px solid var(--border); background: var(--surface); border-radius: 0; color: var(--ink-2); white-space: pre-wrap; word-break: break-word; font: 10px/1.4 var(--mono); }
  .cp-topology { scroll-margin-top: 112px; }.cp-bindings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 28px; margin: 0; padding: 0; list-style: none; border-bottom: 1px solid var(--border); }.cp-bindings li { display: grid; grid-template-columns: minmax(110px, .75fr) auto minmax(0, 1.25fr); gap: 8px; padding: 10px 6px; border-top: 1px solid var(--border); font-size: 12px; min-width: 0; }.cp-bindings li > span:first-child { color: var(--ink); font-weight: 650; }.cp-bindings code { overflow-wrap: anywhere; color: var(--ink-2); }
  .cp-evidence-lens { scroll-margin-top: 112px; }.cp-evidence { margin-top: 0; }.cp-evidence td, .cp-evidence th { padding-block: 10px; }.cp-evidence tr:hover { background: var(--raised); }
  #frag-control-room { border-top: 1px solid var(--border); padding-top: 14px; }.control-room-lane { margin-top: 32px; }
  #frag-stats, #frag-sessions { border-top: 1px solid var(--border); }
  /* Control Plane convergence: one shell, no legacy dashboard stacked ahead of
     it. Structural borders identify a navigation layer; content itself stays
     flat and evidence-led rather than becoming another card grid. */
  .cp-shell { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr); gap: 0; margin-bottom: 48px; }
  .cp-shell-overview { min-width: 0; padding: 8px 0 30px; border-bottom: 2px solid var(--accent); scroll-margin-top: 112px; }
  .cp-shell-heading { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, .55fr); gap: 10px 28px; align-items: end; margin: 4px 0 4px; }
  .cp-shell-heading .eyebrow { grid-column: 1 / -1; margin-bottom: 0; }
  .cp-shell-heading h1 { margin: 0; color: var(--ink); font-size: clamp(25px, 3vw, 39px); line-height: 1; letter-spacing: -.045em; }
  .cp-shell-heading p { margin: 0 0 2px; color: var(--ink-2); font-size: 12px; text-wrap: balance; }
  .cp-efficiency { margin-top: 16px; border-top: 1px solid var(--border); }
  .cp-efficiency .strip { margin: 0; }
  .cp-disclosure { margin: 0; padding: 0; border: 0; border-bottom: 1px solid var(--border-strong); scroll-margin-top: 112px; }
  .cp-disclosure > summary { display: grid; grid-template-columns: 30px minmax(130px, .5fr) minmax(0, 1.5fr) 24px; gap: 14px; align-items: baseline; min-height: 68px; padding: 18px 4px; color: var(--ink); cursor: pointer; list-style: none; }
  .cp-disclosure > summary::-webkit-details-marker { display: none; }
  .cp-disclosure > summary::after { content: '+'; justify-self: end; color: var(--accent-ink); font: 500 22px/1 var(--mono); }
  .cp-disclosure[open] > summary::after { content: '−'; }
  .cp-disclosure > summary > span { color: var(--muted); font: 700 10px/1.2 var(--mono); letter-spacing: .08em; }
  .cp-disclosure > summary > strong { font-size: 16px; letter-spacing: -.015em; }
  .cp-disclosure > summary > small { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
  .cp-disclosure > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .cp-disclosure-body { padding: 4px 0 30px; }
  .cp-disclosure .instrument-section { padding-top: 4px; }
  .cp-observe-sessions, .cp-history { margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--border); }
  .cp-settings-body { display: grid; gap: 12px; max-width: 920px; }
  .cp-settings-body > #frag-toggle { justify-self: start; }
  .cp-settings-body .connect-panel, .cp-settings-body .models-collapse { margin: 0; }
  dialog#command-palette { width: min(620px, calc(100% - 32px)); padding: 0; border: 1px solid var(--border-strong); border-radius: 2px; background: var(--surface); color: var(--ink); box-shadow: none; }
  dialog#command-palette::backdrop { background: rgba(3,6,12,.56); }.command-palette-head { display: grid; gap: 8px; padding: 14px; border-bottom: 1px solid var(--border); }.command-palette-head label { color: var(--muted); font: 700 10px/1.2 var(--mono); text-transform: uppercase; }.command-palette-head input { min-height: 36px; border: 1px solid var(--border-strong); border-radius: 2px; background: transparent; color: var(--ink); padding: 7px 9px; font: 14px inherit; }.command-results { display: grid; padding: 8px; }.command-results a { display: grid; grid-template-columns: 110px 1fr; gap: 10px; padding: 9px; color: var(--ink); text-decoration: none; border-left: 2px solid transparent; }.command-results a:hover, .command-results a:focus-visible { background: var(--raised); border-left-color: var(--accent); outline: 0; }.command-results small { color: var(--muted); font: 10px/1.3 var(--mono); }.command-palette-foot { margin: 0; padding: 10px 14px; color: var(--muted); border-top: 1px solid var(--border); font-size: 11px; }
  .skip-link { position: absolute; left: 8px; top: -50px; z-index: 100; padding: 8px; background: var(--surface); color: var(--ink); border: 2px solid var(--accent); }.skip-link:focus { top: 8px; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (max-width: 1000px) { .cp-runtime-lane { grid-template-columns: 68px minmax(0, 1fr); }.cp-metrics { grid-column: 1 / -1; border-left: 0; }.xray { grid-template-columns: 1fr; }.xray > .card + .card { border-left: 0; border-top: 1px solid var(--border); padding: 24px 0 0; }.cp-bindings { grid-template-columns: 1fr; } }
  @media (max-width: 760px) { .cp-explorer { grid-template-columns: 1fr; }.cp-explorer > .instrument-section-head, .cp-explorer > .cp-tools, .cp-explorer > .cp-list, .cp-inspector { grid-column: 1; }.cp-inspector { grid-row: auto; position: static; } }
  @media (max-width: 640px) { .workspace { width: min(100% - 24px, 1440px); }.topbar { position: static; }.command-nav { top: 0; margin-inline: -12px; padding-inline: 12px; }.command-nav a { padding-inline: 9px; }.command-trigger { display: none; }.strip { grid-template-columns: repeat(2, 1fr); }.tile:nth-child(2) { border-right: 0; }.tile:nth-child(-n+2) { border-bottom: 1px solid var(--border); }.cp-runtime-lane { grid-template-columns: 50px minmax(0, 1fr); gap: 12px; }.fury-core { width: 44px; height: 44px; }.fury-core::before { inset: 7px; }.fury-core::after { inset: 15px; }.fury-core span { top: 5px; }.fury-core i { right: 5px; }.fury-core b { bottom: 5px; }.cp-metrics { grid-template-columns: 1fr; gap: 7px; }.cp-metrics div { padding: 0; border-right: 0; }.cp-decision-lens { grid-template-columns: 1fr; gap: 12px; }.instrument-section-head { align-items: start; flex-direction: column; }.cp-tools { grid-template-columns: 1fr; }.cp-row { grid-template-columns: minmax(0, 1fr) auto; gap: 7px; }.cp-row-source, .cp-row-life { grid-column: 1 / -1; }.cp-row-source { white-space: normal; }.cp-inspector { position: static; }.cp-inspector dl { grid-template-columns: 1fr; }.cp-bindings li { grid-template-columns: minmax(90px, .75fr) auto minmax(0, 1.25fr); }.cp-evidence tr { border-radius: 0 !important; background: transparent !important; }.cp-evidence td { grid-template-columns: minmax(105px, .8fr) minmax(0, 1.2fr) !important; }.hero { padding-left: 12px; }.cp-shell-heading { grid-template-columns: 1fr; gap: 8px; }.cp-shell-overview { padding-top: 0; }.cp-disclosure > summary { grid-template-columns: 24px minmax(0, 1fr) 20px; gap: 9px; min-height: 60px; padding-block: 14px; }.cp-disclosure > summary > small { grid-column: 2 / -1; }.cp-disclosure-body { padding-bottom: 22px; }.cp-disclosure:not([open]) { border-bottom-color: var(--border); } }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; } }
`;

// Client glue: window.fury (pin+source state) → hx-vals; preserves <details> open state across swaps; routes htmx errors to toast tray.
const GLUE_JS = `
  window.fury = { pin: null, src: false, cpId: null };
  function furyPin(id) {
    window.fury.pin = id;
    htmx.trigger('#frag-latest', 'fury-refresh');
  }
  function furySource(on) {
    window.fury.src = on;
    htmx.trigger('#frag-latest', 'fury-refresh');
  }
  document.body.addEventListener('htmx:beforeSwap', function (ev) {
    const open = [];
    ev.detail.target.querySelectorAll('details[open][id]').forEach(function (d) { open.push(d.id); });
    ev.detail.target.__furyOpen = open;
  });
  document.body.addEventListener('htmx:afterSwap', function (ev) {
    (ev.detail.target.__furyOpen || []).forEach(function (id) {
      const d = document.getElementById(id);
      if (d) d.setAttribute('open', '');
    });
    if (ev.detail.target && ev.detail.target.id === 'frag-cp-capabilities') furyRefreshControlPlane(ev.detail.target);
  });
  function furyRefreshControlPlane(root) {
    if (!root) return;
    var search = root.querySelector('[data-cp-search-input]');
    var filter = root.querySelector('[data-cp-filter]');
    var sort = root.querySelector('[data-cp-sort]');
    var list = root.querySelector('.cp-list');
    var rows = function () { return Array.prototype.slice.call(root.querySelectorAll('[data-cp-row]')); };
    function update() {
      var query = (search && search.value || '').toLocaleLowerCase();
      var state = filter && filter.value || 'ALL';
      var visible = 0;
      rows().forEach(function (row) {
        var match = row.dataset.cpSearch.indexOf(query) !== -1 && (state === 'ALL' || row.dataset.cpStatus === state);
        row.hidden = !match;
        if (match) visible++;
      });
      var count = root.querySelector('[data-cp-result-count]');
      if (count) count.textContent = visible + ' ' + count.dataset.cpResultLabel;
    }
    function reorder() {
      if (!list) return;
      var key = sort && sort.value === 'status' ? 'cpStatus' : 'cpSearch';
      rows().sort(function (a, b) { return (a.dataset[key] || '').localeCompare(b.dataset[key] || ''); }).forEach(function (row) { list.appendChild(row); });
    }
    if (search) search.addEventListener('input', update);
    if (filter) filter.addEventListener('change', update);
    if (sort) sort.addEventListener('change', function () { reorder(); update(); });
    root.addEventListener('click', function (event) {
      var row = event.target.closest('[data-cp-row]');
      if (row) furyInspectControlPlane(root, row);
    });
    if (window.fury.cpId && /^[a-z-]+$/.test(window.fury.cpId)) {
      var selected = root.querySelector('[data-cp-id="' + window.fury.cpId + '"]');
      if (selected) furyInspectControlPlane(root, selected);
    }
    update();
  }
  function furyInspectControlPlane(root, row) {
    var panel = root.querySelector('[data-cp-inspector]');
    if (!panel || !row) return;
    window.fury.cpId = row.dataset.cpId || null;
    root.querySelectorAll('[data-cp-row]').forEach(function (item) { item.setAttribute('aria-pressed', item === row ? 'true' : 'false'); });
    panel.querySelector('[data-cp-inspector-title]').textContent = row.dataset.cpLabel || '';
    panel.querySelector('[data-cp-inspector-empty]').hidden = true;
    var details = panel.querySelector('[data-cp-inspector-details]');
    var raw = panel.querySelector('[data-cp-inspector-raw]');
    details.hidden = false; raw.hidden = false;
    panel.querySelector('[data-cp-inspector-status]').textContent = row.dataset.cpStatus || '';
    panel.querySelector('[data-cp-inspector-source]').textContent = row.dataset.cpSource || '';
    panel.querySelector('[data-cp-inspector-lifecycle]').textContent = row.dataset.cpLifecycle || '';
    panel.querySelector('[data-cp-inspector-warnings]').textContent = row.dataset.cpWarnings || panel.dataset.noWarnings || '';
    panel.querySelector('[data-cp-inspector-json]').textContent = JSON.stringify({ id: row.dataset.cpId, source: row.dataset.cpSource, status: row.dataset.cpStatus, lifecycle: row.dataset.cpLifecycle }, null, 2);
    try {
      var params = new URLSearchParams(location.search);
      params.set('inspect', 'domain:' + window.fury.cpId);
      history.replaceState(null, '', location.pathname + '?' + params.toString() + location.hash);
    } catch (e) {}
  }
  function furyCommandPalette() {
    var dialog = document.getElementById('command-palette');
    if (dialog && !dialog.open) { dialog.showModal(); var input = dialog.querySelector('input'); if (input) input.focus(); }
  }
  document.addEventListener('keydown', function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); furyCommandPalette(); }
  });
  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-command-open]')) furyCommandPalette();
    var command = event.target.closest('[data-command-item]');
    if (command) { var dialog = document.getElementById('command-palette'); if (dialog) dialog.close(); }
  });
  document.addEventListener('input', function (event) {
    var input = event.target;
    if (!input || input.id !== 'command-search') return;
    var query = input.value.toLocaleLowerCase();
    document.querySelectorAll('[data-command-item]').forEach(function (item) { item.hidden = item.dataset.commandSearch.indexOf(query) === -1; });
  });
  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('frag-cp-capabilities');
    if (root) furyRefreshControlPlane(root);
    try {
      var inspect = new URLSearchParams(location.search).get('inspect');
      if (inspect && /^domain:[a-z-]+$/u.test(inspect)) window.fury.cpId = inspect.slice('domain:'.length);
    } catch (e) {}
  });
  (function () {
    function revealHashTarget() {
      var id = location.hash.slice(1);
      var target = id ? document.getElementById(id) : null;
      if (target && target.matches && target.matches('details.cp-disclosure')) target.open = true;
    }
    document.addEventListener('DOMContentLoaded', function () {
      if (!matchMedia('(max-width: 640px)').matches) return;
      document.querySelectorAll('details.cp-disclosure').forEach(function (detail) {
        detail.open = detail.id === 'observe';
      });
      revealHashTarget();
    });
    window.addEventListener('hashchange', revealHashTarget);
  })();
  document.body.addEventListener('htmx:responseError', function (ev) {
    window.dispatchEvent(new CustomEvent('fury-toast', {
      detail: { text: ev.detail.xhr.status + ' ' + ev.detail.requestConfig.path }
    }));
  });
  document.body.addEventListener('htmx:sendError', function (ev) {
    window.dispatchEvent(new CustomEvent('fury-toast', {
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
    window.furyTheme = function () {
      var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('furypipe-theme', next); } catch (e) {}
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
      var s = localStorage.getItem('furypipe-theme');
      var dark = s ? s === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    } catch (e) { document.documentElement.dataset.theme = 'light'; }
  })();
  window.furyLocale = ${JSON.stringify(activeLocale)};
  (function () {
    try {
      var params = new URLSearchParams(location.search);
      var requested = params.get('locale');
      var saved = localStorage.getItem('furypipe-locale');
      if (!requested && saved && saved !== window.furyLocale) {
        params.set('locale', saved);
        location.replace(location.pathname + '?' + params.toString() + location.hash);
        return;
      }
      localStorage.setItem('furypipe-locale', window.furyLocale);
    } catch (e) {}
    window.furySetLocale = function (next) {
      try { localStorage.setItem('furypipe-locale', next); } catch (e) {}
      var params = new URLSearchParams(location.search);
      params.set('locale', next);
      location.search = params.toString();
    };
    document.addEventListener('htmx:configRequest', function (event) {
      if (event.detail && event.detail.parameters) event.detail.parameters.locale = window.furyLocale;
    });
  })();
</script>
</head>
<body>
<a class="skip-link" href="#overview">${escapeHtml(t('dashboard.page.skipToContent'))}</a>
<div class="workspace">

<header class="topbar">
  <div class="brand">
    <span class="pulse-mark"></span>
    <div>
      <div class="wordmark-row">
        <div class="wordmark">FuryPipe <span class="brand-kicker">Control Plane</span></div>
        ${host ? `<span class="hostchip" title="${escapeHtml(t('dashboard.page.proxyHost'))}">${host}</span>` : ''}
      </div>
      <div class="tagline">${escapeHtml(dashboardT(activeLocale, 'dashboard.tagline'))}</div>
    </div>
  </div>
  <div class="controls">
    <label class="hint">${escapeHtml(dashboardT(activeLocale, 'dashboard.language'))} <select class="mini-btn" onchange="furySetLocale(this.value)">${languageOptions}</select></label>
    <button type="button" id="theme-btn" class="theme-btn" onclick="furyTheme()"
      data-dark-label="${escapeHtml(dashboardT(activeLocale, 'dashboard.themeDark'))}"
      data-light-label="${escapeHtml(dashboardT(activeLocale, 'dashboard.themeLight'))}"
      data-toggle-label="${escapeHtml(dashboardT(activeLocale, 'dashboard.themeToggle'))}"
      aria-label="${escapeHtml(dashboardT(activeLocale, 'dashboard.themeToggle'))}"
      title="${escapeHtml(dashboardT(activeLocale, 'dashboard.themeToggle'))}">☾ ${escapeHtml(dashboardT(activeLocale, 'dashboard.themeDark'))}</button>
  </div>
</header>

<nav class="command-nav" aria-label="${escapeHtml(t('dashboard.page.navLabel'))}">
  <a href="#overview">${escapeHtml(t('dashboard.page.navOverview'))}</a>
  <a href="#observe">${escapeHtml(t('dashboard.page.navObserve'))}</a>
  <a href="#capabilities">${escapeHtml(t('dashboard.page.navCapabilities'))}</a>
  <a href="#visual-engine">${escapeHtml(t('dashboard.page.navVisualEngine'))}</a>
  <a href="#topology">${escapeHtml(t('dashboard.page.navTopology'))}</a>
  <a href="#evidence">${escapeHtml(t('dashboard.page.navEvidence'))}</a>
  <a href="#settings">${escapeHtml(t('dashboard.page.navSettings'))}</a>
  <button type="button" class="command-trigger" data-command-open aria-haspopup="dialog" aria-controls="command-palette" aria-label="${escapeHtml(t('dashboard.page.commandPalette'))}">⌘K</button>
</nav>

<dialog id="command-palette" aria-labelledby="command-palette-title" onclick="if (event.target === this) this.close()">
  <div class="command-palette-head">
    <label id="command-palette-title" for="command-search">${escapeHtml(t('dashboard.page.commandPalette'))}</label>
    <input id="command-search" type="search" autocomplete="off" placeholder="${escapeHtml(t('dashboard.page.commandSearch'))}" />
  </div>
  <div class="command-results" role="list">
    <a href="#overview" data-command-item data-command-search="overview runtime"><small>01 · RUNTIME</small><span>${escapeHtml(t('dashboard.page.navOverview'))}</span></a>
    <a href="#observe" data-command-item data-command-search="observe context sessions"><small>02 · OBSERVE</small><span>${escapeHtml(t('dashboard.page.navObserve'))}</span></a>
    <a href="#capabilities" data-command-item data-command-search="capabilities skills mcp agents providers"><small>03 · CAPABILITIES</small><span>${escapeHtml(t('dashboard.page.navCapabilities'))}</span></a>
    <a href="#visual-engine" data-command-item data-command-search="visual engine decisions"><small>04 · DECISION</small><span>${escapeHtml(t('dashboard.page.navVisualEngine'))}</span></a>
    <a href="#topology" data-command-item data-command-search="topology sources"><small>05 · TOPOLOGY</small><span>${escapeHtml(t('dashboard.page.navTopology'))}</span></a>
    <a href="#evidence" data-command-item data-command-search="evidence source sha run"><small>06 · EVIDENCE</small><span>${escapeHtml(t('dashboard.page.navEvidence'))}</span></a>
    <a href="#settings" data-command-item data-command-search="settings locale theme models"><small>07 · SETTINGS</small><span>${escapeHtml(t('dashboard.page.navSettings'))}</span></a>
  </div>
  <p class="command-palette-foot">${escapeHtml(t('dashboard.page.commandHint'))}</p>
</dialog>

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
npx furypipe</pre>
  <p>${escapeHtml(t('dashboard.page.routingPrefix'))} ${escapeHtml(t('dashboard.page.routingSwitch'))}</p>
  <p><code>FURYPIPE_MODELS</code> — ${escapeHtml(t('dashboard.page.scopeSeparate'))} ${escapeHtml(t('dashboard.page.routingEvidence'))}</p>
  <button class="mini-btn" type="button" onclick="this.closest('dialog').close()">${escapeHtml(t('dashboard.page.close'))}</button>
</dialog>

<main id="instrument-panel" class="cp-shell">
  <section class="cp-shell-overview" id="overview" aria-labelledby="overview-title">
    <div class="cp-shell-heading"><span class="eyebrow">FURYPIPE / LIVE</span><h1 id="overview-title">${escapeHtml(t('dashboard.page.navOverview'))}</h1><p>${escapeHtml(t('dashboard.controlPlane.subtitle'))}</p></div>
    <div id="frag-cp-overview" hx-get="/fragments/control-plane-overview" hx-trigger="load, every 5s" hx-swap="innerHTML"><div class="status">${escapeHtml(t('dashboard.controlPlane.loading'))}</div></div>
    <div class="cp-efficiency" aria-label="${escapeHtml(t('dashboard.controlPlane.runtimeLane'))}">
      <div id="frag-header" hx-get="/fragments/header" hx-trigger="load, every 2s" hx-swap="innerHTML"></div>
    </div>
  </section>

  <details class="cp-disclosure" id="observe" open>
    <summary><span>02</span><strong>${escapeHtml(t('dashboard.page.navObserve'))}</strong><small>${escapeHtml(t('dashboard.page.contextSub'))}</small></summary>
    <div class="cp-disclosure-body">
      <div class="xray">
        <div class="card"><h2 class="card-head">${escapeHtml(t('dashboard.page.recent'))}</h2><div id="frag-recent" hx-get="/fragments/recent" hx-trigger="load, every 2s" hx-swap="innerHTML"></div></div>
        <div class="card"><h2 class="card-head">${escapeHtml(t('dashboard.page.breakdown'))}</h2><div id="frag-context-map" hx-get="/fragments/context-map" hx-trigger="load" hx-swap="innerHTML"></div><h2 class="card-head spaced">${escapeHtml(t('dashboard.page.inspector'))}</h2><div id="frag-latest" hx-get="/fragments/latest" hx-trigger="load, every 2s, fury-refresh" hx-swap="innerHTML" hx-vals='js:{pin: window.fury.pin == null ? "" : window.fury.pin, source: window.fury.src ? "1" : ""}'></div></div>
      </div>
      <div class="cp-observe-sessions"><h2 class="card-head">${escapeHtml(t('dashboard.page.topSessions'))} <span class="section-sub">${escapeHtml(t('dashboard.page.bySaved'))}</span></h2><div id="frag-sessions" hx-get="/fragments/sessions" hx-trigger="load, every 5s" hx-swap="innerHTML"></div></div>
    </div>
  </details>

  <details class="cp-disclosure" id="capabilities" open>
    <summary><span>03</span><strong>${escapeHtml(t('dashboard.page.navCapabilities'))}</strong><small>${escapeHtml(t('dashboard.controlPlane.subtitle'))}</small></summary>
    <div class="cp-disclosure-body"><div id="frag-cp-capabilities" hx-get="/fragments/control-plane-capabilities" hx-trigger="load, every 5s" hx-swap="innerHTML"><div class="status">${escapeHtml(t('dashboard.controlPlane.loading'))}</div></div></div>
  </details>

  <details class="cp-disclosure" id="visual-engine" open>
    <summary><span>04</span><strong>${escapeHtml(t('dashboard.page.navVisualEngine'))}</strong><small>${escapeHtml(t('dashboard.controlPlane.decisionLens'))}</small></summary>
    <div class="cp-disclosure-body"><div id="frag-cp-visual-engine" hx-get="/fragments/control-plane-visual-engine" hx-trigger="load, every 5s" hx-swap="innerHTML"><div class="status">${escapeHtml(t('dashboard.controlPlane.loading'))}</div></div></div>
  </details>

  <details class="cp-disclosure" id="topology" open>
    <summary><span>05</span><strong>${escapeHtml(t('dashboard.page.navTopology'))}</strong><small>${escapeHtml(t('dashboard.controlPlane.sourceBindingsSub'))}</small></summary>
    <div class="cp-disclosure-body"><div id="frag-cp-topology" hx-get="/fragments/control-plane-topology" hx-trigger="load, every 5s" hx-swap="innerHTML"><div class="status">${escapeHtml(t('dashboard.controlPlane.loading'))}</div></div></div>
  </details>

  <details class="cp-disclosure" id="evidence" open>
    <summary><span>06</span><strong>${escapeHtml(t('dashboard.page.navEvidence'))}</strong><small>${escapeHtml(t('dashboard.controlPlane.evidenceTitle'))}</small></summary>
    <div class="cp-disclosure-body">
      <div id="frag-cp-evidence" hx-get="/fragments/control-plane-evidence" hx-trigger="load, every 5s" hx-swap="innerHTML"><div class="status">${escapeHtml(t('dashboard.controlPlane.loading'))}</div></div>
      <div class="control-room-lane"><div id="frag-control-room" hx-get="/fragments/control-room" hx-trigger="load, every 5s" hx-swap="innerHTML"><div class="status">${escapeHtml(t('dashboard.page.loadingControlRoom'))}</div></div></div>
      <div class="cp-history"><h2 class="card-head">${escapeHtml(t('dashboard.page.historyTitle'))} <span class="section-sub">${escapeHtml(t('dashboard.page.historySub'))}</span></h2><div id="frag-stats" hx-get="/fragments/stats" hx-trigger="load, every 5s" hx-swap="innerHTML"></div></div>
    </div>
  </details>

  <details class="cp-disclosure" id="settings" open>
    <summary><span>07</span><strong>${escapeHtml(t('dashboard.page.navSettings'))}</strong><small>${escapeHtml(t('dashboard.page.modelScopeHint'))}</small></summary>
    <div class="cp-disclosure-body cp-settings-body">
      <div id="frag-toggle" hx-get="/fragments/toggle" hx-trigger="load, every 2s" hx-swap="innerHTML"></div>
      <details class="connect-panel"><summary class="models-summary">${escapeHtml(t('dashboard.page.connectAgent'))} <span class="hint">${escapeHtml(t('dashboard.page.connectHint'))}</span></summary><p>${escapeHtml(t('dashboard.page.linkIntro'))}</p><pre>furypipe link claude
furypipe link codex
furypipe link cursor-agent</pre><p>${escapeHtml(t('dashboard.page.aliasHelp'))}<br><code>furypipe link pp</code> · <code>--route PATTERN=http://host:port</code> · <code>ANTHROPIC_BASE_URL=http://127.0.0.1:${port}</code></p><p>${escapeHtml(t('dashboard.page.pinIntro'))}</p><pre>@furypipe pin be concise, no walls of text
@furypipe unpin 2
@furypipe unpin all</pre><p>${escapeHtml(t('dashboard.page.pinList'))}</p><p>${escapeHtml(t('dashboard.page.pinFileHelp'))} <code>CLAUDE.md</code> / <code>AGENTS.md</code></p></details>
      <details class="models-collapse"><summary class="models-summary">${escapeHtml(t('dashboard.page.modelScope'))} <span class="hint">${escapeHtml(t('dashboard.page.modelScopeHint'))}</span></summary><div class="models-warning">⚠ ${escapeHtml(t('dashboard.page.modelScopeWarning'))}</div><div id="frag-models" hx-get="/fragments/models" hx-trigger="load, every 2s [!document.activeElement || document.activeElement.id !== 'models-csv']" hx-swap="innerHTML"></div><div class="models-routing"><span class="hint">${escapeHtml(t('dashboard.page.routingHint'))}</span> <button class="mini-btn" type="button" onclick="document.getElementById('routing-help').showModal()">${escapeHtml(t('dashboard.page.routingHelp'))}</button></div></details>
    </div>
  </details>
</main>

</div>

<div class="tray" x-data="{ toasts: [], next: 1 }"
     @fury-toast.window="const id = next++; toasts.push({ id, text: $event.detail.text }); setTimeout(() => toasts = toasts.filter(t => t.id !== id), 5000)">
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
