import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';

export type SetupLocale = 'fr' | 'en';
export type SetupStage = 'language' | 'done';

export interface SetupRenderOptions {
  readonly selectedLocale: SetupLocale;
  readonly stage?: SetupStage;
  readonly version?: string;
  readonly width?: number;
  readonly color?: boolean;
  readonly configFile?: string;
}

export interface SetupWizardOptions {
  readonly argv?: readonly string[];
  readonly stdin?: NodeJS.ReadStream;
  readonly stdout?: NodeJS.WriteStream;
  readonly configFile?: string;
  readonly version?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
}

export interface Keypress {
  readonly name?: string;
  readonly ctrl?: boolean;
}

interface ParsedSetupArgs {
  readonly locale?: SetupLocale;
  readonly plain: boolean;
  readonly color: boolean;
  readonly yes: boolean;
  readonly help: boolean;
}

// FuryPipe terminal identity: midnight/navy surfaces, cobalt/ice accents and
// warm-cream foregrounds. Windows Terminal, modern PowerShell, macOS Terminal
// and the major Linux terminals support these true-color ANSI sequences.
const A = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[38;2;96;165;250m',
  blue: '\x1b[38;2;59;130;246m',
  purple: '\x1b[38;2;129;140;248m',
  green: '\x1b[38;2;52;211;153m',
  yellow: '\x1b[38;2;250;204;21m',
  muted: '\x1b[38;2;148;163;184m',
  white: '\x1b[38;2;248;245;237m',
  bgBlue: '\x1b[48;2;23;37;84m',
} as const;

const LOGO = [
  '███████╗██╗   ██╗██████╗ ██╗   ██╗██████╗ ██╗██████╗ ███████╗',
  '██╔════╝██║   ██║██╔══██╗╚██╗ ██╔╝██╔══██╗██║██╔══██╗██╔════╝',
  '█████╗  ██║   ██║██████╔╝ ╚████╔╝ ██████╔╝██║██████╔╝█████╗  ',
  '██╔══╝  ██║   ██║██╔══██╗  ╚██╔╝  ██╔═══╝ ██║██╔═══╝ ██╔══╝  ',
  '██║     ╚██████╔╝██║  ██║   ██║   ██║     ██║██║     ███████╗',
  '╚═╝      ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚═╝     ╚══════╝',
] as const;

const MIN_WIDTH = 78;
const MAX_WIDTH = 118;

function paint(enabled: boolean, code: string, text: string): string {
  return enabled ? code + text + A.reset : text;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

function pad(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - visibleLength(value)));
}

function fit(value: string, width: number): string {
  const plain = stripAnsi(value);
  if (plain.length <= width) return value;
  if (width <= 1) return '…'.slice(0, width);
  return plain.slice(0, width - 1) + '…';
}

function border(width: number, left = '┌', right = '┐'): string {
  return left + '─'.repeat(Math.max(0, width - 2)) + right;
}

function box(lines: readonly string[], width: number, color: boolean, title?: string): string[] {
  const inner = Math.max(1, width - 4);
  let top = border(width);
  if (title) {
    const label = ' ' + title + ' ';
    const rest = Math.max(0, width - label.length - 3);
    top = '┌─' + paint(color, A.blue + A.bold, label) + '─'.repeat(rest) + '┐';
  }
  return [
    paint(color, A.blue, top),
    ...lines.map((line) => paint(color, A.blue, '│ ') + pad(fit(line, inner), inner) + paint(color, A.blue, ' │')),
    paint(color, A.blue, border(width, '└', '┘')),
  ];
}

function columns(left: readonly string[], right: readonly string[], leftWidth: number): string[] {
  const rows = Math.max(left.length, right.length);
  const out: string[] = [];
  for (let i = 0; i < rows; i += 1) {
    out.push(pad(left[i] ?? '', leftWidth) + '  ' + (right[i] ?? ''));
  }
  return out;
}

function stepLines(
  n: number,
  label: string,
  description: string,
  state: 'active' | 'pending' | 'done',
  color: boolean,
): string[] {
  const marker = state === 'done' ? '✓' : String(n);
  const markerColor = state === 'active' ? A.cyan : state === 'done' ? A.green : A.muted;
  const titleColor = state === 'active' ? A.white + A.bold : state === 'done' ? A.white : A.muted;
  return [
    paint(color, markerColor, '[' + marker + ']') + ' ' + paint(color, titleColor, label),
    '    ' + paint(color, A.muted, description),
  ];
}

function languageCard(locale: SetupLocale, selected: SetupLocale, color: boolean): string[] {
  const active = locale === selected;
  const tag = locale === 'fr' ? 'FR' : 'EN';
  const name = locale === 'fr' ? 'Français' : 'English';
  const detail = locale === 'fr' ? 'Interface et onboarding en français' : 'Interface and onboarding in English';
  const pointer = active ? paint(color, A.cyan + A.bold, '▶') : ' ';
  const badge = active
    ? paint(color, A.bgBlue + A.white + A.bold, ' ' + tag + ' ')
    : paint(color, A.muted, '[' + tag + ']');
  return [
    pointer + ' ' + badge + '  ' + paint(color, active ? A.white + A.bold : A.muted, name),
    '       ' + paint(color, A.muted, detail),
  ];
}

export function defaultSetupConfigFile(): string {
  return path.join(os.homedir(), '.config', 'furypipe', 'config.json');
}

export function detectSetupLocale(env: NodeJS.ProcessEnv = process.env): SetupLocale {
  const raw = [
    env.LC_ALL,
    env.LC_MESSAGES,
    env.LANGUAGE?.split(':')[0],
    env.LANG,
    Intl.DateTimeFormat().resolvedOptions().locale,
  ].find((value) => typeof value === 'string' && value.trim().length > 0);
  return raw?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function readConfiguredSetupLocale(file: string): SetupLocale | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const locale = (parsed as Record<string, unknown>).locale;
    return locale === 'fr' || locale === 'en' ? locale : undefined;
  } catch {
    return undefined;
  }
}

export function parseSetupArgs(argv: readonly string[]): ParsedSetupArgs {
  let locale: SetupLocale | undefined;
  let plain = false;
  let color = true;
  let yes = false;
  let help = false;

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') { help = true; continue; }
    if (arg === '--plain') { plain = true; continue; }
    if (arg === '--no-color') { color = false; continue; }
    if (arg === '-y' || arg === '--yes') { yes = true; continue; }
    if (arg.startsWith('--lang=')) {
      const value = arg.slice('--lang='.length).toLowerCase();
      if (value !== 'fr' && value !== 'en') throw new Error('unsupported setup language: ' + value);
      locale = value;
      continue;
    }
    throw new Error('unknown setup option: ' + arg);
  }

  return { locale, plain, color, yes, help };
}

export function renderSetupScreen(options: SetupRenderOptions): string {
  const color = options.color ?? true;
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, options.width ?? 100));
  const version = options.version ?? 'dev';
  const configFile = options.configFile ?? defaultSetupConfigFile();
  const stage = options.stage ?? 'language';
  const selected = options.selectedLocale;
  const fr = selected === 'fr';

  // FuryPipe's terminal experience is a control-plane console, not a wizard
  // sidebar. The top rail exposes the runtime domains and the progress capsule
  // stays horizontal so the visual language matches the web Control Plane.
  const title = paint(color, A.white + A.bold, 'FURYPIPE') +
    paint(color, A.cyan + A.bold, '  //  CONTROL PLANE') +
    paint(color, A.muted, '  v' + version);
  const domains = [
    paint(color, A.blue + A.bold, 'CONTEXT'),
    paint(color, A.cyan + A.bold, 'FURYLINK'),
    paint(color, A.purple + A.bold, 'VISUAL'),
    paint(color, A.blue + A.bold, 'MCP'),
    paint(color, A.cyan + A.bold, 'PROVIDERS'),
    paint(color, A.purple + A.bold, 'MEMORY'),
  ].join(paint(color, A.muted, '  ◆  '));

  const phaseLabels = fr
    ? ['LANGUE', 'RUNTIME', 'INSTALL', 'CONFIG', 'PRÊT']
    : ['LANGUAGE', 'RUNTIME', 'INSTALL', 'CONFIG', 'READY'];
  const phase = phaseLabels.map((label, index) => {
    const done = stage === 'done';
    const active = !done && index === 0;
    const marker = done ? '✓' : String(index + 1).padStart(2, '0');
    const tone = done ? A.green : active ? A.cyan + A.bold : A.muted;
    return paint(color, tone, '[' + marker + ' ' + label + ']');
  }).join(paint(color, A.muted, ' ─ '));

  const header = box([
    title,
    paint(color, A.muted, fr
      ? 'Runtime de contexte gouverné · exécution explicite · preuves vérifiables'
      : 'Governed context runtime · explicit execution · verifiable evidence'),
    '',
    domains,
    '',
    phase,
  ], width, color, 'FURYPIPE');

  let main: string[];
  if (stage === 'done') {
    const compact = configFile.startsWith(os.homedir()) ? '~' + configFile.slice(os.homedir().length) : configFile;
    main = fr
      ? [
          paint(color, A.green + A.bold, '✓ ENVIRONNEMENT PRÊT'),
          '',
          paint(color, A.white + A.bold, 'Configuration enregistrée') +
            paint(color, A.muted, '  ·  ' + fit(compact, width - 38)),
          paint(color, A.muted, 'Langue') + '  ' + paint(color, A.white + A.bold, selected === 'fr' ? 'Français' : 'English'),
          '',
          paint(color, A.cyan + A.bold, 'PROCHAINE ACTION'),
          '  ' + paint(color, A.white, 'furypipe doctor') + paint(color, A.muted, '   vérifier le runtime local'),
          '  ' + paint(color, A.white, 'furypipe start') + paint(color, A.muted, '    ouvrir le Control Plane'),
          '  ' + paint(color, A.white, 'furypipe link codex') + paint(color, A.muted, ' connecter un agent avec FuryLink'),
        ]
      : [
          paint(color, A.green + A.bold, '✓ ENVIRONMENT READY'),
          '',
          paint(color, A.white + A.bold, 'Configuration saved') +
            paint(color, A.muted, '  ·  ' + fit(compact, width - 38)),
          paint(color, A.muted, 'Language') + '  ' + paint(color, A.white + A.bold, 'English'),
          '',
          paint(color, A.cyan + A.bold, 'NEXT ACTION'),
          '  ' + paint(color, A.white, 'furypipe doctor') + paint(color, A.muted, '   inspect the local runtime'),
          '  ' + paint(color, A.white, 'furypipe start') + paint(color, A.muted, '    open the Control Plane'),
          '  ' + paint(color, A.white, 'furypipe link codex') + paint(color, A.muted, ' connect an agent with FuryLink'),
        ];
  } else {
    const frState = selected === 'fr' ? A.bgBlue + A.white + A.bold : A.muted;
    const enState = selected === 'en' ? A.bgBlue + A.white + A.bold : A.muted;
    main = [
      paint(color, A.white + A.bold, fr ? 'Choisissez votre environnement' : 'Choose your environment'),
      paint(color, A.muted, fr
        ? 'La langue s’applique au setup et aux surfaces locales FuryPipe.'
        : 'The language applies to setup and local FuryPipe surfaces.'),
      '',
      paint(color, selected === 'fr' ? A.cyan + A.bold : A.muted, selected === 'fr' ? '◆' : '◇') +
        '  ' + paint(color, frState, ' FR ') + '  ' + paint(color, selected === 'fr' ? A.white + A.bold : A.muted, 'Français') +
        paint(color, A.muted, '  ·  interface et onboarding FR'),
      '',
      paint(color, selected === 'en' ? A.cyan + A.bold : A.muted, selected === 'en' ? '◆' : '◇') +
        '  ' + paint(color, enState, ' EN ') + '  ' + paint(color, selected === 'en' ? A.white + A.bold : A.muted, 'English') +
        paint(color, A.muted, '  ·  English interface and onboarding'),
      '',
      paint(color, A.blue, '────────────────────────────────────────────────────────'),
      paint(color, A.muted, fr
        ? '↑/↓ ou ←/→ sélectionner   ·   Entrée valider   ·   Échap quitter   ·   1/2 raccourcis'
        : '↑/↓ or ←/→ select   ·   Enter confirm   ·   Esc quit   ·   1/2 shortcuts'),
    ];
  }

  const panelTitle = stage === 'done'
    ? (fr ? 'RUNTIME PRÊT' : 'RUNTIME READY')
    : (fr ? 'LANGUE / ENVIRONNEMENT' : 'LANGUAGE / ENVIRONMENT');
  const panel = box(main, width, color, panelTitle);

  const footer = stage === 'done'
    ? (fr ? 'READY  FuryPipe est configuré.' : 'READY  FuryPipe is configured.')
    : (fr ? 'SELECT  choisissez une langue pour continuer.' : 'SELECT  choose a language to continue.');

  return [
    ...header,
    '',
    ...panel,
    '',
    paint(color, A.muted, ' FuryPipe ') + paint(color, A.cyan + A.bold, footer),
  ].join('\n');
}

function setupHelp(): string {
  return [
    'FuryPipe setup — interactive first-run configuration',
    '',
    'Usage:',
    '  furypipe setup',
    '  furypipe setup --lang=fr',
    '  furypipe setup --lang=en --yes',
    '',
    'Options:',
    '  --lang=fr|en   preselect a language',
    '  -y, --yes      apply without interaction',
    '  --plain        disable the full-screen TUI',
    '  --no-color     disable ANSI colors',
    '  -h, --help     show this help',
  ].join('\n');
}

export function persistSetupLocale(
  file: string,
  locale: SetupLocale,
  version = 'dev',
  now: () => Date = () => new Date(),
): void {
  let config: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('existing FuryPipe config is not a JSON object');
    }
    config = parsed as Record<string, unknown>;
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code !== 'ENOENT') throw caught;
  }

  config.locale = locale;
  config.setup = { completed: true, completedAt: now().toISOString(), version };

  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch { /* Windows ACLs are host-managed. */ }
  } catch (caught) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw caught;
  }
}

function canUseRichTui(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream, env: NodeJS.ProcessEnv): boolean {
  if (!stdin.isTTY || !stdout.isTTY) return false;
  if ((stdout.columns ?? 0) < MIN_WIDTH) return false;
  if (env.TERM?.toLowerCase() === 'dumb') return false;
  if (env.CI && env.CI !== '0' && env.CI.toLowerCase() !== 'false') return false;
  return true;
}

export type SetupKeyAction = SetupLocale | 'accept' | 'cancel' | null;

/**
 * Normalize raw readline keypresses before the TUI acts on them.
 *
 * On Windows, readline can emit special-key events with an undefined `input`
 * string (notably around Enter/navigation depending on the terminal host).
 * Treat the printable input as optional; never call string methods on it until
 * it has been narrowed. Keeping this pure also gives the package a deterministic
 * regression test for the production crash reported on Node 26 + Windows.
 */
export function resolveSetupKey(
  input: string | undefined,
  key: Keypress | undefined,
): SetupKeyAction {
  const typed = typeof input === 'string' ? input.toLowerCase() : '';
  const name = key?.name?.toLowerCase();
  if ((key?.ctrl && name === 'c') || name === 'escape' || name === 'q') return 'cancel';
  if (name === 'left' || name === 'up' || typed === '1' || typed === 'f') return 'fr';
  if (name === 'right' || name === 'down' || typed === '2' || typed === 'e') return 'en';
  if (name === 'return' || name === 'enter') return 'accept';
  return null;
}

async function chooseLocale(
  initial: SetupLocale,
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
  render: (locale: SetupLocale) => string,
): Promise<SetupLocale | null> {
  let selected = initial;
  readline.emitKeypressEvents(stdin);
  const previousRaw = stdin.isRaw;
  stdin.setRawMode?.(true);
  stdin.resume();
  stdout.write('\x1b[?25l');

  const redraw = (): void => {
    stdout.write('\x1b[2J\x1b[H');
    stdout.write(render(selected) + '\n');
  };
  redraw();

  try {
    return await new Promise<SetupLocale | null>((resolve) => {
      const onKeypress = (input: string | undefined, key: Keypress | undefined): void => {
        const action = resolveSetupKey(input, key);
        if (action === 'cancel') {
          stdin.off('keypress', onKeypress);
          resolve(null);
          return;
        }
        if (action === 'fr' || action === 'en') {
          selected = action;
          redraw();
          return;
        }
        if (action === 'accept') {
          stdin.off('keypress', onKeypress);
          resolve(selected);
        }
      };
      stdin.on('keypress', onKeypress);
    });
  } finally {
    stdin.setRawMode?.(previousRaw ?? false);
    stdin.pause();
    stdout.write('\x1b[?25h');
  }
}

export async function runSetupWizard(options: SetupWizardOptions = {}): Promise<number> {
  const argv = options.argv ?? [];
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const env = options.env ?? process.env;
  const configFile = options.configFile ?? (env.FURYPIPE_CONFIG?.trim() || defaultSetupConfigFile());
  const version = options.version ?? 'dev';
  const now = options.now ?? (() => new Date());

  let parsed: ParsedSetupArgs;
  try {
    parsed = parseSetupArgs(argv);
  } catch (caught) {
    stdout.write('[furypipe setup] ' + (caught as Error).message + '\n');
    stdout.write('Run `furypipe setup --help` for usage.\n');
    return 2;
  }

  if (parsed.help) { stdout.write(setupHelp() + '\n'); return 0; }

  const initial = parsed.locale ?? readConfiguredSetupLocale(configFile) ?? detectSetupLocale(env);
  const color = parsed.color && !('NO_COLOR' in env);
  const rich = !parsed.plain && !parsed.yes && canUseRichTui(stdin, stdout, env);
  const selected = rich
    ? await chooseLocale(initial, stdin, stdout, (locale) => renderSetupScreen({
        selectedLocale: locale, version, width: stdout.columns, color, configFile,
      }))
    : initial;

  if (selected === null) {
    stdout.write('\x1b[2J\x1b[H[furypipe setup] cancelled\n');
    return 130;
  }

  try {
    persistSetupLocale(configFile, selected, version, now);
  } catch (caught) {
    if (rich) stdout.write('\x1b[2J\x1b[H');
    stdout.write('[furypipe setup] could not write config: ' + (caught as Error).message + '\n');
    return 1;
  }

  if (rich) {
    stdout.write('\x1b[2J\x1b[H');
    stdout.write(renderSetupScreen({
      selectedLocale: selected, stage: 'done', version, width: stdout.columns, color, configFile,
    }) + '\n');
  } else {
    stdout.write('FuryPipe Setup ' + version + '\n');
    stdout.write('  language: ' + (selected === 'fr' ? 'Français' : 'English') + '\n');
    stdout.write('  config:   ' + configFile + '\n');
    stdout.write('  status:   ready\n');
  }

  return 0;
}