import { createHash } from 'node:crypto';

export type HumanLearningTopicId = string;

export interface HumanLearningExercise {
  readonly id: string;
  readonly instruction: string;
  readonly expectedEvidence: readonly string[];
}

export interface HumanLearningQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly correctAnswerDigest: string;
}

export interface HumanLearningTopic {
  readonly id: HumanLearningTopicId;
  readonly title: string;
  readonly prerequisites: readonly HumanLearningTopicId[];
  readonly theory: readonly string[];
  readonly practice: readonly string[];
  readonly exercises: readonly HumanLearningExercise[];
  readonly project?: string;
  readonly quiz: readonly HumanLearningQuestion[];
  readonly explainBackPrompt: string;
}

export interface HumanLearningDiagnostic {
  readonly learnerIdDigest: string;
  readonly ratings: Readonly<Record<HumanLearningTopicId, number>>;
  readonly gaps: readonly HumanLearningTopicId[];
}

export interface HumanLearningMasteryEdge {
  readonly from: HumanLearningTopicId;
  readonly to: HumanLearningTopicId;
}

export interface HumanLearningReview {
  readonly topicId: HumanLearningTopicId;
  readonly intervalDays: number;
  readonly nextReviewAt: number;
}

export interface HumanLearningPath {
  readonly format: 'furypipe-human-learning-path/v1';
  readonly learnerIdDigest: string;
  readonly diagnostic: HumanLearningDiagnostic;
  readonly roadmap: readonly HumanLearningTopicId[];
  readonly mastery: Readonly<Record<HumanLearningTopicId, number>>;
  readonly masteryGraph: readonly HumanLearningMasteryEdge[];
  readonly curriculum: readonly HumanLearningTopic[];
  readonly nextReviews: readonly HumanLearningReview[];
}

export interface HumanLearningPathInput {
  readonly learnerId: string;
  readonly topics: readonly HumanLearningTopic[];
  readonly selfRatings?: Readonly<Record<HumanLearningTopicId, number>>;
  readonly now?: number;
}

export interface HumanLearningAttempt {
  readonly topicId: HumanLearningTopicId;
  readonly theoryCompleted: boolean;
  readonly practiceCompleted: boolean;
  readonly exerciseScore: number;
  readonly quizScore: number;
  readonly explainBackScore: number;
  readonly at: number;
}

export type AgentMemoryClass =
  | 'Working'
  | 'Episodic'
  | 'Semantic'
  | 'Procedural'
  | 'Project'
  | 'User'
  | 'Skills';

export type AgentLearningPhaseId =
  | 'plan'
  | 'execute'
  | 'verify'
  | 'reflect'
  | 'extract_lesson'
  | 'validate'
  | 'store'
  | 'reuse';

export interface AgentLearningPhaseContext {
  readonly cycleId: string;
  readonly taskDigest: string;
  readonly memoryClass: AgentMemoryClass;
  readonly priorPhase?: AgentLearningPhaseId;
  readonly priorDigest?: string;
  readonly network: 'disabled';
  readonly secrets: 'never_requested';
}

export interface AgentLearningPhaseResult {
  readonly outputDigest: string;
  readonly evidence: readonly string[];
  readonly consumedTokens: number;
}

export interface AgentLearningLessonDraft {
  readonly lessonId: string;
  readonly memoryClass: AgentMemoryClass;
  readonly lessonDigest: string;
  /** Opaque host-owned reference. The learning layer never reads its content. */
  readonly contentHandle: string;
  readonly evidence: readonly string[];
  readonly consumedTokens: number;
}

export interface AgentLearningValidation {
  readonly validated: boolean;
  readonly evidence: readonly string[];
  readonly consumedTokens: number;
}

export interface AgentLearningLessonRecord {
  readonly format: 'furypipe-agent-lesson/v1';
  readonly lessonId: string;
  readonly memoryClass: AgentMemoryClass;
  readonly taskDigest: string;
  readonly lessonDigest: string;
  readonly contentHandle: string;
  readonly evidenceDigests: readonly string[];
  readonly validation: 'validated';
  readonly reuseCount: number;
}

export interface AgentLearningStore {
  store(record: AgentLearningLessonRecord): Promise<void>;
  findReusableLessons(input: {
    readonly taskDigest: string;
    readonly memoryClass?: AgentMemoryClass;
  }): Promise<readonly AgentLearningLessonRecord[]>;
}

export interface AgentLearningCycleHandlers {
  readonly plan: (context: AgentLearningPhaseContext) => Promise<AgentLearningPhaseResult>;
  readonly execute: (context: AgentLearningPhaseContext) => Promise<AgentLearningPhaseResult>;
  readonly verify: (context: AgentLearningPhaseContext) => Promise<AgentLearningPhaseResult>;
  readonly reflect: (context: AgentLearningPhaseContext) => Promise<AgentLearningPhaseResult>;
  readonly extractLesson: (context: AgentLearningPhaseContext) => Promise<AgentLearningLessonDraft>;
  readonly validate: (context: AgentLearningPhaseContext & { readonly draft: AgentLearningLessonDraft }) => Promise<AgentLearningValidation>;
}

export interface AgentLearningCycleInput {
  readonly task: string;
  readonly memoryClass: AgentMemoryClass;
  readonly handlers: AgentLearningCycleHandlers;
  readonly store: AgentLearningStore;
  readonly cycleId?: string;
  readonly contextBudgetTokens?: number;
}

export interface AgentLearningPhaseRecord {
  readonly phase: AgentLearningPhaseId;
  readonly outputDigest: string;
  readonly evidenceDigests: readonly string[];
  readonly consumedTokens: number;
}

export interface AgentLearningCycleResult {
  readonly format: 'furypipe-agent-learning-cycle/v1';
  readonly status: 'completed' | 'failed';
  readonly cycleId: string;
  readonly taskDigest: string;
  readonly memoryClass: AgentMemoryClass;
  readonly phaseOrder: readonly AgentLearningPhaseId[];
  readonly phases: readonly AgentLearningPhaseRecord[];
  readonly contextUsedTokens: number;
  readonly lessonId?: string;
  readonly reusedLessons: readonly AgentLearningLessonRecord[];
  readonly failure?: {
    readonly phase: AgentLearningPhaseId;
    readonly reason: string;
  };
}

const HUMAN_MAX_TOPICS = 256;
const HUMAN_MAX_ARRAY_ITEMS = 256;
const HUMAN_MAX_TEXT_LENGTH = 16_384;
const AGENT_MAX_EVIDENCE = 64;
const AGENT_MAX_EVIDENCE_LENGTH = 512;
const AGENT_MIN_BUDGET = 256;
const AGENT_MAX_BUDGET = 200_000;
const AGENT_PHASE_ORDER: readonly AgentLearningPhaseId[] = [
  'plan', 'execute', 'verify', 'reflect', 'extract_lesson', 'validate', 'store', 'reuse',
];

function digest(value: string, prefix: string): string {
  return `${prefix}${createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 24)}`;
}

function requireText(value: unknown, label: string, maxLength = HUMAN_MAX_TEXT_LENGTH): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || value.includes('\0')) {
    throw new Error(`${label} must be a bounded non-empty string`);
  }
}

function requireFiniteScore(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite score between 0 and 1`);
  }
}

function requireTimestamp(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer timestamp`);
  }
}

function requireBoundedArray(value: unknown, label: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value) || value.length > HUMAN_MAX_ARRAY_ITEMS) throw new Error(`${label} must be a bounded array`);
}

function clampScore(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1_000_000) / 1_000_000;
}

function validateTopic(topic: HumanLearningTopic, topicIds: ReadonlySet<string>): void {
  requireText(topic.id, 'topic.id', 128);
  requireText(topic.title, `topic ${topic.id} title`);
  requireBoundedArray(topic.prerequisites, `topic ${topic.id} prerequisites`);
  for (const prerequisite of topic.prerequisites) {
    requireText(prerequisite, `topic ${topic.id} prerequisite`, 128);
    if (!topicIds.has(prerequisite)) throw new Error(`unknown prerequisite: ${prerequisite}`);
    if (prerequisite === topic.id) throw new Error(`topic cannot depend on itself: ${topic.id}`);
  }
  for (const [label, values] of [['theory', topic.theory], ['practice', topic.practice], ['quiz', topic.quiz], ['exercises', topic.exercises]] as const) {
    requireBoundedArray(values, `topic ${topic.id} ${label}`);
  }
  topic.theory.forEach((value) => requireText(value, `topic ${topic.id} theory`));
  topic.practice.forEach((value) => requireText(value, `topic ${topic.id} practice`));
  if (topic.project !== undefined) requireText(topic.project, `topic ${topic.id} project`);
  requireText(topic.explainBackPrompt, `topic ${topic.id} explain-back prompt`);
  for (const exercise of topic.exercises) {
    requireText(exercise.id, `topic ${topic.id} exercise.id`, 128);
    requireText(exercise.instruction, `exercise ${exercise.id} instruction`);
    requireBoundedArray(exercise.expectedEvidence, `exercise ${exercise.id} evidence`);
    exercise.expectedEvidence.forEach((value) => requireText(value, `exercise ${exercise.id} evidence`));
  }
  for (const question of topic.quiz) {
    requireText(question.id, `topic ${topic.id} question.id`, 128);
    requireText(question.prompt, `question ${question.id} prompt`);
    requireText(question.correctAnswerDigest, `question ${question.id} answer digest`, 256);
  }
}

function topologicalOrder(topics: readonly HumanLearningTopic[]): HumanLearningTopicId[] {
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const state = new Map<HumanLearningTopicId, 'visiting' | 'visited'>();
  const ordered: HumanLearningTopicId[] = [];
  const visit = (id: HumanLearningTopicId): void => {
    const current = state.get(id);
    if (current === 'visited') return;
    if (current === 'visiting') throw new Error(`learning prerequisite cycle detected at: ${id}`);
    state.set(id, 'visiting');
    const topic = byId.get(id);
    if (!topic) throw new Error(`unknown learning topic: ${id}`);
    topic.prerequisites.forEach(visit);
    state.set(id, 'visited');
    ordered.push(id);
  };
  topics.forEach((topic) => visit(topic.id));
  return ordered;
}

function buildRoadmap(topics: readonly HumanLearningTopic[], mastery: Readonly<Record<string, number>>, ordered: readonly string[]): string[] {
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const selected = new Set<string>();
  const includePrerequisites = (id: string): void => {
    if (selected.has(id)) return;
    selected.add(id);
    byId.get(id)?.prerequisites.forEach(includePrerequisites);
  };
  topics.forEach((topic) => {
    if ((mastery[topic.id] ?? 0) < 0.8) includePrerequisites(topic.id);
  });
  return ordered.filter((id) => selected.has(id));
}

function buildReviews(topics: readonly HumanLearningTopic[], mastery: Readonly<Record<string, number>>, now: number): HumanLearningReview[] {
  return topics.map((topic) => {
    const score = mastery[topic.id] ?? 0;
    const intervalDays = score < 0.5 ? 1 : score < 0.7 ? 2 : score < 0.85 ? 4 : 7;
    return { topicId: topic.id, intervalDays, nextReviewAt: now + intervalDays * 86_400_000 };
  });
}

function createHumanPath(input: HumanLearningPathInput, mastery: Record<string, number>, now: number): HumanLearningPath {
  const topics = [...input.topics];
  const ordered = topologicalOrder(topics);
  const masteryGraph = topics.flatMap((topic) => topic.prerequisites.map((from) => ({ from, to: topic.id })));
  const gaps = topics.filter((topic) => (mastery[topic.id] ?? 0) < 0.8).map((topic) => topic.id);
  const learnerIdDigest = digest(input.learnerId, 'learner_');
  return {
    format: 'furypipe-human-learning-path/v1',
    learnerIdDigest,
    diagnostic: { learnerIdDigest, ratings: { ...mastery }, gaps },
    roadmap: buildRoadmap(topics, mastery, ordered),
    mastery: { ...mastery },
    masteryGraph,
    curriculum: topics,
    nextReviews: buildReviews(topics, mastery, now),
  };
}

export function createHumanLearningPath(input: HumanLearningPathInput): HumanLearningPath {
  requireText(input.learnerId, 'learnerId');
  requireBoundedArray(input.topics, 'topics');
  if (input.topics.length === 0 || input.topics.length > HUMAN_MAX_TOPICS) throw new Error('topics must contain between 1 and 256 items');
  const ids = new Set<string>();
  for (const topic of input.topics) {
    if (ids.has(topic.id)) throw new Error(`duplicate learning topic: ${topic.id}`);
    ids.add(topic.id);
  }
  input.topics.forEach((topic) => validateTopic(topic, ids));
  const mastery: Record<string, number> = {};
  for (const topic of input.topics) {
    const rating = input.selfRatings?.[topic.id] ?? 0;
    requireFiniteScore(rating, `self rating ${topic.id}`);
    mastery[topic.id] = clampScore(rating);
  }
  const now = input.now ?? Date.now();
  requireTimestamp(now, 'now');
  return createHumanPath(input, mastery, now);
}

export function recordHumanLearningAttempt(path: HumanLearningPath, attempt: HumanLearningAttempt): HumanLearningPath {
  requireText(attempt.topicId, 'attempt.topicId', 128);
  if (!path.mastery || !(attempt.topicId in path.mastery)) throw new Error(`unknown learning topic: ${attempt.topicId}`);
  if (typeof attempt.theoryCompleted !== 'boolean' || typeof attempt.practiceCompleted !== 'boolean') throw new Error('completion flags must be boolean');
  requireFiniteScore(attempt.exerciseScore, 'exerciseScore');
  requireFiniteScore(attempt.quizScore, 'quizScore');
  requireFiniteScore(attempt.explainBackScore, 'explainBackScore');
  requireTimestamp(attempt.at, 'attempt.at');
  const performance = (
    (attempt.theoryCompleted ? 1 : 0) * 0.15
    + (attempt.practiceCompleted ? 1 : 0) * 0.25
    + attempt.exerciseScore * 0.2
    + attempt.quizScore * 0.2
    + attempt.explainBackScore * 0.2
  );
  const previous = path.mastery[attempt.topicId] ?? 0;
  const mastery = { ...path.mastery, [attempt.topicId]: clampScore(previous * 0.65 + performance * 0.35) };
  const diagnostic = { ...path.diagnostic, ratings: { ...mastery }, gaps: path.curriculum.filter((topic) => (mastery[topic.id] ?? 0) < 0.8).map((topic) => topic.id) };
  const ordered = topologicalOrder(path.curriculum);
  return {
    ...path,
    diagnostic,
    mastery,
    roadmap: buildRoadmap(path.curriculum, mastery, ordered),
    nextReviews: buildReviews(path.curriculum, mastery, attempt.at),
  };
}

function requireAgentMemoryClass(value: unknown): asserts value is AgentMemoryClass {
  if (!['Working', 'Episodic', 'Semantic', 'Procedural', 'Project', 'User', 'Skills'].includes(value as string)) throw new Error('invalid agent memory class');
}

function validateAgentEvidence(evidence: unknown): evidence is readonly string[] {
  return Array.isArray(evidence) && evidence.length > 0 && evidence.length <= AGENT_MAX_EVIDENCE && evidence.every((item) =>
    typeof item === 'string' && item.length > 0 && item.length <= AGENT_MAX_EVIDENCE_LENGTH && !item.includes('\0'));
}

function validateAgentPhaseResult(result: AgentLearningPhaseResult): void {
  requireText(result.outputDigest, 'agent phase outputDigest', 256);
  if (!validateAgentEvidence(result.evidence)) throw new Error('agent phase evidence is invalid');
  if (!Number.isSafeInteger(result.consumedTokens) || result.consumedTokens < 0) throw new Error('agent phase token count is invalid');
}

function phaseRecord(phase: AgentLearningPhaseId, outputDigest: string, evidence: readonly string[], consumedTokens: number): AgentLearningPhaseRecord {
  return { phase, outputDigest, evidenceDigests: evidence.map((item) => digest(item, 'evidence_')), consumedTokens };
}

export function createInMemoryAgentLearningStore(): AgentLearningStore {
  const records = new Map<string, AgentLearningLessonRecord>();
  return {
    async store(record) {
      if (record.validation !== 'validated') throw new Error('only validated lessons may be stored');
      if (records.has(record.lessonId)) throw new Error('lesson already exists');
      records.set(record.lessonId, { ...record, evidenceDigests: [...record.evidenceDigests] });
    },
    async findReusableLessons(input) {
      return [...records.values()]
        .filter((record) => record.taskDigest === input.taskDigest && (input.memoryClass === undefined || record.memoryClass === input.memoryClass))
        .map((record) => ({ ...record, evidenceDigests: [...record.evidenceDigests] }));
    },
  };
}

function failedLearningResult(base: Omit<AgentLearningCycleResult, 'status' | 'failure'>, phase: AgentLearningPhaseId, reason: string): AgentLearningCycleResult {
  return { ...base, status: 'failed', failure: { phase, reason } };
}

export async function runAgentLearningCycle(input: AgentLearningCycleInput): Promise<AgentLearningCycleResult> {
  requireText(input.task, 'task');
  requireAgentMemoryClass(input.memoryClass);
  const budget = input.contextBudgetTokens ?? 10_000;
  if (!Number.isSafeInteger(budget) || budget < AGENT_MIN_BUDGET || budget > AGENT_MAX_BUDGET) throw new Error(`agent learning budget must be between ${AGENT_MIN_BUDGET} and ${AGENT_MAX_BUDGET}`);
  const taskDigest = digest(input.task, 'task_');
  const cycleId = input.cycleId ?? digest(`${taskDigest}:${input.memoryClass}`, 'cycle_');
  requireText(cycleId, 'cycleId', 128);
  const phases: AgentLearningPhaseRecord[] = [];
  const base = { format: 'furypipe-agent-learning-cycle/v1' as const, cycleId, taskDigest, memoryClass: input.memoryClass, phaseOrder: AGENT_PHASE_ORDER, phases, contextUsedTokens: 0, reusedLessons: [] as readonly AgentLearningLessonRecord[] };
  let contextUsedTokens = 0;
  let budgetExceeded = false;
  let priorPhase: AgentLearningPhaseId | undefined;
  let priorDigest: string | undefined;
  const invoke = async <T extends AgentLearningPhaseResult | AgentLearningLessonDraft | AgentLearningValidation>(callback: () => Promise<T>): Promise<T | undefined> => {
    try {
      const result = await callback();
      if (!Number.isSafeInteger(result.consumedTokens) || result.consumedTokens < 0) throw new Error('agent learning token count is invalid');
      if (contextUsedTokens + result.consumedTokens > budget) {
        budgetExceeded = true;
        throw new Error('agent learning context budget exceeded');
      }
      contextUsedTokens += result.consumedTokens;
      return result;
    } catch {
      return undefined;
    }
  };
  const context = (): AgentLearningPhaseContext => ({ cycleId, taskDigest, memoryClass: input.memoryClass, priorPhase, priorDigest, network: 'disabled', secrets: 'never_requested' });
  const record = (phase: AgentLearningPhaseId, result: AgentLearningPhaseResult): void => {
    validateAgentPhaseResult(result);
    phases.push(phaseRecord(phase, result.outputDigest, result.evidence, result.consumedTokens));
    priorPhase = phase;
    priorDigest = result.outputDigest;
  };
  const runPhase = async (phase: AgentLearningPhaseId, callback: () => Promise<AgentLearningPhaseResult>): Promise<AgentLearningPhaseResult | undefined> => {
    const result = await invoke(callback);
    if (!result) return undefined;
    try { record(phase, result); return result; } catch { return undefined; }
  };
  for (const phase of ['plan', 'execute', 'verify', 'reflect'] as const) {
    const result = await runPhase(phase, () => input.handlers[phase](context()));
    if (!result) return failedLearningResult({ ...base, phases: [...phases], contextUsedTokens }, phase, budgetExceeded ? 'context budget exceeded' : 'learning phase failed');
  }
  const draft = await invoke(() => input.handlers.extractLesson(context()));
  if (!draft) return failedLearningResult({ ...base, phases: [...phases], contextUsedTokens }, 'extract_lesson', budgetExceeded ? 'context budget exceeded' : 'lesson extraction failed');
  try {
    requireText(draft.lessonId, 'lessonId', 128);
    requireAgentMemoryClass(draft.memoryClass);
    requireText(draft.lessonDigest, 'lessonDigest', 256);
    requireText(draft.contentHandle, 'contentHandle', 1024);
    if (!validateAgentEvidence(draft.evidence)) throw new Error('lesson evidence is invalid');
  } catch {
    return failedLearningResult({ ...base, phases: [...phases], contextUsedTokens }, 'extract_lesson', 'lesson draft is invalid');
  }
  phases.push(phaseRecord('extract_lesson', draft.lessonDigest, draft.evidence, draft.consumedTokens));
  priorPhase = 'extract_lesson';
  priorDigest = draft.lessonDigest;
  const validation = await invoke(() => input.handlers.validate({ ...context(), draft }));
  if (!validation || typeof validation.validated !== 'boolean' || !validateAgentEvidence(validation.evidence)) return failedLearningResult({ ...base, phases: [...phases], contextUsedTokens }, 'validate', 'lesson validation failed');
  phases.push(phaseRecord('validate', digest(validation.validated ? 'validated' : 'rejected', 'validation_'), validation.evidence, validation.consumedTokens));
  if (!validation.validated) return failedLearningResult({ ...base, phases: [...phases], contextUsedTokens }, 'validate', 'lesson was rejected by validation');
  const recordToStore: AgentLearningLessonRecord = {
    format: 'furypipe-agent-lesson/v1', lessonId: draft.lessonId, memoryClass: draft.memoryClass,
    taskDigest, lessonDigest: draft.lessonDigest, contentHandle: draft.contentHandle,
    evidenceDigests: [...draft.evidence, ...validation.evidence].map((item) => digest(item, 'evidence_')),
    validation: 'validated', reuseCount: 0,
  };
  try {
    await input.store.store(recordToStore);
    phases.push(phaseRecord('store', digest(recordToStore.lessonId, 'store_'), ['validated lesson stored'], 0));
  } catch {
    return failedLearningResult({ ...base, phases: [...phases], contextUsedTokens }, 'store', 'validated lesson could not be stored');
  }
  let reusedLessons: readonly AgentLearningLessonRecord[];
  try {
    reusedLessons = await input.store.findReusableLessons({ taskDigest, memoryClass: input.memoryClass });
    phases.push(phaseRecord('reuse', digest(String(reusedLessons.length), 'reuse_'), ['reusable lesson lookup completed'], 0));
  } catch {
    return failedLearningResult({ ...base, phases: [...phases], contextUsedTokens }, 'reuse', 'reusable lesson lookup failed');
  }
  return { ...base, status: 'completed', phases: [...phases], contextUsedTokens, lessonId: recordToStore.lessonId, reusedLessons };
}

export { AGENT_PHASE_ORDER };
