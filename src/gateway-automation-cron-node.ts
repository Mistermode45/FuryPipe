export const FURY_GATEWAY_CRON_FORMAT =
  'furypipe-gateway-cron/v1' as const;

export interface FuryGatewayCronSchedule {
  readonly format: typeof FURY_GATEWAY_CRON_FORMAT;
  readonly expression: string;
  readonly timeZone: string;
}

export interface FuryGatewayCronSearchBounds {
  readonly expression: string;
  readonly timeZone: string;
  readonly lowerBound: number;
  readonly upperBound?: number;
}

export type FuryGatewayAutomationCronErrorCode =
  | 'invalid-expression'
  | 'invalid-time-zone'
  | 'invalid-search-bounds';

const ERROR_MESSAGES: Readonly<Record<
  FuryGatewayAutomationCronErrorCode,
  string
>> = Object.freeze({
  'invalid-expression': 'Cron expression is invalid or unsupported.',
  'invalid-time-zone': 'Cron time zone is not a supported IANA time zone.',
  'invalid-search-bounds': 'Cron search bounds are invalid.',
});

export class FuryGatewayAutomationCronError extends Error {
  readonly retrySafe = false;

  constructor(readonly code: FuryGatewayAutomationCronErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'FuryGatewayAutomationCronError';
  }
}

interface ParsedField {
  readonly values: readonly number[];
  readonly allowed: ReadonlySet<number>;
  readonly unrestricted: boolean;
}

interface ParsedCron {
  readonly expression: string;
  readonly minute: ParsedField;
  readonly hour: ParsedField;
  readonly dayOfMonth: ParsedField;
  readonly month: ParsedField;
  readonly dayOfWeek: ParsedField;
}

interface LocalMinute {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MAX_DATE_MS = 8_640_000_000_000_000;
const MAX_EXPRESSION_BYTES = 512;
const MAX_TIME_ZONE_BYTES = 128;
const MAX_SEARCH_DAYS = 8 * 366 + 2;
const FIELD_TOKEN_RE = /^[0-9*,\/-]+$/u;
const INTEGER_RE = /^(?:0|[1-9][0-9]*)$/u;

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function safeTimestamp(value: unknown): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < 0
    || (value as number) > MAX_DATE_MS
  ) {
    throw new FuryGatewayAutomationCronError('invalid-search-bounds');
  }
  return value as number;
}

function integerToken(
  value: string,
  min: number,
  max: number,
): number {
  if (!INTEGER_RE.test(value)) {
    throw new FuryGatewayAutomationCronError('invalid-expression');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new FuryGatewayAutomationCronError('invalid-expression');
  }
  return parsed;
}

function field(
  token: string,
  min: number,
  max: number,
  options: { readonly dayOfWeek?: boolean } = {},
): ParsedField {
  if (
    token.length < 1
    || token.length > 128
    || !FIELD_TOKEN_RE.test(token)
  ) {
    throw new FuryGatewayAutomationCronError('invalid-expression');
  }

  const selected = new Set<number>();
  const segments = token.split(',');
  if (segments.some((segment) => segment.length === 0)) {
    throw new FuryGatewayAutomationCronError('invalid-expression');
  }

  const rawMax = options.dayOfWeek ? 7 : max;

  const add = (raw: number): void => {
    const normalized = options.dayOfWeek && raw === 7 ? 0 : raw;
    if (normalized < min || normalized > max) {
      throw new FuryGatewayAutomationCronError('invalid-expression');
    }
    selected.add(normalized);
  };

  for (const segment of segments) {
    const slashParts = segment.split('/');
    if (slashParts.length > 2 || slashParts.some((part) => part.length === 0)) {
      throw new FuryGatewayAutomationCronError('invalid-expression');
    }
    const base = slashParts[0]!;
    const step = slashParts.length === 2
      ? integerToken(slashParts[1]!, 1, rawMax - min + 1)
      : 1;

    let start: number;
    let end: number;
    if (base === '*') {
      start = min;
      end = rawMax;
    } else if (base.includes('-')) {
      const range = base.split('-');
      if (
        range.length !== 2
        || range[0]!.length === 0
        || range[1]!.length === 0
      ) {
        throw new FuryGatewayAutomationCronError('invalid-expression');
      }
      start = integerToken(range[0]!, min, rawMax);
      end = integerToken(range[1]!, min, rawMax);
      if (start > end) {
        throw new FuryGatewayAutomationCronError('invalid-expression');
      }
    } else {
      if (slashParts.length !== 1) {
        throw new FuryGatewayAutomationCronError('invalid-expression');
      }
      start = integerToken(base, min, rawMax);
      end = start;
    }

    for (let current = start; current <= end; current += step) {
      add(current);
    }
  }

  if (selected.size === 0) {
    throw new FuryGatewayAutomationCronError('invalid-expression');
  }

  const values = Object.freeze(
    [...selected].sort((left, right) => left - right),
  );
  return Object.freeze({
    values,
    allowed: new Set(values),
    unrestricted: token === '*',
  });
}

function parseExpression(value: unknown): ParsedCron {
  const expression = normalizeFuryGatewayCronExpression(value);
  const parts = expression.split(' ');
  return Object.freeze({
    expression,
    minute: field(parts[0]!, 0, 59),
    hour: field(parts[1]!, 0, 23),
    dayOfMonth: field(parts[2]!, 1, 31),
    month: field(parts[3]!, 1, 12),
    dayOfWeek: field(parts[4]!, 0, 6, { dayOfWeek: true }),
  });
}

export function normalizeFuryGatewayCronExpression(
  value: unknown,
): string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value.trim() !== value
    || Buffer.byteLength(value, 'utf8') > MAX_EXPRESSION_BYTES
    || /[\u0000-\u001f\u007f]/u.test(value.replace(/[ \t]/gu, ''))
  ) {
    throw new FuryGatewayAutomationCronError('invalid-expression');
  }
  const parts = value.split(/\s+/u);
  if (parts.length !== 5) {
    throw new FuryGatewayAutomationCronError('invalid-expression');
  }
  for (const part of parts) {
    if (!FIELD_TOKEN_RE.test(part)) {
      throw new FuryGatewayAutomationCronError('invalid-expression');
    }
  }
  const normalized = parts.join(' ');
  if (normalized.length === 0) {
    throw new FuryGatewayAutomationCronError('invalid-expression');
  }
  // Parse all fields once so normalization is also full syntax validation.
  field(parts[0]!, 0, 59);
  field(parts[1]!, 0, 23);
  field(parts[2]!, 1, 31);
  field(parts[3]!, 1, 12);
  field(parts[4]!, 0, 6, { dayOfWeek: true });
  return normalized;
}

export function normalizeFuryGatewayCronTimeZone(
  value: unknown,
): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.trim() !== value
    || Buffer.byteLength(value, 'utf8') > MAX_TIME_ZONE_BYTES
    || /[\u0000-\u0020\u007f]/u.test(value)
  ) {
    throw new FuryGatewayAutomationCronError('invalid-time-zone');
  }
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat('en-US', {
      timeZone: value,
    }).resolvedOptions().timeZone;
  } catch {
    throw new FuryGatewayAutomationCronError('invalid-time-zone');
  }
  if (
    typeof resolved !== 'string'
    || resolved.length < 1
    || Buffer.byteLength(resolved, 'utf8') > MAX_TIME_ZONE_BYTES
  ) {
    throw new FuryGatewayAutomationCronError('invalid-time-zone');
  }
  return resolved;
}

export function normalizeFuryGatewayCronSchedule(
  expression: unknown,
  timeZone: unknown,
): FuryGatewayCronSchedule {
  return Object.freeze({
    format: FURY_GATEWAY_CRON_FORMAT,
    expression: normalizeFuryGatewayCronExpression(expression),
    timeZone: normalizeFuryGatewayCronTimeZone(timeZone),
  });
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  const existing = FORMATTERS.get(timeZone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  FORMATTERS.set(timeZone, created);
  return created;
}

function localMinute(
  instant: number,
  timeZone: string,
): LocalMinute {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) {
    throw new FuryGatewayAutomationCronError('invalid-search-bounds');
  }
  const found: Partial<Record<
    'year' | 'month' | 'day' | 'hour' | 'minute',
    number
  >> = {};
  for (const part of formatter(timeZone).formatToParts(date)) {
    if (
      part.type === 'year'
      || part.type === 'month'
      || part.type === 'day'
      || part.type === 'hour'
      || part.type === 'minute'
    ) {
      const numeric = Number(part.value);
      if (!Number.isInteger(numeric)) {
        throw new FuryGatewayAutomationCronError('invalid-search-bounds');
      }
      found[part.type] = numeric;
    }
  }
  if (
    found.year === undefined
    || found.month === undefined
    || found.day === undefined
    || found.hour === undefined
    || found.minute === undefined
    || found.month < 1
    || found.month > 12
    || found.day < 1
    || found.day > 31
    || found.hour < 0
    || found.hour > 23
    || found.minute < 0
    || found.minute > 59
  ) {
    throw new FuryGatewayAutomationCronError('invalid-search-bounds');
  }
  return Object.freeze({
    year: found.year,
    month: found.month,
    day: found.day,
    hour: found.hour,
    minute: found.minute,
  });
}

function sameLocalMinute(
  left: LocalMinute,
  right: LocalMinute,
): boolean {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute;
}

function localAsUtc(parts: LocalMinute): number {
  const value = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0,
    0,
  );
  if (!Number.isFinite(value)) {
    throw new FuryGatewayAutomationCronError('invalid-search-bounds');
  }
  return value;
}

function possibleUtcInstants(
  target: LocalMinute,
  timeZone: string,
): readonly number[] {
  const naive = localAsUtc(target);
  const offsets = new Set<number>();
  for (const probe of [
    naive - 36 * HOUR_MS,
    naive - 12 * HOUR_MS,
    naive,
    naive + 12 * HOUR_MS,
    naive + 36 * HOUR_MS,
  ]) {
    if (probe < 0 || probe > MAX_DATE_MS) continue;
    const projected = localMinute(probe, timeZone);
    const offset = localAsUtc(projected)
      - Math.floor(probe / MINUTE_MS) * MINUTE_MS;
    if (Number.isSafeInteger(offset)) offsets.add(offset);
  }

  const matches = new Set<number>();
  for (const offset of offsets) {
    const candidate = naive - offset;
    if (
      candidate < 0
      || candidate > MAX_DATE_MS
      || candidate % MINUTE_MS !== 0
    ) {
      continue;
    }
    if (sameLocalMinute(localMinute(candidate, timeZone), target)) {
      matches.add(candidate);
    }
  }
  return Object.freeze([...matches].sort((left, right) => left - right));
}

function dateFromLocal(parts: LocalMinute): CalendarDate {
  return Object.freeze({
    year: parts.year,
    month: parts.month,
    day: parts.day,
  });
}

function shiftDate(
  date: CalendarDate,
  days: number,
): CalendarDate {
  const shifted = new Date(Date.UTC(
    date.year,
    date.month - 1,
    date.day + days,
    12,
    0,
    0,
    0,
  ));
  if (!Number.isFinite(shifted.getTime())) {
    throw new FuryGatewayAutomationCronError('invalid-search-bounds');
  }
  return Object.freeze({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

function dayOfWeek(date: CalendarDate): number {
  const instant = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    12,
    0,
    0,
    0,
  );
  const value = new Date(instant).getUTCDay();
  if (!Number.isInteger(value)) {
    throw new FuryGatewayAutomationCronError('invalid-search-bounds');
  }
  return value;
}

function dateMatches(
  parsed: ParsedCron,
  date: CalendarDate,
): boolean {
  if (!parsed.month.allowed.has(date.month)) return false;

  const domMatches = parsed.dayOfMonth.allowed.has(date.day);
  const dowMatches = parsed.dayOfWeek.allowed.has(dayOfWeek(date));

  if (parsed.dayOfMonth.unrestricted && parsed.dayOfWeek.unrestricted) {
    return true;
  }
  if (parsed.dayOfMonth.unrestricted) return dowMatches;
  if (parsed.dayOfWeek.unrestricted) return domMatches;

  // Vixie/POSIX-style rule: when both DOM and DOW are restricted,
  // either field may match.
  return domMatches || dowMatches;
}

function target(
  date: CalendarDate,
  hour: number,
  minute: number,
): LocalMinute {
  return Object.freeze({
    year: date.year,
    month: date.month,
    day: date.day,
    hour,
    minute,
  });
}

function latestOnDate(
  parsed: ParsedCron,
  timeZone: string,
  date: CalendarDate,
  lowerBound: number,
  upperBound: number,
): number | undefined {
  if (!dateMatches(parsed, date)) return undefined;

  for (let hourIndex = parsed.hour.values.length - 1; hourIndex >= 0; hourIndex -= 1) {
    const hour = parsed.hour.values[hourIndex]!;
    for (
      let minuteIndex = parsed.minute.values.length - 1;
      minuteIndex >= 0;
      minuteIndex -= 1
    ) {
      const minute = parsed.minute.values[minuteIndex]!;
      const instants = possibleUtcInstants(
        target(date, hour, minute),
        timeZone,
      );
      for (let index = instants.length - 1; index >= 0; index -= 1) {
        const instant = instants[index]!;
        if (instant >= lowerBound && instant <= upperBound) {
          return instant;
        }
      }
    }
  }
  return undefined;
}

function earliestOnDate(
  parsed: ParsedCron,
  timeZone: string,
  date: CalendarDate,
  lowerBound: number,
  afterExclusive: number,
  upperBound: number | undefined,
): number | undefined {
  if (!dateMatches(parsed, date)) return undefined;

  for (const hour of parsed.hour.values) {
    for (const minute of parsed.minute.values) {
      const instants = possibleUtcInstants(
        target(date, hour, minute),
        timeZone,
      );
      for (const instant of instants) {
        if (
          instant >= lowerBound
          && instant > afterExclusive
          && (upperBound === undefined || instant <= upperBound)
        ) {
          return instant;
        }
      }
    }
  }
  return undefined;
}

export function findFuryGatewayCronOccurrenceAtOrBefore(
  input: FuryGatewayCronSearchBounds & {
    readonly upperBound: number;
  },
): number | undefined {
  const schedule = normalizeFuryGatewayCronSchedule(
    input.expression,
    input.timeZone,
  );
  const parsed = parseExpression(schedule.expression);
  const lowerBound = safeTimestamp(input.lowerBound);
  const upperBound = safeTimestamp(input.upperBound);
  if (lowerBound > upperBound) return undefined;

  let date = dateFromLocal(localMinute(upperBound, schedule.timeZone));
  for (let searched = 0; searched < MAX_SEARCH_DAYS; searched += 1) {
    const found = latestOnDate(
      parsed,
      schedule.timeZone,
      date,
      lowerBound,
      upperBound,
    );
    if (found !== undefined) return found;

    date = shiftDate(date, -1);
    const dateEndCandidates = possibleUtcInstants(
      target(date, 23, 59),
      schedule.timeZone,
    );
    if (
      dateEndCandidates.length > 0
      && Math.max(...dateEndCandidates) < lowerBound
    ) {
      return undefined;
    }
  }
  return undefined;
}

export function findNextFuryGatewayCronOccurrence(
  input: FuryGatewayCronSearchBounds & {
    readonly afterExclusive: number;
  },
): number | undefined {
  const schedule = normalizeFuryGatewayCronSchedule(
    input.expression,
    input.timeZone,
  );
  const parsed = parseExpression(schedule.expression);
  const lowerBound = safeTimestamp(input.lowerBound);
  const afterExclusive = safeTimestamp(input.afterExclusive);
  const upperBound = input.upperBound === undefined
    ? undefined
    : safeTimestamp(input.upperBound);

  if (upperBound !== undefined && lowerBound > upperBound) return undefined;

  const anchor = Math.max(lowerBound, afterExclusive);
  let date = dateFromLocal(localMinute(anchor, schedule.timeZone));

  for (let searched = 0; searched < MAX_SEARCH_DAYS; searched += 1) {
    const found = earliestOnDate(
      parsed,
      schedule.timeZone,
      date,
      lowerBound,
      afterExclusive,
      upperBound,
    );
    if (found !== undefined) return found;

    date = shiftDate(date, 1);
    if (upperBound !== undefined) {
      const dateStartCandidates = possibleUtcInstants(
        target(date, 0, 0),
        schedule.timeZone,
      );
      if (
        dateStartCandidates.length > 0
        && Math.min(...dateStartCandidates) > upperBound
      ) {
        return undefined;
      }
    }
  }
  return undefined;
}
