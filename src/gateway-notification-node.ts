import { createHash, randomBytes } from 'node:crypto';

import {
  FuryGatewayChannelDeliveryOutcomeUnknownError,
  isGeneratedFuryGatewayChannelDeliveryCoordinator,
  isGeneratedFuryGatewayChannelDeliveryPermit,
  type FuryGatewayChannelDeliveryCoordinator,
  type FuryGatewayChannelDeliveryPermit,
  type FuryGatewayChannelDeliveryReceipt,
} from './gateway-channel-delivery-node.js';

export const FURY_GATEWAY_NOTIFICATION_FORMAT =
  'furypipe-gateway-notification/v1' as const;
export const FURY_GATEWAY_NOTIFICATION_POLICY_FORMAT =
  'furypipe-gateway-notification-policy/v1' as const;
export const FURY_GATEWAY_NOTIFICATION_ROUTE_FORMAT =
  'furypipe-gateway-notification-route/v1' as const;
export const FURY_GATEWAY_NOTIFICATION_DELIVERY_RECEIPT_FORMAT =
  'furypipe-gateway-notification-delivery-receipt/v1' as const;

export const FURY_GATEWAY_NOTIFICATION_SEVERITIES = Object.freeze([
  'info',
  'warning',
  'error',
  'critical',
] as const);

export type FuryGatewayNotificationSeverity =
  (typeof FURY_GATEWAY_NOTIFICATION_SEVERITIES)[number];

export interface FuryGatewayNotificationInput {
  readonly kind: string;
  readonly severity: FuryGatewayNotificationSeverity;
  readonly title: string;
  readonly summary: string;
  /** Opaque source evidence identity; stored only as SHA-256. */
  readonly sourceEvidenceId: string;
  readonly destinationPolicyKey: string;
  readonly acknowledgementRequired: boolean;
}

export interface FuryGatewayNotification {
  readonly format: typeof FURY_GATEWAY_NOTIFICATION_FORMAT;
  readonly notificationId: string;
  readonly kind: string;
  readonly severity: FuryGatewayNotificationSeverity;
  readonly title: string;
  readonly summary: string;
  readonly sourceEvidenceDigestSha256: string;
  readonly destinationPolicyKey: string;
  readonly acknowledgementRequired: boolean;
  readonly createdAt: number;
  readonly authority: 'notification-data-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayNotificationDestinationPolicyInput {
  readonly format: typeof FURY_GATEWAY_NOTIFICATION_POLICY_FORMAT;
  readonly policyKey: string;
  readonly adapterId: string;
  readonly destinationId: string;
  readonly threadId?: string;
  readonly allowedKinds: readonly string[];
  readonly allowedSeverities: readonly FuryGatewayNotificationSeverity[];
}

export interface FuryGatewayNotificationDestinationPolicyInspection {
  readonly format: typeof FURY_GATEWAY_NOTIFICATION_POLICY_FORMAT;
  readonly policyKey: string;
  readonly adapterId: string;
  readonly destinationDigestSha256: string;
  readonly threadDigestSha256?: string;
  readonly allowedKinds: readonly string[];
  readonly allowedSeverities: readonly FuryGatewayNotificationSeverity[];
  readonly authority: 'notification-routing-policy-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayNotificationRoutePlan {
  readonly format: typeof FURY_GATEWAY_NOTIFICATION_ROUTE_FORMAT;
  readonly routePlanId: string;
  readonly notificationId: string;
  readonly policyKey: string;
  readonly adapterId: string;
  readonly destinationDigestSha256: string;
  readonly threadDigestSha256?: string;
  readonly renderedPayloadSha256: string;
  readonly selectedAt: number;
  readonly authority: 'notification-routing-data-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayNotificationDeliveryReceipt {
  readonly format: typeof FURY_GATEWAY_NOTIFICATION_DELIVERY_RECEIPT_FORMAT;
  readonly notificationId: string;
  readonly routePlanId: string;
  readonly policyKey: string;
  readonly delivery: FuryGatewayChannelDeliveryReceipt;
  readonly acknowledgement: 'not-required' | 'pending';
  /**
   * Notification delivery never establishes the status of the source task.
   * Consumers must follow source evidence independently.
   */
  readonly underlyingTaskStatus: 'not-inferred';
  readonly authority: 'notification-delivery-evidence-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayNotificationStatusSnapshot {
  readonly observedAt: number;
  readonly notificationsCreated: number;
  readonly routesSelected: number;
  readonly deliveryPermitsPrepared: number;
  readonly deliveriesSettled: number;
  readonly acknowledgementsPending: number;
  readonly deliveryStatuses: Readonly<Record<
    | 'prepared'
    | 'expired'
    | 'in-flight'
    | 'accepted-for-delivery'
    | 'delivered'
    | 'provider-rejected'
    | 'outcome-unknown',
    number
  >>;
  readonly underlyingTaskStatus: 'not-inferred';
  readonly authority: 'observability-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayNotificationCoordinatorOptions {
  readonly deliveryCoordinator: FuryGatewayChannelDeliveryCoordinator;
  readonly now?: () => number;
  readonly deliveryPermitTtlMs?: number;
  readonly maxPolicies?: number;
  readonly maxNotifications?: number;
  readonly maxRoutePlans?: number;
}

export interface FuryGatewayNotificationCoordinator {
  registerDestinationPolicy(
    input: FuryGatewayNotificationDestinationPolicyInput,
  ): FuryGatewayNotificationDestinationPolicyInspection;
  inspectDestinationPolicy(
    policyKey: string,
  ): FuryGatewayNotificationDestinationPolicyInspection | undefined;
  createNotification(input: FuryGatewayNotificationInput): FuryGatewayNotification;
  selectDestination(
    notification: FuryGatewayNotification,
  ): FuryGatewayNotificationRoutePlan;
  prepareDelivery(
    route: FuryGatewayNotificationRoutePlan,
  ): FuryGatewayChannelDeliveryPermit;
  executeDelivery(
    route: FuryGatewayNotificationRoutePlan,
    permit: FuryGatewayChannelDeliveryPermit,
  ): Promise<FuryGatewayNotificationDeliveryReceipt>;
  statusSnapshot(): FuryGatewayNotificationStatusSnapshot;
  notificationCount(): number;
  routePlanCount(): number;
}

export type FuryGatewayNotificationErrorCode =
  | 'invalid-config'
  | 'invalid-input'
  | 'duplicate-policy'
  | 'policy-not-found'
  | 'policy-denied'
  | 'invalid-notification'
  | 'invalid-route'
  | 'invalid-permit'
  | 'delivery-already-prepared'
  | 'limit-exceeded';

export class FuryGatewayNotificationError extends Error {
  readonly code: FuryGatewayNotificationErrorCode;

  constructor(code: FuryGatewayNotificationErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewayNotificationError';
    this.code = code;
  }
}

export class FuryGatewayNotificationDeliveryOutcomeUnknownError extends Error {
  readonly code = 'FURY_GATEWAY_NOTIFICATION_DELIVERY_OUTCOME_UNKNOWN';
  readonly retrySafe = false;
  readonly receipt: FuryGatewayNotificationDeliveryReceipt;

  constructor(receipt: FuryGatewayNotificationDeliveryReceipt) {
    super(
      'notification delivery transport outcome is unknown; notification delivery must not be retried automatically',
    );
    this.name = 'FuryGatewayNotificationDeliveryOutcomeUnknownError';
    this.receipt = receipt;
  }
}

interface StoredPolicy {
  readonly inspection: FuryGatewayNotificationDestinationPolicyInspection;
  readonly destinationId: string;
  readonly threadId?: string;
}

interface NotificationState {
  readonly notification: FuryGatewayNotification;
}

interface RouteState {
  readonly route: FuryGatewayNotificationRoutePlan;
  readonly notification: FuryGatewayNotification;
  readonly policy: StoredPolicy;
  readonly renderedText: string;
  permit?: FuryGatewayChannelDeliveryPermit;
  receipt?: FuryGatewayNotificationDeliveryReceipt;
}

const NOTIFICATION_EVIDENCE = new WeakSet<object>();
const ROUTE_EVIDENCE = new WeakSet<object>();
const COORDINATOR_EVIDENCE = new WeakSet<object>();
const SEVERITY_SET = new Set<string>(FURY_GATEWAY_NOTIFICATION_SEVERITIES);

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/u;
const ADAPTER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const NOTIFICATION_ID_RE = /^[A-Za-z0-9_-]{32}$/u;
const DEFAULT_DELIVERY_PERMIT_TTL_MS = 30_000;
const MIN_DELIVERY_PERMIT_TTL_MS = 1_000;
const MAX_DELIVERY_PERMIT_TTL_MS = 60_000;
const DEFAULT_MAX_POLICIES = 128;
const HARD_MAX_POLICIES = 4_096;
const DEFAULT_MAX_NOTIFICATIONS = 20_000;
const HARD_MAX_NOTIFICATIONS = 200_000;
const DEFAULT_MAX_ROUTE_PLANS = 20_000;
const HARD_MAX_ROUTE_PLANS = 200_000;
const MAX_OPAQUE_ID_BYTES = 512;
const MAX_TITLE_BYTES = 256;
const MAX_SUMMARY_BYTES = 4 * 1024;
const MAX_KINDS = 64;
const MAX_POLICY_ARRAY_ITEMS = 64;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function exactPlainRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  label: string,
  code: FuryGatewayNotificationErrorCode = 'invalid-input',
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new FuryGatewayNotificationError(code, label + ' must be a plain data object');
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || !allowed.has(key)
    ) {
      throw new FuryGatewayNotificationError(
        code,
        label + ' contains unsupported or unsafe fields',
      );
    }
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new FuryGatewayNotificationError(
        code,
        label + ' is missing required field: ' + key,
      );
    }
  }
  return record;
}

function dataArrayValues(
  value: unknown,
  label: string,
  maxItems: number,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    throw new FuryGatewayNotificationError(
      'invalid-input',
      label + ' must contain 1-' + maxItems + ' entries',
    );
  }
  if (
    Object.getPrototypeOf(value) !== Array.prototype
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new FuryGatewayNotificationError(
      'invalid-input',
      label + ' must be a plain data array',
    );
  }
  const own = Object.getOwnPropertyNames(value);
  if (own.some((name) => name !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(name))) {
    throw new FuryGatewayNotificationError(
      'invalid-input',
      label + ' contains unsupported array properties',
    );
  }
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new FuryGatewayNotificationError(
        'invalid-input',
        label + ' contains sparse, hidden, or accessor entries',
      );
    }
    output.push(descriptor.value);
  }
  return Object.freeze(output);
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new FuryGatewayNotificationError(
      'invalid-config',
      label + ' must be an integer from ' + min + ' to ' + max,
    );
  }
  return resolved;
}

function safeNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FuryGatewayNotificationError(
      'invalid-config',
      'notification clock must return a safe non-negative timestamp',
    );
  }
  return value;
}

function boundedPrintable(
  value: unknown,
  label: string,
  maxBytes: number,
): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || Buffer.byteLength(value, 'utf8') > maxBytes
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new FuryGatewayNotificationError(
      'invalid-input',
      label + ' must be bounded printable text',
    );
  }
  return value;
}

function boundedBody(
  value: unknown,
  label: string,
  maxBytes: number,
): string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || Buffer.byteLength(value, 'utf8') > maxBytes
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new FuryGatewayNotificationError(
      'invalid-input',
      label + ' must be bounded text',
    );
  }
  return value;
}

function normalizeStringSet(
  value: unknown,
  label: string,
  maxItems: number,
): readonly string[] {
  const raw = dataArrayValues(value, label, maxItems);
  const seen = new Set<string>();
  const output: string[] = [];
  for (const entry of raw) {
    const normalized = boundedPrintable(entry, label + ' item', 128);
    if (!ID_RE.test(normalized) || seen.has(normalized)) {
      throw new FuryGatewayNotificationError(
        'invalid-input',
        label + ' contains an invalid or duplicate value',
      );
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return Object.freeze([...output].sort((a, b) => a.localeCompare(b)));
}

function normalizeSeverities(value: unknown): readonly FuryGatewayNotificationSeverity[] {
  const raw = dataArrayValues(
    value,
    'notification policy severities',
    FURY_GATEWAY_NOTIFICATION_SEVERITIES.length,
  );
  const seen = new Set<string>();
  const output: FuryGatewayNotificationSeverity[] = [];
  for (const entry of raw) {
    if (
      typeof entry !== 'string'
      || !SEVERITY_SET.has(entry)
      || seen.has(entry)
    ) {
      throw new FuryGatewayNotificationError(
        'invalid-input',
        'notification policy severities contain an unknown or duplicate value',
      );
    }
    seen.add(entry);
    output.push(entry as FuryGatewayNotificationSeverity);
  }
  return Object.freeze([...output].sort((a, b) => a.localeCompare(b)));
}

function clonePolicy(
  policy: FuryGatewayNotificationDestinationPolicyInspection,
): FuryGatewayNotificationDestinationPolicyInspection {
  return Object.freeze({
    ...policy,
    allowedKinds: Object.freeze([...policy.allowedKinds]),
    allowedSeverities: Object.freeze([...policy.allowedSeverities]),
  });
}

function cloneDeliveryReceipt(
  receipt: FuryGatewayNotificationDeliveryReceipt,
): FuryGatewayNotificationDeliveryReceipt {
  return Object.freeze({
    ...receipt,
    delivery: Object.freeze({ ...receipt.delivery }),
  });
}

function notificationReceipt(
  route: FuryGatewayNotificationRoutePlan,
  notification: FuryGatewayNotification,
  delivery: FuryGatewayChannelDeliveryReceipt,
): FuryGatewayNotificationDeliveryReceipt {
  return Object.freeze({
    format: FURY_GATEWAY_NOTIFICATION_DELIVERY_RECEIPT_FORMAT,
    notificationId: notification.notificationId,
    routePlanId: route.routePlanId,
    policyKey: route.policyKey,
    delivery: Object.freeze({ ...delivery }),
    acknowledgement: notification.acknowledgementRequired
      ? 'pending' as const
      : 'not-required' as const,
    underlyingTaskStatus: 'not-inferred' as const,
    authority: 'notification-delivery-evidence-only' as const,
    executionAuthority: false as const,
  });
}

export function isGeneratedFuryGatewayNotification(
  value: unknown,
): value is FuryGatewayNotification {
  return typeof value === 'object'
    && value !== null
    && NOTIFICATION_EVIDENCE.has(value);
}

export function isGeneratedFuryGatewayNotificationRoutePlan(
  value: unknown,
): value is FuryGatewayNotificationRoutePlan {
  return typeof value === 'object'
    && value !== null
    && ROUTE_EVIDENCE.has(value);
}

export function isGeneratedFuryGatewayNotificationCoordinator(
  value: unknown,
): value is FuryGatewayNotificationCoordinator {
  return typeof value === 'object'
    && value !== null
    && COORDINATOR_EVIDENCE.has(value);
}

export function createFuryGatewayNotificationCoordinator(
  options: FuryGatewayNotificationCoordinatorOptions,
): FuryGatewayNotificationCoordinator {
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || !isGeneratedFuryGatewayChannelDeliveryCoordinator(options.deliveryCoordinator)
  ) {
    throw new FuryGatewayNotificationError(
      'invalid-config',
      'notification coordinator requires a process-local channel delivery coordinator',
    );
  }
  const deliveryCoordinator = options.deliveryCoordinator;
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new FuryGatewayNotificationError(
      'invalid-config',
      'notification now must be a function',
    );
  }
  safeNow(now);

  const deliveryPermitTtlMs = boundedInteger(
    options.deliveryPermitTtlMs,
    DEFAULT_DELIVERY_PERMIT_TTL_MS,
    MIN_DELIVERY_PERMIT_TTL_MS,
    MAX_DELIVERY_PERMIT_TTL_MS,
    'deliveryPermitTtlMs',
  );
  const maxPolicies = boundedInteger(
    options.maxPolicies,
    DEFAULT_MAX_POLICIES,
    1,
    HARD_MAX_POLICIES,
    'maxPolicies',
  );
  const maxNotifications = boundedInteger(
    options.maxNotifications,
    DEFAULT_MAX_NOTIFICATIONS,
    1,
    HARD_MAX_NOTIFICATIONS,
    'maxNotifications',
  );
  const maxRoutePlans = boundedInteger(
    options.maxRoutePlans,
    DEFAULT_MAX_ROUTE_PLANS,
    1,
    HARD_MAX_ROUTE_PLANS,
    'maxRoutePlans',
  );

  const policies = new Map<string, StoredPolicy>();
  const notifications = new Map<string, NotificationState>();
  const routes = new Map<string, RouteState>();

  const resolveNotification = (
    notification: FuryGatewayNotification,
  ): NotificationState => {
    if (!isGeneratedFuryGatewayNotification(notification)) {
      throw new FuryGatewayNotificationError(
        'invalid-notification',
        'notification must be process-local FuryPipe evidence',
      );
    }
    const state = notifications.get(notification.notificationId);
    if (!state || state.notification !== notification) {
      throw new FuryGatewayNotificationError(
        'invalid-notification',
        'notification is not owned by this coordinator',
      );
    }
    return state;
  };

  const resolveRoute = (
    route: FuryGatewayNotificationRoutePlan,
  ): RouteState => {
    if (!isGeneratedFuryGatewayNotificationRoutePlan(route)) {
      throw new FuryGatewayNotificationError(
        'invalid-route',
        'notification route must be process-local FuryPipe evidence',
      );
    }
    const state = routes.get(route.routePlanId);
    if (!state || state.route !== route) {
      throw new FuryGatewayNotificationError(
        'invalid-route',
        'notification route is not owned by this coordinator',
      );
    }
    return state;
  };

  const api: FuryGatewayNotificationCoordinator = Object.freeze({
    registerDestinationPolicy(
      input: FuryGatewayNotificationDestinationPolicyInput,
    ): FuryGatewayNotificationDestinationPolicyInspection {
      const record = exactPlainRecord(
        input,
        [
          'format',
          'policyKey',
          'adapterId',
          'destinationId',
          'threadId',
          'allowedKinds',
          'allowedSeverities',
        ],
        [
          'format',
          'policyKey',
          'adapterId',
          'destinationId',
          'allowedKinds',
          'allowedSeverities',
        ],
        'notification destination policy',
      );
      if (record.format !== FURY_GATEWAY_NOTIFICATION_POLICY_FORMAT) {
        throw new FuryGatewayNotificationError(
          'invalid-input',
          'notification destination policy format is unsupported',
        );
      }
      const policyKey = boundedPrintable(record.policyKey, 'policyKey', 128);
      if (!ID_RE.test(policyKey)) {
        throw new FuryGatewayNotificationError(
          'invalid-input',
          'notification policy key is invalid',
        );
      }
      const adapterId = boundedPrintable(record.adapterId, 'adapterId', 128);
      if (!ADAPTER_ID_RE.test(adapterId)) {
        throw new FuryGatewayNotificationError(
          'invalid-input',
          'notification policy adapter ID is invalid',
        );
      }
      const destinationId = boundedPrintable(
        record.destinationId,
        'destinationId',
        MAX_OPAQUE_ID_BYTES,
      );
      const threadId = record.threadId === undefined
        ? undefined
        : boundedPrintable(record.threadId, 'threadId', MAX_OPAQUE_ID_BYTES);
      const allowedKinds = normalizeStringSet(
        record.allowedKinds,
        'notification policy kinds',
        Math.min(MAX_KINDS, MAX_POLICY_ARRAY_ITEMS),
      );
      const allowedSeverities = normalizeSeverities(record.allowedSeverities);

      if (policies.has(policyKey)) {
        throw new FuryGatewayNotificationError(
          'duplicate-policy',
          'notification destination policy already exists',
        );
      }
      if (policies.size >= maxPolicies) {
        throw new FuryGatewayNotificationError(
          'limit-exceeded',
          'notification destination policy registry is full',
        );
      }

      const inspection = Object.freeze({
        format: FURY_GATEWAY_NOTIFICATION_POLICY_FORMAT,
        policyKey,
        adapterId,
        destinationDigestSha256: sha256(destinationId),
        ...(threadId === undefined ? {} : { threadDigestSha256: sha256(threadId) }),
        allowedKinds,
        allowedSeverities,
        authority: 'notification-routing-policy-only' as const,
        executionAuthority: false as const,
      });
      policies.set(policyKey, Object.freeze({
        inspection,
        destinationId,
        ...(threadId === undefined ? {} : { threadId }),
      }));
      return clonePolicy(inspection);
    },

    inspectDestinationPolicy(
      policyKey: string,
    ): FuryGatewayNotificationDestinationPolicyInspection | undefined {
      if (typeof policyKey !== 'string' || !ID_RE.test(policyKey)) {
        throw new FuryGatewayNotificationError(
          'invalid-input',
          'notification policy key is invalid',
        );
      }
      const policy = policies.get(policyKey);
      return policy ? clonePolicy(policy.inspection) : undefined;
    },

    createNotification(input: FuryGatewayNotificationInput): FuryGatewayNotification {
      const createdAt = safeNow(now);
      const record = exactPlainRecord(
        input,
        [
          'kind',
          'severity',
          'title',
          'summary',
          'sourceEvidenceId',
          'destinationPolicyKey',
          'acknowledgementRequired',
        ],
        [
          'kind',
          'severity',
          'title',
          'summary',
          'sourceEvidenceId',
          'destinationPolicyKey',
          'acknowledgementRequired',
        ],
        'notification input',
      );
      if (notifications.size >= maxNotifications) {
        throw new FuryGatewayNotificationError(
          'limit-exceeded',
          'notification registry is full',
        );
      }
      const kind = boundedPrintable(record.kind, 'notification kind', 128);
      if (!ID_RE.test(kind)) {
        throw new FuryGatewayNotificationError(
          'invalid-input',
          'notification kind is invalid',
        );
      }
      if (
        typeof record.severity !== 'string'
        || !SEVERITY_SET.has(record.severity)
      ) {
        throw new FuryGatewayNotificationError(
          'invalid-input',
          'notification severity is unsupported',
        );
      }
      const title = boundedBody(record.title, 'notification title', MAX_TITLE_BYTES);
      const summary = boundedBody(
        record.summary,
        'notification summary',
        MAX_SUMMARY_BYTES,
      );
      const sourceEvidenceId = boundedPrintable(
        record.sourceEvidenceId,
        'sourceEvidenceId',
        MAX_OPAQUE_ID_BYTES,
      );
      const destinationPolicyKey = boundedPrintable(
        record.destinationPolicyKey,
        'destinationPolicyKey',
        128,
      );
      if (!ID_RE.test(destinationPolicyKey)) {
        throw new FuryGatewayNotificationError(
          'invalid-input',
          'notification destination policy key is invalid',
        );
      }
      if (typeof record.acknowledgementRequired !== 'boolean') {
        throw new FuryGatewayNotificationError(
          'invalid-input',
          'notification acknowledgementRequired must be boolean',
        );
      }

      let notificationId: string;
      do {
        notificationId = randomBytes(24).toString('base64url');
      } while (notifications.has(notificationId));
      if (!NOTIFICATION_ID_RE.test(notificationId)) {
        throw new FuryGatewayNotificationError(
          'invalid-notification',
          'generated notification ID is invalid',
        );
      }

      const notification = Object.freeze({
        format: FURY_GATEWAY_NOTIFICATION_FORMAT,
        notificationId,
        kind,
        severity: record.severity as FuryGatewayNotificationSeverity,
        title,
        summary,
        sourceEvidenceDigestSha256: sha256(sourceEvidenceId),
        destinationPolicyKey,
        acknowledgementRequired: record.acknowledgementRequired,
        createdAt,
        authority: 'notification-data-only' as const,
        executionAuthority: false as const,
      });
      NOTIFICATION_EVIDENCE.add(notification);
      notifications.set(notificationId, { notification });
      return notification;
    },

    selectDestination(
      notification: FuryGatewayNotification,
    ): FuryGatewayNotificationRoutePlan {
      resolveNotification(notification);
      const selectedAt = safeNow(now);
      if (routes.size >= maxRoutePlans) {
        throw new FuryGatewayNotificationError(
          'limit-exceeded',
          'notification route registry is full',
        );
      }
      const policy = policies.get(notification.destinationPolicyKey);
      if (!policy) {
        throw new FuryGatewayNotificationError(
          'policy-not-found',
          'notification destination policy is not configured',
        );
      }
      if (
        !policy.inspection.allowedKinds.includes(notification.kind)
        || !policy.inspection.allowedSeverities.includes(notification.severity)
      ) {
        throw new FuryGatewayNotificationError(
          'policy-denied',
          'notification is not eligible for the configured destination policy',
        );
      }
      const renderedText = notification.title + '\n\n' + notification.summary;
      // Must match the channel-delivery payload canonicalization for a message
      // without replyToEventId.
      const renderedPayloadSha256 = sha256(JSON.stringify([
        renderedText,
        null,
      ]));

      let routePlanId: string;
      do {
        routePlanId = randomBytes(24).toString('base64url');
      } while (routes.has(routePlanId));

      const route = Object.freeze({
        format: FURY_GATEWAY_NOTIFICATION_ROUTE_FORMAT,
        routePlanId,
        notificationId: notification.notificationId,
        policyKey: policy.inspection.policyKey,
        adapterId: policy.inspection.adapterId,
        destinationDigestSha256: policy.inspection.destinationDigestSha256,
        ...(policy.inspection.threadDigestSha256 === undefined
          ? {}
          : { threadDigestSha256: policy.inspection.threadDigestSha256 }),
        renderedPayloadSha256,
        selectedAt,
        authority: 'notification-routing-data-only' as const,
        executionAuthority: false as const,
      });
      ROUTE_EVIDENCE.add(route);
      routes.set(routePlanId, {
        route,
        notification,
        policy,
        renderedText,
      });
      return route;
    },

    prepareDelivery(
      route: FuryGatewayNotificationRoutePlan,
    ): FuryGatewayChannelDeliveryPermit {
      const state = resolveRoute(route);
      if (state.permit !== undefined) {
        throw new FuryGatewayNotificationError(
          'delivery-already-prepared',
          'notification route already has a delivery permit',
        );
      }
      const permit = deliveryCoordinator.prepareDelivery({
        adapterId: route.adapterId,
        destinationId: state.policy.destinationId,
        ...(state.policy.threadId === undefined
          ? {}
          : { threadId: state.policy.threadId }),
        text: state.renderedText,
        idempotencyKey: 'notification:' + route.notificationId + ':' + route.routePlanId,
        expiresInMs: deliveryPermitTtlMs,
      });
      if (
        permit.adapterId !== route.adapterId
        || permit.destinationDigestSha256 !== route.destinationDigestSha256
        || permit.threadDigestSha256 !== route.threadDigestSha256
        || permit.payloadSha256 !== route.renderedPayloadSha256
      ) {
        throw new FuryGatewayNotificationError(
          'invalid-permit',
          'channel delivery permit does not match the selected notification route',
        );
      }
      state.permit = permit;
      return permit;
    },

    async executeDelivery(
      route: FuryGatewayNotificationRoutePlan,
      permit: FuryGatewayChannelDeliveryPermit,
    ): Promise<FuryGatewayNotificationDeliveryReceipt> {
      const state = resolveRoute(route);
      if (
        !state.permit
        || state.permit !== permit
        || !isGeneratedFuryGatewayChannelDeliveryPermit(permit)
      ) {
        throw new FuryGatewayNotificationError(
          'invalid-permit',
          'notification delivery requires the exact prepared process-local channel permit',
        );
      }
      if (state.receipt !== undefined) {
        throw new FuryGatewayNotificationError(
          'invalid-permit',
          'notification route delivery was already settled',
        );
      }

      try {
        const delivery = await deliveryCoordinator.executeDelivery(permit);
        const receipt = notificationReceipt(
          route,
          state.notification,
          delivery,
        );
        state.receipt = receipt;
        return cloneDeliveryReceipt(receipt);
      } catch (error) {
        if (error instanceof FuryGatewayChannelDeliveryOutcomeUnknownError) {
          const receipt = notificationReceipt(
            route,
            state.notification,
            error.receipt,
          );
          state.receipt = receipt;
          throw new FuryGatewayNotificationDeliveryOutcomeUnknownError(
            cloneDeliveryReceipt(receipt),
          );
        }
        throw error;
      }
    },

    statusSnapshot(): FuryGatewayNotificationStatusSnapshot {
      const observedAt = safeNow(now);
      const deliveryStatuses = {
        prepared: 0,
        expired: 0,
        'in-flight': 0,
        'accepted-for-delivery': 0,
        delivered: 0,
        'provider-rejected': 0,
        'outcome-unknown': 0,
      };
      let deliveryPermitsPrepared = 0;
      let deliveriesSettled = 0;
      let acknowledgementsPending = 0;

      for (const state of routes.values()) {
        if (state.permit !== undefined) {
          deliveryPermitsPrepared += 1;
          const inspection = deliveryCoordinator.inspectDelivery(state.permit);
          deliveryStatuses[inspection.status] += 1;
        }
        if (state.receipt !== undefined) {
          deliveriesSettled += 1;
          if (state.receipt.acknowledgement === 'pending') {
            acknowledgementsPending += 1;
          }
        }
      }

      return Object.freeze({
        observedAt,
        notificationsCreated: notifications.size,
        routesSelected: routes.size,
        deliveryPermitsPrepared,
        deliveriesSettled,
        acknowledgementsPending,
        deliveryStatuses: Object.freeze({ ...deliveryStatuses }),
        underlyingTaskStatus: 'not-inferred' as const,
        authority: 'observability-only' as const,
        executionAuthority: false as const,
      });
    },

    notificationCount(): number {
      return notifications.size;
    },

    routePlanCount(): number {
      return routes.size;
    },
  });

  COORDINATOR_EVIDENCE.add(api);
  return api;
}
