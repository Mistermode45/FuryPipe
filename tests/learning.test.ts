import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createHumanLearningPath,
  recordHumanLearningAttempt,
  createRecoveryAgentLearningStore,
  createInMemoryAgentLearningStore,
  runAgentLearningCycle,
  type HumanLearningTopic,
} from '../src/learning.js';
import { createRecoveryStore } from '../src/core/recovery-store.js';

const topics: readonly HumanLearningTopic[] = [
  {
    id: 'basics', title: 'Basics', prerequisites: [],
    theory: ['exact theory'], practice: ['exact practice'],
    exercises: [{ id: 'ex-1', instruction: 'build it', expectedEvidence: ['test output'] }],
    project: 'small project', quiz: [{ id: 'q-1', prompt: 'why?', correctAnswerDigest: 'answer_digest' }],
    explainBackPrompt: 'Explain the invariant back.',
  },
  {
    id: 'advanced', title: 'Advanced', prerequisites: ['basics'],
    theory: ['advanced theory'], practice: ['advanced practice'], exercises: [], quiz: [],
    explainBackPrompt: 'Explain the trade-off back.',
  },
];

describe('FuryPipe learning layers', () => {
  it('builds a human diagnostic, prerequisite roadmap, curriculum and reviews without exposing the learner id', () => {
    const path = createHumanLearningPath({ learnerId: 'learner@example.invalid', topics, selfRatings: { basics: 0.9, advanced: 0.1 }, now: 1_000 });
    expect(path.learnerIdDigest).toMatch(/^learner_[a-f0-9]{24}$/);
    expect(JSON.stringify(path)).not.toContain('learner@example.invalid');
    expect(path.roadmap).toEqual(['basics', 'advanced']);
    expect(path.masteryGraph).toEqual([{ from: 'basics', to: 'advanced' }]);
    expect(path.curriculum[0]?.theory).toEqual(['exact theory']);
    expect(path.curriculum[0]?.practice).toEqual(['exact practice']);
    expect(path.curriculum[0]?.exercises[0]?.instruction).toBe('build it');
    expect(path.curriculum[0]?.quiz[0]?.prompt).toBe('why?');
    expect(path.curriculum[0]?.explainBackPrompt).toContain('invariant');
    expect(path.nextReviews[1]).toMatchObject({ topicId: 'advanced', intervalDays: 1, nextReviewAt: 86_401_000 });
  });

  it('updates mastery and spaced repetition from a real learning attempt', () => {
    const path = createHumanLearningPath({ learnerId: 'learner-1', topics, selfRatings: { basics: 0 }, now: 0 });
    const updated = recordHumanLearningAttempt(path, {
      topicId: 'basics', theoryCompleted: true, practiceCompleted: true,
      exerciseScore: 1, quizScore: 0.8, explainBackScore: 0.9, at: 86_400_000,
    });
    expect(updated.mastery.basics).toBeGreaterThan(0.2);
    expect(updated.nextReviews[0]).toMatchObject({ intervalDays: 1, nextReviewAt: 172_800_000 });
  });

  it('rejects cyclic prerequisite graphs', () => {
    expect(() => createHumanLearningPath({ learnerId: 'learner-1', topics: [
      { ...topics[0]!, id: 'a', prerequisites: ['b'] },
      { ...topics[1]!, id: 'b', prerequisites: ['a'] },
    ] })).toThrow('cycle');
  });

  it('executes the agent learning cycle in order and stores only metadata plus an opaque handle', async () => {
    const seen: string[] = [];
    const store = createInMemoryAgentLearningStore();
    const phase = (name: string) => async (context: { readonly network: string; readonly secrets: string; }): Promise<{ outputDigest: string; evidence: readonly string[]; consumedTokens: number }> => {
      seen.push(name);
      expect(context.network).toBe('disabled');
      expect(context.secrets).toBe('never_requested');
      return { outputDigest: `${name}_digest`, evidence: [`${name}_evidence`], consumedTokens: 1 };
    };
    const result = await runAgentLearningCycle({
      task: 'Improve the recovery invariant.', memoryClass: 'Procedural', store,
      handlers: {
        plan: phase('plan'), execute: phase('execute'), verify: phase('verify'), reflect: phase('reflect'),
        extractLesson: async () => ({ lessonId: 'lesson-1', memoryClass: 'Procedural', lessonDigest: 'lesson_digest', contentHandle: 'opaque://lesson-1', evidence: ['extracted'], consumedTokens: 1 }),
        validate: async () => ({ validated: true, evidence: ['validated'], consumedTokens: 1 }),
      },
    });
    expect(result.status).toBe('completed');
    expect(seen).toEqual(['plan', 'execute', 'verify', 'reflect']);
    expect(result.phaseOrder).toEqual(['plan', 'execute', 'verify', 'reflect', 'extract_lesson', 'validate', 'store', 'reuse']);
    expect(result.reusedLessons).toMatchObject([{ lessonId: 'lesson-1', contentHandle: 'opaque://lesson-1', reuseCount: 1 }]);
    expect(JSON.stringify(result)).not.toContain('Improve the recovery invariant.');
    expect((await store.findReusableLessons({ taskDigest: result.taskDigest, memoryClass: 'Procedural' }))[0]).toMatchObject({ validation: 'validated', reuseCount: 2 });
  });

  it('does not store a rejected lesson', async () => {
    const store = createInMemoryAgentLearningStore();
    const phase = async () => ({ outputDigest: 'phase_digest', evidence: ['evidence'], consumedTokens: 1 });
    const result = await runAgentLearningCycle({
      task: 'Rejected lesson.', memoryClass: 'Semantic', store,
      handlers: {
        plan: phase, execute: phase, verify: phase, reflect: phase,
        extractLesson: async () => ({ lessonId: 'rejected', memoryClass: 'Semantic', lessonDigest: 'lesson_digest', contentHandle: 'opaque://rejected', evidence: ['draft'], consumedTokens: 1 }),
        validate: async () => ({ validated: false, evidence: ['not enough proof'], consumedTokens: 1 }),
      },
    });
    expect(result.status).toBe('failed');
    expect(result.failure).toMatchObject({ phase: 'validate' });
    expect(await store.findReusableLessons({ taskDigest: result.taskDigest })).toEqual([]);
  });

  it('stops before lesson storage when the learning context budget is exceeded', async () => {
    const store = createInMemoryAgentLearningStore();
    const phase = async () => ({ outputDigest: 'phase_digest', evidence: ['evidence'], consumedTokens: 100 });
    const result = await runAgentLearningCycle({
      task: 'Bound learning context.', memoryClass: 'Working', store, contextBudgetTokens: 256,
      handlers: {
        plan: phase, execute: phase, verify: phase, reflect: phase,
        extractLesson: async () => ({ lessonId: 'never-stored', memoryClass: 'Working', lessonDigest: 'lesson_digest', contentHandle: 'opaque://never-stored', evidence: ['draft'], consumedTokens: 1 }),
        validate: async () => ({ validated: true, evidence: ['validated'], consumedTokens: 1 }),
      },
    });
    expect(result.status).toBe('failed');
    expect(result.failure).toMatchObject({ phase: 'verify', reason: 'context budget exceeded' });
    expect(await store.findReusableLessons({ taskDigest: result.taskDigest })).toEqual([]);
  });

  it('reopens validated lessons from Recovery and increments reuse through immutable revisions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-learning-recovery-'));
    try {
      const record = {
        format: 'furypipe-agent-lesson/v1' as const,
        lessonId: 'durable-lesson', memoryClass: 'Procedural' as const,
        taskDigest: 'task_digest', lessonDigest: 'lesson_digest', contentHandle: 'opaque://durable-lesson',
        evidenceDigests: ['evidence_digest'], validation: 'validated' as const, reuseCount: 0,
      };
      await createRecoveryAgentLearningStore(createRecoveryStore(root, { namespace: 'learning' })).store(record);
      const reopened = createRecoveryAgentLearningStore(createRecoveryStore(root, { namespace: 'learning' }));
      expect(await reopened.findReusableLessons({ taskDigest: 'task_digest', memoryClass: 'Procedural' })).toMatchObject([{ lessonId: 'durable-lesson', reuseCount: 1 }]);
      const reopenedAgain = createRecoveryAgentLearningStore(createRecoveryStore(root, { namespace: 'learning' }));
      expect(await reopenedAgain.findReusableLessons({ taskDigest: 'task_digest', memoryClass: 'Procedural' })).toMatchObject([{ lessonId: 'durable-lesson', reuseCount: 2 }]);
      const store = createRecoveryStore(root, { namespace: 'learning' });
      const handles = await store.list?.({ metadata: { source: 'agent-learning' } });
      expect(handles).toHaveLength(3);
      const payload = new TextDecoder().decode(await store.get(handles![0]!));
      expect(payload).not.toContain('Improve the recovery invariant.');
      expect(payload).toContain('opaque://durable-lesson');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
