import { createHash } from 'node:crypto';

import { validateFuryPluginBundle, type FuryPluginBundle } from './plugin-bundles.js';
import { validateFuryPluginRuntimeDescriptor, type FuryPluginRuntimeDescriptor } from './fury-plugin-runtime.js';
import {
  approveFuryPluginSandboxExecution,
  executeFuryPluginSandbox,
  planFuryPluginSandboxExecution,
  type FuryPluginSandboxApproval,
  type FuryPluginSandboxPlan,
  type FuryPluginSandboxReceipt,
} from './fury-plugin-sandbox-node.js';

export const FURY_PLUGIN_UI_DOCUMENT_FORMAT = 'furypipe-plugin-ui/v1' as const;
export const FURY_PLUGIN_UI_RENDER_PLAN_FORMAT = 'furypipe-plugin-ui-render-plan/v1' as const;
export const FURY_PLUGIN_UI_RENDER_RECEIPT_FORMAT = 'furypipe-plugin-ui-render-receipt/v1' as const;

export type FuryPluginUiTone = 'default' | 'muted' | 'success' | 'warning' | 'danger';
export type FuryPluginUiButtonVariant = 'primary' | 'secondary' | 'danger';

export type FuryPluginUiNode =
  | { readonly type: 'text'; readonly text: string; readonly tone?: FuryPluginUiTone }
  | { readonly type: 'code'; readonly text: string }
  | { readonly type: 'badge'; readonly text: string; readonly tone?: FuryPluginUiTone }
  | { readonly type: 'button'; readonly label: string; readonly actionId: string; readonly variant?: FuryPluginUiButtonVariant }
  | { readonly type: 'divider' }
  | { readonly type: 'row' | 'stack'; readonly children: readonly FuryPluginUiNode[] };

export interface FuryPluginUiDocument {
  readonly format: typeof FURY_PLUGIN_UI_DOCUMENT_FORMAT;
  readonly title: string;
  readonly nodes: readonly FuryPluginUiNode[];
}

export interface FuryPluginUiRenderPlan {
  readonly format: typeof FURY_PLUGIN_UI_RENDER_PLAN_FORMAT;
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly extensionId: string;
  readonly surface: 'sidebar' | 'panel' | 'command-palette' | 'settings' | 'artifact-viewer';
  readonly title: string;
  readonly sandboxPlan: FuryPluginSandboxPlan;
  readonly state: 'READY_FOR_APPROVAL' | 'REJECTED';
  readonly planDigestSha256: string;
  readonly reasons: readonly string[];
  readonly requiresOperatorApproval: true;
  readonly browserCodeAuthorized: false;
  readonly htmlAuthorized: false;
  readonly networkAuthorized: false;
  readonly filesystemAuthorized: false;
  readonly executionAuthorized: false;
}

export interface FuryPluginUiRenderApproval {
  readonly planDigestSha256: string;
  readonly sandboxApproval: FuryPluginSandboxApproval;
}

export interface FuryPluginUiRenderReceipt {
  readonly format: typeof FURY_PLUGIN_UI_RENDER_RECEIPT_FORMAT;
  readonly pluginId: string;
  readonly extensionId: string;
  readonly document: FuryPluginUiDocument;
  readonly sandbox: FuryPluginSandboxReceipt;
  readonly documentDigestSha256: string;
  readonly browserCodeExecuted: false;
  readonly htmlAccepted: false;
  readonly hostAuthorityGranted: false;
}

const ACTION_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const TONES = new Set<FuryPluginUiTone>(['default', 'muted', 'success', 'warning', 'danger']);
const BUTTONS = new Set<FuryPluginUiButtonVariant>(['primary', 'secondary', 'danger']);
const plans = new WeakSet<object>();
const approvals = new WeakSet<object>();
const MAX_NODES = 256;
const MAX_DEPTH = 12;
const MAX_CONTEXT_BYTES = 64 * 1024;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const record = value as Readonly<Record<string, unknown>>;
  return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function bounded(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(label + ' must be bounded printable text');
  }
  return value;
}

function validateNode(value: unknown, state: { count: number }, depth: number): FuryPluginUiNode {
  if (depth > MAX_DEPTH) throw new Error('plugin UI document exceeds maximum depth');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('plugin UI node must be an object');
  state.count += 1;
  if (state.count > MAX_NODES) throw new Error('plugin UI document exceeds maximum node count');
  const raw = value as Record<string, unknown>;
  switch (raw.type) {
    case 'text': {
      const tone = raw.tone === undefined ? undefined : bounded(raw.tone, 'plugin UI text tone', 16) as FuryPluginUiTone;
      if (tone !== undefined && !TONES.has(tone)) throw new Error('plugin UI text tone is invalid');
      return Object.freeze({ type: 'text' as const, text: bounded(raw.text, 'plugin UI text', 8_000), ...(tone ? { tone } : {}) });
    }
    case 'code':
      return Object.freeze({ type: 'code' as const, text: bounded(raw.text, 'plugin UI code', 24_000) });
    case 'badge': {
      const tone = raw.tone === undefined ? undefined : bounded(raw.tone, 'plugin UI badge tone', 16) as FuryPluginUiTone;
      if (tone !== undefined && !TONES.has(tone)) throw new Error('plugin UI badge tone is invalid');
      return Object.freeze({ type: 'badge' as const, text: bounded(raw.text, 'plugin UI badge text', 160), ...(tone ? { tone } : {}) });
    }
    case 'button': {
      const actionId = bounded(raw.actionId, 'plugin UI action id', 128);
      if (!ACTION_ID.test(actionId)) throw new Error('plugin UI action id is invalid');
      const variant = raw.variant === undefined ? undefined : bounded(raw.variant, 'plugin UI button variant', 16) as FuryPluginUiButtonVariant;
      if (variant !== undefined && !BUTTONS.has(variant)) throw new Error('plugin UI button variant is invalid');
      return Object.freeze({ type: 'button' as const, label: bounded(raw.label, 'plugin UI button label', 160), actionId, ...(variant ? { variant } : {}) });
    }
    case 'divider':
      return Object.freeze({ type: 'divider' as const });
    case 'row':
    case 'stack': {
      if (!Array.isArray(raw.children) || raw.children.length > 64) throw new Error('plugin UI container children are invalid');
      return Object.freeze({ type: raw.type, children: Object.freeze(raw.children.map((child) => validateNode(child, state, depth + 1))) });
    }
    default:
      throw new Error('plugin UI node type is unsupported');
  }
}

export function validateFuryPluginUiDocument(value: unknown): FuryPluginUiDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('plugin UI document must be an object');
  const raw = value as Record<string, unknown>;
  if (raw.format !== FURY_PLUGIN_UI_DOCUMENT_FORMAT) throw new Error('plugin UI document format is invalid');
  if (!Array.isArray(raw.nodes) || raw.nodes.length > 64) throw new Error('plugin UI document root nodes are invalid');
  const state = { count: 0 };
  return Object.freeze({
    format: FURY_PLUGIN_UI_DOCUMENT_FORMAT,
    title: bounded(raw.title, 'plugin UI title', 256),
    nodes: Object.freeze(raw.nodes.map((node) => validateNode(node, state, 1))),
  });
}

export function planFuryPluginUiRender(input: {
  readonly bundle: FuryPluginBundle;
  readonly descriptor: FuryPluginRuntimeDescriptor;
  readonly extensionId: string;
  readonly hostApiVersion: string;
  readonly hostNodeVersion?: string;
}): FuryPluginUiRenderPlan {
  const bundle = validateFuryPluginBundle(input.bundle);
  const descriptor = validateFuryPluginRuntimeDescriptor(bundle, input.descriptor);
  const extension = descriptor.uiExtensions.find((candidate) => candidate.id === input.extensionId);
  if (!extension) throw new Error('unknown plugin UI extension');
  const sandboxPlan = planFuryPluginSandboxExecution({
    bundle,
    descriptor,
    entrypoint: extension.entrypoint,
    hostApiVersion: input.hostApiVersion,
    ...(input.hostNodeVersion ? { hostNodeVersion: input.hostNodeVersion } : {}),
  });
  const payload = Object.freeze({
    pluginId: bundle.id,
    pluginVersion: bundle.version,
    extensionId: extension.id,
    surface: extension.surface,
    title: extension.title,
    sandboxPlanDigestSha256: sandboxPlan.planDigestSha256,
  });
  const plan = Object.freeze({
    format: FURY_PLUGIN_UI_RENDER_PLAN_FORMAT,
    ...payload,
    sandboxPlan,
    state: sandboxPlan.state,
    planDigestSha256: digest(payload),
    reasons: sandboxPlan.reasons,
    requiresOperatorApproval: true as const,
    browserCodeAuthorized: false as const,
    htmlAuthorized: false as const,
    networkAuthorized: false as const,
    filesystemAuthorized: false as const,
    executionAuthorized: false as const,
  });
  plans.add(plan);
  return plan;
}

export function approveFuryPluginUiRender(
  plan: FuryPluginUiRenderPlan,
  input: { readonly confirm: true; readonly approvedBy: string; readonly approvedAt: string },
): FuryPluginUiRenderApproval {
  if (!plans.has(plan)) throw new Error('plugin UI render plan is not process-local');
  if (plan.state !== 'READY_FOR_APPROVAL') throw new Error('plugin UI render plan is rejected');
  const sandboxApproval = approveFuryPluginSandboxExecution(plan.sandboxPlan, input);
  const approval = Object.freeze({ planDigestSha256: plan.planDigestSha256, sandboxApproval });
  approvals.add(approval);
  return approval;
}

function boundedContext(value: unknown): unknown {
  const encoded = JSON.stringify(value ?? null);
  if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > MAX_CONTEXT_BYTES) throw new Error('plugin UI context exceeds 64 KiB');
  return JSON.parse(encoded) as unknown;
}

export async function executeFuryPluginUiRender(input: {
  readonly plan: FuryPluginUiRenderPlan;
  readonly approval: FuryPluginUiRenderApproval;
  readonly pluginRoot: string;
  readonly context?: unknown;
  readonly action?: { readonly actionId: string; readonly payload?: unknown };
}): Promise<FuryPluginUiRenderReceipt> {
  if (!plans.has(input.plan) || !approvals.has(input.approval)) throw new Error('plugin UI plan or approval is forged');
  if (input.approval.planDigestSha256 !== input.plan.planDigestSha256) throw new Error('plugin UI approval does not match plan');
  const action = input.action
    ? Object.freeze({
        actionId: ACTION_ID.test(input.action.actionId) ? input.action.actionId : (() => { throw new Error('plugin UI action id is invalid'); })(),
        payload: boundedContext(input.action.payload),
      })
    : undefined;
  const sandbox = await executeFuryPluginSandbox({
    plan: input.plan.sandboxPlan,
    approval: input.approval.sandboxApproval,
    pluginRoot: input.pluginRoot,
    payload: Object.freeze({
      format: 'furypipe-plugin-ui-request/v1',
      extensionId: input.plan.extensionId,
      type: action ? 'ACTION' : 'RENDER',
      context: boundedContext(input.context),
      ...(action ? { action } : {}),
    }),
  });
  if (sandbox.outcome !== 'SUCCEEDED') throw new Error('plugin UI sandbox did not produce a successful result');
  const document = validateFuryPluginUiDocument(sandbox.output);
  return Object.freeze({
    format: FURY_PLUGIN_UI_RENDER_RECEIPT_FORMAT,
    pluginId: input.plan.pluginId,
    extensionId: input.plan.extensionId,
    document,
    sandbox,
    documentDigestSha256: digest(document),
    browserCodeExecuted: false as const,
    htmlAccepted: false as const,
    hostAuthorityGranted: false as const,
  });
}
