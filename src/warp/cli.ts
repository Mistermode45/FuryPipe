export interface AgentLaunchArgs {
  readonly routes: readonly string[];
  readonly command: readonly string[];
}

/**
 * Parse the FuryPipe agent launcher arguments.
 *
 * Preferred syntax is `furypipe run codex` or `furypipe run -- codex`.
 * The separator is optional so Windows npm shims and ordinary shells have the
 * same user-facing behavior. Launcher options must appear before the command.
 */
export function parseAgentLaunchArgs(argv: readonly string[]): AgentLaunchArgs {
  const routes: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--') {
      return { routes, command: argv.slice(i + 1) };
    }
    if (arg === '--route') {
      const spec = argv[i + 1];
      if (spec === undefined || spec.length === 0) {
        throw new Error('--route needs PATTERN=TARGET');
      }
      routes.push(spec);
      i += 1;
      continue;
    }
    if (arg.startsWith('--route=')) {
      const spec = arg.slice('--route='.length);
      if (spec.length === 0) throw new Error('--route needs PATTERN=TARGET');
      routes.push(spec);
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error('unknown launcher option: ' + arg);
    }
    return { routes, command: argv.slice(i) };
  }
  return { routes, command: [] };
}
