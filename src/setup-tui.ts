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

interface Keypress {
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

const A = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[38;5;45m',
  blue: '\x1b[38;5;39m',
  purple: '\x1b[38;5;141m',
  green: '\x1b[38;5;82m',
  yellow: '\x1b[38;5;220m',
  muted: '\x1b[38;5;245m',
  white: '\x1b[38;5;255m',
  bgBlue: '\x1b[48;5;24m',
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

  const header = [
    ...LOGO.map((line) => paint(color, A.cyan + A.bold, line)),
    paint(color, A.cyan + A.bold, 'FURYPIPE // SETUP EXPERIENCE'),
    '',
    paint(color, A.white + A.bold, 'GOVERNED AI WORKFLOWS') +
      paint(color, A.muted, '  ·  context  ·  agents  ·  skills  ·  MCP  ·  providers  ·  memory'),
    paint(color, A.purple + A.bold, 'FuryPipe ' + version) +
      paint(color, A.muted, '  // one CLI, explicit execution, verifiable results'),
    '',
  ];

  const leftWidth = Math.max(30, Math.min(36, Math.floor(width * 0.34)));
  const rightWidth = width - leftWidth - 2;
  const labels = fr
    ? [
        ['Langue', 'Choisir la langue'],
        ['Vérifications', 'Runtime et terminal'],
        ['Installation', 'Préparer FuryPipe'],
        ['Configuration', 'Écrire les préférences'],
        ['Terminé', 'Prêt à créer'],
      ] as const
    : [
        ['Language', 'Choose your language'],
        ['Checks', 'Runtime and terminal'],
        ['Installation', 'Prepare FuryPipe'],
        ['Configuration', 'Write preferences'],
        ['Done', 'Ready to create'],
      ] as const;

  const sidebar: string[] = [];
  for (let i = 0; i < labels.length; i += 1) {
    const state = stage === 'done' ? 'done' : i === 0 ? 'active' : 'pending';
    sidebar.push(...stepLines(i + 1, labels[i]![0], labels[i]![1], state, color));
    if (i < labels.length - 1) sidebar.push(paint(color, A.muted, '    │'));
  }

  const tips = fr
    ? [
        paint(color, A.yellow + A.bold, 'ASTUCE'),
        'Aucune dépendance TUI externe.',
        'Fallback texte automatique dans CI,',
        'pipes et terminaux non interactifs.',
      ]
    : [
        paint(color, A.yellow + A.bold, 'TIP'),
        'No external TUI dependency.',
        'Automatic text fallback in CI, pipes,',
        'and non-interactive terminals.',
      ];

  const left = [...box(sidebar, leftWidth, color, 'SETUP'), '', ...box(tips, leftWidth, color)];

  let main: string[];
  if (stage === 'done') {
    const compact = configFile.startsWith(os.homedir()) ? '~' + configFile.slice(os.homedir().length) : configFile;
    main = fr
      ? [
          paint(color, A.green + A.bold, '✓ Configuration FuryPipe enregistrée'),
          '',
          'Langue : ' + paint(color, A.white + A.bold, selected === 'fr' ? 'Français' : 'English'),
          'Config : ' + paint(color, A.muted, fit(compact, rightWidth - 14)),
          '',
          paint(color, A.white + A.bold, 'Prochaine étape'),
          paint(color, A.cyan, '  furypipe doctor'),
          paint(color, A.cyan, '  furypipe start'),
          '',
          paint(color, A.muted, 'Relancez `furypipe setup` pour modifier les préférences.'),
        ]
      : [
          paint(color, A.green + A.bold, '✓ FuryPipe setup saved'),
          '',
          'Language: ' + paint(color, A.white + A.bold, selected === 'fr' ? 'Français' : 'English'),
          'Config: ' + paint(color, A.muted, fit(compact, rightWidth - 14)),
          '',
          paint(color, A.white + A.bold, 'Next step'),
          paint(color, A.cyan, '  furypipe doctor'),
          paint(color, A.cyan, '  furypipe start'),
          '',
          paint(color, A.muted, 'Run `furypipe setup` again to change preferences.'),
        ];
  } else {
    main = [
      paint(color, A.white + A.bold, fr ? 'Bienvenue dans FuryPipe' : 'Welcome to FuryPipe'),
      paint(color, A.muted, fr
        ? 'Choisissez la langue de votre environnement FuryPipe.'
        : 'Choose the language for your FuryPipe environment.'),
      '',
      ...languageCard('fr', selected, color),
      '',
      ...languageCard('en', selected, color),
      '',
      paint(color, A.muted, fr
        ? '←/→ ou ↑/↓ pour choisir · Entrée pour continuer · Échap pour quitter'
        : '←/→ or ↑/↓ to choose · Enter to continue · Esc to quit'),
      '',
      paint(color, A.muted, fr ? 'Raccourcis : 1 = Français · 2 = English' : 'Shortcuts: 1 = Français · 2 = English'),
    ];
  }

  const right = box(main, rightWidth, color, stage === 'done' ? (fr ? 'PRÊT' : 'READY') : 'LANGUAGE / LANGUE');
  const footer = stage === 'done'
    ? (fr ? 'READY // FuryPipe est configuré.' : 'READY // FuryPipe is configured.')
    : (fr ? 'SETUP // Sélectionnez une langue pour continuer.' : 'SETUP // Select a language to continue.');

  return [
    ...header,
    ...columns(left, right, leftWidth),
    '',
    paint(color, A.blue, border(width)),
    paint(color, A.muted, ' FuryPipe Setup ' + version + '  ') + paint(color, A.cyan + A.bold, footer),
    paint(color, A.blue, border(width, '└', '┘')),
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
  if (env.TERM?.toLowerCase() === 'dumb') return false;
  if (env.CI && env.CI !== '0' && env.CI.toLowerCase() !== 'false') return false;
  return true;
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
      const onKeypress = (input: string, key: Keypress): void => {
        if ((key.ctrl && key.name === 'c') || key.name === 'escape' || key.name === 'q') {
          stdin.off('keypress', onKeypress);
          resolve(null);
          return;
        }
        if (key.name === 'left' || key.name === 'up' || input === '1' || input.toLowerCase() === 'f') {
          selected = 'fr'; redraw(); return;
        }
        if (key.name === 'right' || key.name === 'down' || input === '2' || input.toLowerCase() === 'e') {
          selected = 'en'; redraw(); return;
        }
        if (key.name === 'return' || key.name === 'enter') {
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
  const configFile = options.configFile ?? env.FURYPIPE_CONFIG?.trim() ?? defaultSetupConfigFile();
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

  const initial = parsed.locale ?? detectSetupLocale(env);
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