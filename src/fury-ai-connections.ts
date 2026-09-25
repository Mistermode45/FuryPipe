// Safe AI connection discovery for FuryPipe Studio.
//
// This module intentionally does NOT read browser cookies, OAuth stores, CLI
// credential files or secret values. It combines two non-invasive signals:
// installed harnesses (already discovered by the Harness Hub) and the presence
// of well-known environment-variable names. Returned data contains names and
// status only, never credential contents.
import type { FuryHarnessDiscovery } from './fury-harness-hub.js';

export const FURY_AI_CONNECTIONS_FORMAT = 'furypipe-ai-connections/v1' as const;

export type FuryAiConnectionState = 'credential-configured' | 'runtime-detected' | 'not-detected';

export interface FuryAiConnection {
  readonly id: string;
  readonly displayName: string;
  readonly state: FuryAiConnectionState;
  readonly configuredVia: readonly string[];
  readonly runtimes: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly version?: string;
  }[];
  readonly accountVerification: 'not-probed';
}

export interface FuryAiConnections {
  readonly format: typeof FURY_AI_CONNECTIONS_FORMAT;
  readonly connections: readonly FuryAiConnection[];
  readonly policy: {
    readonly browserSessions: 'not-inspected';
    readonly credentialStores: 'not-inspected';
    readonly secretValues: 'never-returned';
  };
}

interface Definition {
  readonly id: string;
  readonly displayName: string;
  readonly runtimeIds: readonly string[];
  readonly envMarkers: readonly string[];
}

const DEFINITIONS: readonly Definition[] = Object.freeze([
  { id: 'anthropic', displayName: 'Claude / Anthropic', runtimeIds: ['claude-code'], envMarkers: ['ANTHROPIC_API_KEY'] },
  { id: 'openai', displayName: 'ChatGPT / OpenAI / Codex', runtimeIds: ['codex'], envMarkers: ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_FEDERATION_RULE_ID', 'OPENAI_IDENTITY_TOKEN_FILE'] },
  { id: 'google', displayName: 'Gemini / Google', runtimeIds: ['gemini-cli'], envMarkers: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_GENAI_USE_GCA'] },
  { id: 'openrouter', displayName: 'OpenRouter', runtimeIds: [], envMarkers: ['OPENROUTER_API_KEY'] },
  { id: 'mistral', displayName: 'Mistral', runtimeIds: [], envMarkers: ['MISTRAL_API_KEY'] },
  { id: 'deepseek', displayName: 'DeepSeek', runtimeIds: [], envMarkers: ['DEEPSEEK_API_KEY'] },
  { id: 'groq', displayName: 'Groq', runtimeIds: [], envMarkers: ['GROQ_API_KEY'] },
]);

function presentMarkers(env: NodeJS.ProcessEnv, names: readonly string[]): string[] {
  return names.filter((name) => Object.prototype.hasOwnProperty.call(env, name) && typeof env[name] === 'string' && env[name]!.length > 0);
}

export function discoverFuryAiConnections(
  harnesses: FuryHarnessDiscovery,
  env: NodeJS.ProcessEnv = process.env,
): FuryAiConnections {
  const connections = DEFINITIONS.map((definition): FuryAiConnection => {
    const configuredVia = presentMarkers(env, definition.envMarkers);
    const runtimes = harnesses.harnesses
      .filter((h) => definition.runtimeIds.includes(h.id) && h.installed)
      .map((h) => Object.freeze({
        id: h.id,
        displayName: h.displayName,
        ...(h.version ? { version: h.version } : {}),
      }));
    const state: FuryAiConnectionState = configuredVia.length
      ? 'credential-configured'
      : runtimes.length
        ? 'runtime-detected'
        : 'not-detected';
    return Object.freeze({
      id: definition.id,
      displayName: definition.displayName,
      state,
      configuredVia: Object.freeze(configuredVia),
      runtimes: Object.freeze(runtimes),
      accountVerification: 'not-probed' as const,
    });
  });
  return Object.freeze({
    format: FURY_AI_CONNECTIONS_FORMAT,
    connections: Object.freeze(connections),
    policy: Object.freeze({
      browserSessions: 'not-inspected' as const,
      credentialStores: 'not-inspected' as const,
      secretValues: 'never-returned' as const,
    }),
  });
}
