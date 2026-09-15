import { describe, expect, it } from 'vitest';
import { createKnowledgeIndex } from '../src/knowledge.js';
import type { AgentLearningLessonRecord } from '../src/learning.js';

function lesson(
  lessonId: string,
  memoryClass: AgentLearningLessonRecord['memoryClass'],
  taskDigest: string,
  reuseCount = 0,
): AgentLearningLessonRecord {
  return {
    format: 'furypipe-agent-lesson/v1',
    lessonId,
    memoryClass,
    taskDigest,
    lessonDigest: `${lessonId}_digest`,
    contentHandle: `opaque://${lessonId}`,
    evidenceDigests: [`evidence_${lessonId}`],
    validation: 'validated',
    reuseCount,
  };
}

describe('knowledge metadata graph and retrieval', () => {
  it('indexes validated lessons without retaining plaintext search terms', () => {
    const index = createKnowledgeIndex();
    const entry = index.addLesson(
      lesson('lesson-a', 'Procedural', 'task_a'),
      ['Recovery', 'Atomic Writes', 'Crash Safety'],
    );

    expect(entry.termDigests).toHaveLength(3);
    expect(entry.termDigests.every((value) => /^[0-9a-f]{64}$/.test(value))).toBe(true);
    expect(JSON.stringify(entry)).not.toContain('Recovery');
    expect(JSON.stringify(entry)).not.toContain('Atomic Writes');
    expect(JSON.stringify(entry)).not.toContain('Crash Safety');

    const hits = index.search({ terms: ['recovery', 'crash safety'] });
    expect(hits).toMatchObject([{
      id: 'lesson-a',
      matchedTerms: 2,
      contentHandle: 'opaque://lesson-a',
    }]);
    expect(JSON.stringify(hits)).not.toContain('recovery');
  });

  it('builds explicit evidence-backed graph relations and ranks connected matches deterministically', () => {
    const index = createKnowledgeIndex();
    index.addLesson(lesson('lesson-a', 'Procedural', 'task_a', 2), ['recovery']);
    index.addLesson(lesson('lesson-b', 'Semantic', 'task_b', 5), ['recovery']);
    index.addLesson(lesson('lesson-c', 'Project', 'task_c'), ['unrelated']);
    const edge = index.link({
      from: 'lesson-a',
      to: 'lesson-b',
      relation: 'supports',
      evidence: 'reviewed relationship evidence',
    });

    expect(edge.id).toMatch(/^edge_[0-9a-f]{32}$/);
    expect(edge.evidenceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(edge)).not.toContain('reviewed relationship evidence');
    expect(index.neighbors('lesson-a', 'supports')).toEqual([edge]);

    const hits = index.search({ terms: ['recovery'] });
    expect(hits.map((hit) => hit.id)).toEqual(['lesson-b', 'lesson-a']);
    expect(hits.every((hit) => hit.relationDegree === 1)).toBe(true);
  });

  it('supports exact metadata filters without reading opaque content handles', () => {
    const index = createKnowledgeIndex();
    index.addLesson(lesson('lesson-a', 'Procedural', 'task_shared'), ['locking', 'recovery']);
    index.addLesson(lesson('lesson-b', 'Semantic', 'task_shared'), ['locking']);
    index.addLesson(lesson('lesson-c', 'Procedural', 'task_other'), ['locking']);

    expect(index.search({
      terms: ['locking'],
      memoryClass: 'Procedural',
      taskDigest: 'task_shared',
    }).map((hit) => hit.id)).toEqual(['lesson-a']);

    expect(index.get('lesson-a')).toMatchObject({
      contentHandle: 'opaque://lesson-a',
      taskDigest: 'task_shared',
    });
  });

  it('rejects unvalidated lessons, duplicate nodes, dangling/self edges and malformed queries', () => {
    const index = createKnowledgeIndex();
    const bad = { ...lesson('lesson-a', 'Procedural', 'task_a'), validation: 'rejected' } as unknown as AgentLearningLessonRecord;
    expect(() => index.addLesson(bad, ['recovery'])).toThrow(/validated/);

    index.addLesson(lesson('lesson-a', 'Procedural', 'task_a'), ['recovery']);
    expect(() => index.addLesson(lesson('lesson-a', 'Procedural', 'task_a'), ['recovery'])).toThrow(/already exists/);
    expect(() => index.link({
      from: 'lesson-a', to: 'missing', relation: 'related_to', evidence: 'proof',
    })).toThrow(/endpoints/);
    expect(() => index.link({
      from: 'lesson-a', to: 'lesson-a', relation: 'related_to', evidence: 'proof',
    })).toThrow(/self-edge/);
    expect(() => index.search({ terms: [] })).toThrow(/between 1 and 64/);
    expect(() => index.search({ terms: ['x'], limit: 101 })).toThrow(/1 to 100/);
  });

  it('reports graph statistics without exposing indexed term material', () => {
    const index = createKnowledgeIndex();
    index.addLesson(lesson('lesson-a', 'Procedural', 'task_a'), ['recovery', 'atomic']);
    index.addLesson(lesson('lesson-b', 'Semantic', 'task_b'), ['recovery', 'evidence']);
    index.link({ from: 'lesson-a', to: 'lesson-b', relation: 'supports', evidence: 'review proof' });

    expect(index.stats()).toEqual({ entries: 2, edges: 1, indexedTermDigests: 3 });
    expect(JSON.stringify(index.stats())).not.toContain('recovery');
  });
});
