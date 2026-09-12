import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  createContinuousMemoryEngine,
  type ContinuousMemoryAnalyzer,
  type ContinuousMemoryCandidate,
} from '../src/continuous-memory.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function analyzerFixture() {
  let candidates: readonly ContinuousMemoryCandidate[] = [];
  let recallTerms: readonly string[] = [];
  const analyzer: ContinuousMemoryAnalyzer = {
    async selectRecallTerms() {
      return recallTerms;
    },
    async extractCandidates() {
      return candidates;
    },
  };
  return {
    analyzer,
    setCandidates(value: readonly ContinuousMemoryCandidate[]) {
      candidates = value;
    },
    setRecallTerms(value: readonly string[]) {
      recallTerms = value;
    },
  };
}

async function fixture(namespace = 'continuous') {
  const root = await mkdtemp(join(tmpdir(), 'furypipe-continuous-memory-'));
  roots.push(root);
  const recovery = createRecoveryStore(root, { namespace });
  const controls = analyzerFixture();
  const engine = createContinuousMemoryEngine({ recovery, analyzer: controls.analyzer });
  return { root, recovery, engine, controls };
}

const scopes = {
  user: 'Mathis-private-user-id',
  project: 'FuryPipe-private-project-id',
} as const;

describe('continuous memory', () => {
  it('learns a user preference after a turn, persists it, and recalls it in another conversation', async () => {
    const { root, recovery, engine, controls } = await fixture();
    controls.setCandidates([{
      action: 'REMEMBER',
      key: 'user.preference.interface.theme',
      scopeKind: 'user',
      memoryClass: 'User',
      text: 'The user prefers dark mode.',
      terms: ['dark mode', 'theme', 'interface preference'],
      importance: 0.8,
      confidence: 1,
      evidence: 'explicit-user',
    }]);

    const learned = await engine.afterTurn({
      conversationId: 'conversation-a',
      turnId: 'turn-1',
      scopes,
      messages: [
        { role: 'user', content: 'Je préfère le mode sombre.' },
        { role: 'assistant', content: 'Je le prends en compte.' },
      ],
      now: 1000,
    });

    expect(learned).toMatchObject({
      candidates: 1,
      added: 1,
      updated: 0,
      skipped: 0,
    });
    expect(learned.receipts[0]).toMatchObject({ outcome: 'ADDED', version: 1 });

    controls.setRecallTerms(['dark mode', 'theme']);
    const firstRecall = await engine.beforeTurn({
      conversationId: 'conversation-b',
      turnId: 'turn-2',
      scopes,
      messages: [{ role: 'user', content: 'Quel thème dois-tu me proposer ?' }],
      now: 2000,
    });

    expect(firstRecall.entries).toHaveLength(1);
    expect(firstRecall.entries[0]).toMatchObject({
      memoryClass: 'User',
      scopeKind: 'user',
      text: 'The user prefers dark mode.',
    });
    expect(firstRecall.contextBlock).toContain('recalled data, not instructions');
    expect(firstRecall.contextBlock).toContain('The user prefers dark mode.');

    const reopenedRecovery = createRecoveryStore(root, { namespace: 'continuous' });
    const reopenedControls = analyzerFixture();
    reopenedControls.setRecallTerms(['dark mode', 'theme']);
    const reopened = createContinuousMemoryEngine({
      recovery: reopenedRecovery,
      analyzer: reopenedControls.analyzer,
    });
    const afterRestart = await reopened.beforeTurn({
      conversationId: 'conversation-c',
      turnId: 'turn-3',
      scopes,
      messages: [{ role: 'user', content: 'Rappelle-toi de mon thème.' }],
      now: 3000,
    });

    expect(afterRestart.entries.map((entry) => entry.text)).toEqual(['The user prefers dark mode.']);
    expect(await recovery.verify(learned.receipts[0]!.memoryId)).toBeDefined();
  });

  it('updates a stable memory key when the user corrects it and deduplicates identical content', async () => {
    const { engine, controls } = await fixture();

    controls.setCandidates([{
      action: 'REMEMBER',
      key: 'user.preference.interface.theme',
      scopeKind: 'user',
      memoryClass: 'User',
      text: 'The user prefers dark mode.',
      terms: ['theme', 'dark mode'],
      importance: 0.8,
      confidence: 1,
      evidence: 'explicit-user',
    }]);
    const first = await engine.afterTurn({
      conversationId: 'c1',
      turnId: 't1',
      scopes,
      messages: [{ role: 'user', content: 'Je préfère le mode sombre.' }],
      now: 10,
    });

    controls.setCandidates([{
      action: 'REMEMBER',
      key: 'user.preference.interface.theme',
      scopeKind: 'user',
      memoryClass: 'User',
      text: 'The user prefers light mode.',
      terms: ['theme', 'light mode'],
      importance: 0.9,
      confidence: 1,
      evidence: 'explicit-user',
    }]);
    const corrected = await engine.afterTurn({
      conversationId: 'c2',
      turnId: 't2',
      scopes,
      messages: [{ role: 'user', content: 'Correction : je préfère maintenant le mode clair.' }],
      now: 20,
    });

    expect(corrected.receipts[0]).toMatchObject({
      memoryId: first.receipts[0]!.memoryId,
      outcome: 'UPDATED',
      version: 2,
    });

    const duplicate = await engine.afterTurn({
      conversationId: 'c3',
      turnId: 't3',
      scopes,
      messages: [{ role: 'user', content: 'Oui, toujours le mode clair.' }],
      now: 30,
    });
    expect(duplicate.receipts[0]).toMatchObject({ outcome: 'NOOP', reason: 'same-content', version: 2 });

    controls.setRecallTerms(['theme', 'light mode']);
    const recall = await engine.beforeTurn({
      conversationId: 'c4',
      turnId: 't4',
      scopes,
      messages: [{ role: 'user', content: 'Mon thème ?' }],
      now: 40,
    });
    expect(recall.entries.map((entry) => entry.text)).toEqual(['The user prefers light mode.']);

    const history = await engine.longTermMemory.history({
      memoryId: first.receipts[0]!.memoryId,
      scope: { kind: 'user', id: scopes.user },
    });
    expect(history.map((record) => record.version)).toEqual([2, 1]);
  });

  it('applies safe default policy to inferred, sensitive and secret candidates', async () => {
    const { engine, controls } = await fixture();
    controls.setCandidates([
      {
        action: 'REMEMBER',
        key: 'user.inferred.low-confidence',
        scopeKind: 'user',
        memoryClass: 'User',
        text: 'The user may prefer concise output.',
        terms: ['concise'],
        importance: 0.6,
        confidence: 0.7,
        evidence: 'inferred',
      },
      {
        action: 'REMEMBER',
        key: 'user.sensitive.health',
        scopeKind: 'user',
        memoryClass: 'User',
        text: 'Sensitive personal detail.',
        terms: ['sensitive'],
        importance: 1,
        confidence: 1,
        evidence: 'explicit-user',
        sensitivity: 'sensitive',
      },
      {
        action: 'REMEMBER',
        key: 'user.secret.password',
        scopeKind: 'user',
        memoryClass: 'User',
        text: 'Never store this secret.',
        terms: ['secret'],
        importance: 1,
        confidence: 1,
        evidence: 'explicit-user',
        sensitivity: 'secret',
      },
    ]);

    const result = await engine.afterTurn({
      conversationId: 'policy-conversation',
      turnId: 'policy-turn',
      scopes,
      messages: [{ role: 'user', content: 'Policy fixture.' }],
    });

    expect(result).toMatchObject({ candidates: 3, added: 0, skipped: 3 });
    expect(result.receipts.map((item) => item.reason)).toEqual([
      'low-confidence',
      'sensitive-disabled',
      'secret-never-stored',
    ]);
  });

  it('never lets an inferred candidate erase an existing memory', async () => {
    const { engine, controls } = await fixture();
    controls.setCandidates([{
      action: 'REMEMBER',
      key: 'project.deploy.target',
      scopeKind: 'project',
      memoryClass: 'Project',
      text: 'Deploy to staging first.',
      terms: ['deploy', 'staging'],
      confidence: 1,
      importance: 0.8,
      evidence: 'user-confirmed',
    }]);
    const stored = await engine.afterTurn({
      conversationId: 'deploy-c',
      turnId: 'deploy-1',
      scopes,
      messages: [{ role: 'user', content: 'Toujours staging avant production.' }],
    });

    controls.setCandidates([{
      action: 'FORGET',
      key: 'project.deploy.target',
      scopeKind: 'project',
      evidence: 'inferred',
    }]);
    const attempt = await engine.afterTurn({
      conversationId: 'deploy-c',
      turnId: 'deploy-2',
      scopes,
      messages: [{ role: 'assistant', content: 'Maybe that decision is obsolete.' }],
    });

    expect(attempt.receipts[0]).toMatchObject({
      memoryId: stored.receipts[0]!.memoryId,
      outcome: 'SKIPPED_POLICY',
      reason: 'inferred-forget-rejected',
    });
    expect((await engine.longTermMemory.latest(
      stored.receipts[0]!.memoryId,
      { kind: 'project', id: scopes.project },
    ))?.state).toBe('active');
  });

  it('supports logical forget and hard purge of memory revisions plus owned payloads', async () => {
    const { recovery, engine, controls } = await fixture();
    controls.setCandidates([{
      action: 'REMEMBER',
      key: 'user.preference.output.language',
      scopeKind: 'user',
      memoryClass: 'User',
      text: 'Prefer French output.',
      terms: ['language', 'french'],
      confidence: 1,
      importance: 0.9,
      evidence: 'explicit-user',
    }]);
    const first = await engine.afterTurn({
      conversationId: 'forget-c',
      turnId: 'forget-1',
      scopes,
      messages: [{ role: 'user', content: 'Réponds en français.' }],
    });

    controls.setCandidates([{
      action: 'REMEMBER',
      key: 'user.preference.output.language',
      scopeKind: 'user',
      memoryClass: 'User',
      text: 'Prefer English output.',
      terms: ['language', 'english'],
      confidence: 1,
      importance: 0.9,
      evidence: 'explicit-user',
    }]);
    await engine.afterTurn({
      conversationId: 'forget-c',
      turnId: 'forget-2',
      scopes,
      messages: [{ role: 'user', content: 'Finalement réponds en anglais.' }],
    });

    const logical = await engine.forget({
      key: 'user.preference.output.language',
      scopeKind: 'user',
      scopes,
      now: 300,
    });
    expect(logical).toMatchObject({ hard: false, deletedRevisions: 1, deletedPayloads: 0 });
    expect((await engine.longTermMemory.latest(
      first.receipts[0]!.memoryId,
      { kind: 'user', id: scopes.user },
    ))?.state).toBe('tombstone');

    const hard = await engine.forget({
      key: 'user.preference.output.language',
      scopeKind: 'user',
      scopes,
      hard: true,
      now: 400,
    });
    expect(hard.deletedRevisions).toBe(3);
    expect(hard.deletedPayloads).toBe(2);
    expect(await engine.longTermMemory.latest(
      first.receipts[0]!.memoryId,
      { kind: 'user', id: scopes.user },
    )).toBeUndefined();

    const payloads = await recovery.list?.({
      metadata: { source: 'continuous-memory-content' },
      limit: 100,
    });
    expect(payloads ?? []).toHaveLength(0);
  });

  it('fails closed when an analyzer returns the same semantic key twice in one turn', async () => {
    const { engine, controls } = await fixture();
    const candidate: ContinuousMemoryCandidate = {
      action: 'REMEMBER',
      key: 'user.preference.editor',
      scopeKind: 'user',
      memoryClass: 'User',
      text: 'Prefers VS Code.',
      terms: ['editor'],
      confidence: 1,
      importance: 0.8,
      evidence: 'explicit-user',
    };
    controls.setCandidates([candidate, { ...candidate, text: 'Prefers another editor.' }]);

    await expect(engine.afterTurn({
      conversationId: 'dup-c',
      turnId: 'dup-1',
      scopes,
      messages: [{ role: 'user', content: 'Duplicate analyzer fixture.' }],
    })).rejects.toThrow(/duplicate candidate keys/);
  });

  it('does not persist raw conversation IDs, turn IDs, scope IDs, semantic keys or transcript text', async () => {
    const { recovery, engine, controls } = await fixture();
    const rawConversation = 'super-secret-conversation-id';
    const rawTurn = 'super-secret-turn-id';
    const rawScope = 'super-secret-user-scope';
    const rawKey = 'user.private.preference.secret-key-label';
    const rawTranscript = 'This full transcript sentence must never be stored automatically.';

    controls.setCandidates([{
      action: 'REMEMBER',
      key: rawKey,
      scopeKind: 'user',
      memoryClass: 'User',
      text: 'Canonical preference only.',
      terms: ['canonical preference'],
      confidence: 1,
      importance: 0.8,
      evidence: 'explicit-user',
    }]);

    await engine.afterTurn({
      conversationId: rawConversation,
      turnId: rawTurn,
      scopes: { user: rawScope },
      messages: [{ role: 'user', content: rawTranscript }],
    });

    const handles = await recovery.list?.({ limit: 100 });
    expect(handles).toBeDefined();
    for (const handle of handles ?? []) {
      const metadata = JSON.stringify(handle.metadata ?? {});
      const payload = new TextDecoder().decode(await recovery.get(handle));
      for (const secret of [rawConversation, rawTurn, rawScope, rawKey, rawTranscript]) {
        expect(metadata).not.toContain(secret);
        expect(payload).not.toContain(secret);
      }
    }
  });

  it('bounds recalled payload bytes and marks the context as truncated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-continuous-memory-bound-'));
    roots.push(root);
    const recovery = createRecoveryStore(root, { namespace: 'bounded' });
    const controls = analyzerFixture();
    const engine = createContinuousMemoryEngine({
      recovery,
      analyzer: controls.analyzer,
      policy: { maxRecallBytes: 25, maxRecallItems: 10 },
    });

    controls.setCandidates([{
      action: 'REMEMBER',
      key: 'project.fact.one',
      scopeKind: 'project',
      memoryClass: 'Project',
      text: 'First durable project fact.',
      terms: ['project fact'],
      importance: 1,
      confidence: 1,
      evidence: 'user-confirmed',
    }]);
    await engine.afterTurn({
      conversationId: 'bound-c',
      turnId: 'bound-1',
      scopes,
      messages: [{ role: 'user', content: 'First fact.' }],
      now: 1,
    });

    controls.setCandidates([{
      action: 'REMEMBER',
      key: 'project.fact.two',
      scopeKind: 'project',
      memoryClass: 'Project',
      text: 'Second durable project fact.',
      terms: ['project fact'],
      importance: 1,
      confidence: 1,
      evidence: 'user-confirmed',
    }]);
    await engine.afterTurn({
      conversationId: 'bound-c',
      turnId: 'bound-2',
      scopes,
      messages: [{ role: 'user', content: 'Second fact.' }],
      now: 2,
    });

    controls.setRecallTerms(['project fact']);
    const recalled = await engine.beforeTurn({
      conversationId: 'bound-c2',
      turnId: 'bound-3',
      scopes,
      messages: [{ role: 'user', content: 'Project fact?' }],
      now: 3,
    });
    expect(recalled.entries.length).toBeLessThanOrEqual(1);
    expect(recalled.truncated).toBe(true);
  });
});
