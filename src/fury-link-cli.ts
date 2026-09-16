export interface FuryLinkInvocation {
  readonly routes: readonly string[];
  readonly command: readonly string[];
}

export class FuryLinkUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FuryLinkUsageError';
  }
}

/**
 * Parse the public FuryLink command surface.
 *
 * Both forms are intentionally supported:
 *   furypipe link codex
 *   furypipe link -- codex
 *
 * The separator is optional so Windows PowerShell / cmd.exe shims never become
 * a correctness dependency. FuryLink options must appear before the command;
 * everything after the first command word is passed through byte-for-byte as
 * argv strings.
 */
export function parseFuryLinkInvocation(argv: readonly string[]): FuryLinkInvocation {
  const routes: string[] = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === '--') {
      return { routes, command: argv.slice(i + 1) };
    }
    if (arg === '--route') {
      const spec = argv[i + 1];
      if (!spec) throw new FuryLinkUsageError('--route needs PATTERN=TARGET');
      routes.push(spec);
      i += 2;
      continue;
    }
    if (arg.startsWith('--route=')) {
      const spec = arg.slice('--route='.length);
      if (!spec) throw new FuryLinkUsageError('--route needs PATTERN=TARGET');
      routes.push(spec);
      i += 1;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      throw new FuryLinkUsageError('help');
    }
    if (arg.startsWith('-')) {
      throw new FuryLinkUsageError('unknown FuryLink option: ' + arg);
    }
    return { routes, command: argv.slice(i) };
  }

  return { routes, command: [] };
}

export function furyLinkHelp(): string {
  return [
    'FuryLink — connect an AI agent to the local FuryPipe runtime',
    '',
    'Usage:',
    '  furypipe link <command> [args...]',
    '  furypipe link [--route PATTERN=TARGET]... -- <command> [args...]',
    '',
    'Examples:',
    '  furypipe link claude',
    '  furypipe link codex',
    '  furypipe link cursor-agent',
    '',
    'Options:',
    '  --route PATTERN=TARGET   add a provider route before built-in routes',
    '  -h, --help               show this help',
  ].join('\n');
}
