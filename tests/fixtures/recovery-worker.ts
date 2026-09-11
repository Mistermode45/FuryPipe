import { createRecoveryStore } from '../../src/core/recovery-store.js';
import { createRecoveryAgentMemoryStore, runAgent, type AgentRunSnapshot } from '../../src/agent-runtime.js';

interface WorkerRequest {
  readonly root: string;
  readonly namespace: string;
  readonly operation: 'put' | 'get' | 'delete' | 'backup' | 'restore' | 'rekey' | 'agent-resume';
  readonly value?: string;
  readonly handle?: string;
  readonly path?: string;
  readonly profile?: 'none' | 'v1' | 'both' | 'v2';
  readonly targetKeyId?: string;
  readonly maxGlobalBytes?: number;
  readonly objective?: string;
  readonly runId?: string;
  readonly snapshot?: AgentRunSnapshot;
}

const request = JSON.parse(process.argv[2] ?? '') as WorkerRequest;
const keyOne = new Uint8Array(32).fill(1);
const keyTwo = new Uint8Array(32).fill(2);
const profile = request.profile ?? 'none';
const encryption = profile === 'none' ? undefined : {
  activeKeyId: profile === 'v2' ? 'key-v2' : 'key-v1',
  keys: profile === 'v1' ? { 'key-v1': keyOne }
    : profile === 'v2' ? { 'key-v2': keyTwo }
      : { 'key-v1': keyOne, 'key-v2': keyTwo },
};
const store = createRecoveryStore(request.root, {
  namespace: request.namespace,
  ...(request.maxGlobalBytes === undefined ? {} : { maxGlobalBytes: request.maxGlobalBytes }),
  ...(encryption === undefined ? {} : { encryption }),
});

try {
  switch (request.operation) {
    case 'put': {
      if (request.value === undefined) throw new Error('worker put value is missing');
      const handle = await store.put(new TextEncoder().encode(request.value), { source: 'recovery-worker' });
      console.log(JSON.stringify({ handle }));
      break;
    }
    case 'get': {
      if (request.handle === undefined) throw new Error('worker get handle is missing');
      console.log(new TextDecoder().decode(await store.get(request.handle)));
      break;
    }
    case 'delete': {
      if (request.handle === undefined) throw new Error('worker delete handle is missing');
      console.log(JSON.stringify({ deleted: await store.delete(request.handle) }));
      break;
    }
    case 'backup': {
      if (request.path === undefined) throw new Error('worker backup path is missing');
      console.log(JSON.stringify(await store.backup(request.path)));
      break;
    }
    case 'restore': {
      if (request.path === undefined) throw new Error('worker restore path is missing');
      console.log(JSON.stringify(await store.restore(request.path)));
      break;
    }
    case 'rekey':
      console.log(JSON.stringify(await store.rekey(request.targetKeyId)));
      break;
    case 'agent-resume': {
      if (request.objective === undefined || request.runId === undefined || request.snapshot === undefined) {
        throw new Error('worker agent resume fields are missing');
      }
      const memory = createRecoveryAgentMemoryStore(store);
      const evidence = (stage: string) => [`worker-${stage}-evidence`];
      const result = await runAgent({
        objective: request.objective,
        runId: request.runId,
        memory,
        executors: {
          research: async () => ({ evidence: evidence('research'), consumedTokens: 1 }),
          plan: async () => ({ evidence: evidence('plan'), consumedTokens: 1 }),
          implement: async () => ({ evidence: evidence('implement'), consumedTokens: 1 }),
          review: async () => ({ evidence: evidence('review'), consumedTokens: 1 }),
          verify: async () => ({ evidence: evidence('verify'), consumedTokens: 1 }),
        },
      }, request.snapshot);
      console.log(JSON.stringify(result));
      break;
    }
  }
} catch (caught) {
  console.error(caught instanceof Error ? caught.message : String(caught));
  process.exitCode = 1;
}
