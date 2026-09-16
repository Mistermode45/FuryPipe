/**
 * FuryLink connects an AI CLI to the local FuryPipe Control Plane through a
 * narrow loopback CONNECT bridge. Only provider inference routes selected by
 * FuryPipe are re-originated; unrelated traffic remains direct.
 *
 * The child keeps its normal provider-facing configuration while FuryPipe owns
 * the context transformation, evidence and routing decisions.
 */

import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

import { CertificateAuthority } from './ca.js';
import { createFuryLinkHandlers } from './connect.js';
import { parseRoute, routeDestination, type Route } from './route.js';

export interface FuryLinkRuntimeOptions {
  /** Port the FuryPipe proxy is already serving on: where matches are sent. */
  port: number;
  /**
   * Extra PATTERN=TARGET rules, in priority order ahead of the default
   * Anthropic rule. Agents that reach their provider over a base URL rather
   * than api.anthropic.com (codex, opencode) need one rule each.
   */
  routes?: readonly string[];
}

export interface FuryLinkRuntime {
  /** Bind the child's proxy port, then spawn the child. */
  launch: (command: string[]) => void;
}

/**
 * Only the inference path is diverted. Everything else on the host — OAuth,
 * telemetry, the control plane — is re-originated untouched, which is what
 * keeps the agent's client-side gates satisfied.
 */
function defaultRoutes(port: number): Route[] {
  return [
    parseRoute(`api.anthropic.com/v1/messages*=http://127.0.0.1:${port}`),
    parseRoute(`daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent*=http://127.0.0.1:${port}`),
    parseRoute(`daily-cloudcode-pa.googleapis.com/v1internal:generateContent*=http://127.0.0.1:${port}`),
    parseRoute(`generativelanguage.googleapis.com/v1beta/models/*:streamGenerateContent*=http://127.0.0.1:${port}`),
    parseRoute(`generativelanguage.googleapis.com/v1beta/models/*:generateContent*=http://127.0.0.1:${port}`),
    parseRoute(`generativelanguage.googleapis.com/v1/models/*:streamGenerateContent*=http://127.0.0.1:${port}`),
    parseRoute(`generativelanguage.googleapis.com/v1/models/*:generateContent*=http://127.0.0.1:${port}`),
  ];
}

export function createFuryLinkRuntime(options: FuryLinkRuntimeOptions): FuryLinkRuntime {
  const { port } = options;
  // Explicit rules first: an operator route for a specific host:port must win
  // over anything built in.
  const routes = [
    ...(options.routes ?? []).map((spec) => parseRoute(spec)),
    ...defaultRoutes(port),
  ];
  const ca = CertificateAuthority.loadOrCreate(join(homedir(), '.furypipe'));

  const handlers = createFuryLinkHandlers({
    routes,
    ca,
    // The child inherits this terminal and Claude Code draws a full-screen TUI
    // over it, so anything written after the child starts corrupts the display.
    // Keep the line when stdout is redirected (piping, CI, debugging); stay
    // silent when a human is looking at the agent. events.jsonl records the
    // request either way.
    onDivert: (host, path, target) => {
      if (!process.stdout.isTTY) console.error(`[furypipe] link: ${host}${path} → ${target}`);
    },
  });

  // FuryLink's child-facing listener, and the only reason a port is involved at all: the
  // child is configured through HTTPS_PROXY, which can only name a host:port.
  // The kernel picks it, nothing else needs to know it, so there is nothing to
  // collide with a FuryPipe already running.
  const proxy = createServer(handlers.handleAbsoluteForm);
  proxy.on('connect', handlers.handleConnect);

  const hasPathSyntax = (name: string): boolean => name.includes('/') || name.includes('\\');

  /**
   * Resolve a command without delegating correctness to a shell.
   *
   * Windows uses ';' as PATH delimiter and PATHEXT to expose npm-installed
   * *.cmd launchers. The former implementation split PATH on ':' and then fell
   * through to /bin/sh, which made common Windows agent commands impossible.
   */
  const resolveOnPath = (name: string, env: NodeJS.ProcessEnv): string | null => {
    if (hasPathSyntax(name)) return existsSync(name) ? name : null;

    const windows = process.platform === 'win32';
    const pathExt = windows
      ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : [''];
    const alreadyHasWindowsExt = windows && pathExt.some((ext) => name.toLowerCase().endsWith(ext.toLowerCase()));
    const candidates = windows && !alreadyHasWindowsExt
      ? [name, ...pathExt.map((ext) => name + ext)]
      : [name];

    for (const dir of (env.PATH ?? '').split(delimiter)) {
      if (!dir) continue;
      for (const candidate of candidates) {
        const full = join(dir, candidate);
        try {
          if (windows) {
            if (existsSync(full)) return full;
          } else {
            accessSync(full, constants.X_OK);
            return full;
          }
        } catch {
          // not here, keep looking
        }
      }
    }
    return null;
  };

  /**
   * POSIX-only alias probe. Windows aliases/functions are shell-host specific
   * and FuryLink deliberately resolves concrete PATH launchers there.
   */
  const shellAliasTarget = (name: string, shell: string, env: NodeJS.ProcessEnv): string | null => {
    if (process.platform === 'win32' || hasPathSyntax(name)) return null;
    const probe = spawnSync(shell, ['-ic', `type -- ${name}`], { encoding: 'utf8', env });
    const match = /\bis (?:an alias for|aliased to)\s+(.+)$/m.exec(probe.stdout ?? '');
    if (!match) return null;
    return match[1]!.trim().replace(/^`/, '').replace(/'$/, '');
  };

  const isRunnable = (word: string, env: NodeJS.ProcessEnv): boolean =>
    resolveOnPath(word, env) !== null;

  /** POSIX single-quote: safe for anything except a single quote itself. */
  const shellQuote = (arg: string): string => `'${arg.replaceAll("'", `'\\''`)}'`;

  /**
   * Resolve and launch an agent on Windows, macOS and Linux.
   *
   * Windows npm shims are .cmd/.bat files and therefore need cmd.exe semantics;
   * Node's shell mode is used only for those resolved launcher files. Native
   * executables stay shell-free. POSIX keeps the interactive-shell alias
   * fallback used by Claude aliases while preferring a concrete executable.
   */
  const spawnResolved = (command: string[], env: NodeJS.ProcessEnv) => {
    const direct = { stdio: 'inherit', env } as const;
    const first = command[0]!;
    const resolved = resolveOnPath(first, env);

    if (process.platform === 'win32') {
      if (resolved && /\.(?:cmd|bat)$/i.test(resolved)) {
        return spawn(resolved, command.slice(1), { ...direct, shell: true });
      }
      return spawn(resolved ?? first, command.slice(1), direct);
    }

    const shell = env.SHELL || '/bin/sh';
    const alias = shellAliasTarget(first, shell, env);
    const aliasWord = alias?.split(/\s+/)[0] ?? '';
    const aliasUsable = alias !== null && (aliasWord.includes('=') || isRunnable(aliasWord, env));
    if (alias !== null && !aliasUsable) {
      console.error(`[furypipe] link: ignoring stale alias ${first} → ${aliasWord} (not executable)`);
    }
    if (!aliasUsable && resolved) {
      return spawn(resolved, command.slice(1), direct);
    }
    console.error(`[furypipe] link: resolving ${first} via interactive shell fallback`);
    const script = [first, ...command.slice(1).map(shellQuote)].join(' ');
    return spawn(shell, ['-ic', script], direct);
  };

  const spawnChild = (command: string[], proxyUrl: string): void => {
    const env = { ...process.env };
    // The agent must believe it is talking to api.anthropic.com. Both of these
    // would defeat that, and either may be left over in the user's shell from a
    // previous non-FuryLink session.
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_UNIX_SOCKET;
    env.HTTP_PROXY = proxyUrl;
    env.http_proxy = proxyUrl;
    env.HTTPS_PROXY = proxyUrl;
    env.https_proxy = proxyUrl;
    // Trust is scoped to this child; nothing is added to the system keychain.
    // Which variable actually works depends on the agent's runtime, and the
    // answer is not stable: the macOS `claude` is a native Mach-O binary, not a
    // Node script, so the Node-only variable alone would silently fail to make
    // it trust us. Set every convention — they are inert for runtimes that
    // ignore them, and one of them is the one that counts.
    // NODE_EXTRA_CA_CERTS appends to Node's built-in roots, so the CA-only
    // file is right there. The other three REPLACE the trust store: handing
    // them a 1-cert file strips the public roots from every other HTTPS client
    // in the session (gcloud, gws, pip all fail verification — #245). They get
    // the bundle: our CA followed by the system roots.
    env.NODE_EXTRA_CA_CERTS = ca.certPath; // Node, and Bun-compiled binaries
    env.SSL_CERT_FILE = ca.bundlePath; // OpenSSL: curl, Rust, Go with cgo
    env.CURL_CA_BUNDLE = ca.bundlePath; // libcurl
    env.REQUESTS_CA_BUNDLE = ca.bundlePath; // Python requests / httpx

    const child = spawnResolved(command, env);
    // The child's proxy and CA point at this process. If FuryLink exits for any
    // reason the child is reparented to init and keeps running against a closed
    // port, so every request fails and the agent looks hung instead of exiting.
    // Take it with us on every exit path, including a crash.
    let childLive = true;
    child.on('exit', () => {
      childLive = false;
    });
    process.on('exit', () => {
      if (childLive) child.kill('SIGTERM');
    });
    // A connection dying is not a FuryLink failure. The upstream resets, the proxy
    // gets restarted, a keep-alive socket goes away between requests — all of
    // that arrives here as an errno on a socket nobody was listening to at that
    // instant. Exiting on it would take the agent down with us (see the exit
    // handler above) and lose a whole run to one dropped TCP connection. Log
    // and keep serving; the request that owned the socket fails on its own and
    // the agent retries. Anything without an errno is a real bug in our code,
    // and staying up for that would leave the agent talking to a proxy in an
    // unknown state, so those still exit.
    const NET_ERRNO = new Set([
      'ECONNRESET',
      'ECONNREFUSED',
      'ECONNABORTED',
      'EPIPE',
      'ETIMEDOUT',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ENETDOWN',
      'ENOTCONN',
      'EAI_AGAIN',
      'ERR_STREAM_DESTROYED',
      'ERR_STREAM_WRITE_AFTER_END',
      'ERR_SOCKET_CONNECTION_TIMEOUT',
    ]);
    const die = (err: unknown): void => {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (typeof code === 'string' && NET_ERRNO.has(code)) {
        console.error(`[furypipe] link: connection error ${code} (continuing)`);
        return;
      }
      console.error(`[furypipe] link: ${err instanceof Error ? err.stack : String(err)}`);
      process.exit(1);
    };
    process.on('uncaughtException', die);
    process.on('unhandledRejection', die);
    child.on('error', (err) => {
      console.error(`[furypipe] link: cannot run ${command[0]}: ${err.message}`);
      process.exit(127);
    });
    // SIGHUP and SIGQUIT matter as much as the interactive two: closing the
    // terminal sends SIGHUP, and without forwarding it the agent survives with
    // its proxy pointed at a port that is about to close.
    const forwarded = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'] as const;
    child.on('exit', (code, signal) => {
      // Reproduce the child's own exit status so FuryLink is transparent to callers.
      // Re-raising means routing the signal back through our own handlers, so
      // drop them first: Ctrl-C kills the child with SIGINT, and without this
      // the re-raise just re-enters the forwarder, kills an already-dead child
      // and leaves FuryLink running forever.
      if (signal) {
        for (const s of forwarded) process.removeAllListeners(s);
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 0);
    });
    for (const signal of forwarded) {
      process.on(signal, () => child.kill(signal));
    }
  };

  const launch = (command: string[]): void => {
    if (command.length === 0) {
      console.error('[furypipe] link: nothing to run — usage: furypipe link <command> [args...]');
      process.exit(2);
    }
    // Startup banner goes to stderr: stdout belongs to the child, so a caller
    // piping the agent's output gets the agent's bytes and nothing of ours.
    for (const route of routes) {
      console.error(`[furypipe] FuryLink route → ${route.pattern} → ${routeDestination(route)}`);
    }
    console.error(`[furypipe] FuryLink CA → ${ca.certPath}`);
    if (ca.systemRootsPath) {
      console.error(`[furypipe] FuryLink CA bundle → ${ca.bundlePath} (+ system roots from ${ca.systemRootsPath})`);
    } else {
      console.error(
        `[furypipe] FuryLink CA bundle → ${ca.bundlePath} (no system root bundle found; ` +
          `non-FuryPipe HTTPS in the child may fail verification — set SSL_CERT_FILE to your OS bundle before FuryLink)`,
      );
    }
    console.error(`[furypipe] FuryLink exec → ${command.join(' ')}`);

    proxy.on('error', (err) => {
      console.error(`[furypipe] link: proxy listener failed: ${err.message}`);
      process.exit(1);
    });
    proxy.listen(0, '127.0.0.1', () => {
      const address = proxy.address();
      const proxyUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      console.error(`[furypipe] FuryLink proxy → ${proxyUrl} (child only)`);
      spawnChild(command, proxyUrl);
    });
  };

  return { launch };
}
