import type {
  ContinuousMemoryAfterTurnResult,
  ContinuousMemoryBeforeTurnResult,
  ContinuousMemoryEngine,
  ContinuousMemoryMessage,
  ContinuousMemoryScopes,
} from './continuous-memory.js';
import type { LongTermMemoryClass } from './long-term-memory.js';
import type {
  FuryPromptCompileInput,
  FuryPromptSectionValue,
  FuryPromptSections,
} from './fury-prompt.js';

export interface ContinuousMemoryTurnExecutionInput {
  readonly recall: ContinuousMemoryBeforeTurnResult;
  readonly memoryContextBlock: string;
  readonly furyPrompt?: FuryPromptCompileInput;
}

export interface ContinuousMemoryTurnExecutionResult<T = unknown> {
  /** Final assistant text for this completed turn. */
  readonly assistantMessage: string;
  /**
   * Optional bounded messages that genuinely occurred during this turn and
   * should be visible to the memory analyzer. Nothing is persisted verbatim by
   * Continuous Memory.
   */
  readonly learningMessages?: readonly ContinuousMemoryMessage[];
  /** Opaque host-owned result returned to the caller unchanged. */
  readonly value?: T;
}

export type ContinuousMemoryTurnExecutor<T = unknown> = (
  input: ContinuousMemoryTurnExecutionInput,
) => Promise<ContinuousMemoryTurnExecutionResult<T>>;

export interface ContinuousMemoryTurnInput<T = unknown> {
  readonly engine: ContinuousMemoryEngine;
  readonly conversationId: string;
  readonly turnId: string;
  readonly scopes: ContinuousMemoryScopes;
  /**
   * Real bounded conversation messages known by the host before the assistant
   * response. These are analyzer inputs, not durable transcript storage.
   */
  readonly messages: readonly ContinuousMemoryMessage[];
  readonly furyPrompt?: FuryPromptCompileInput;
  readonly recallTerms?: readonly string[];
  readonly memoryClasses?: readonly LongTermMemoryClass[];
  readonly now?: number;
  readonly execute: ContinuousMemoryTurnExecutor<T>;
}

export interface ContinuousMemoryTurnLearningSuccess {
  readonly status: 'completed';
  readonly result: ContinuousMemoryAfterTurnResult;
}

export interface ContinuousMemoryTurnLearningFailure {
  /**
   * Execution already completed. The runtime never retries the executor after
   * this state because doing so could duplicate external side effects.
   */
  readonly status: 'failed_after_execution';
  readonly reason: string;
}

export type ContinuousMemoryTurnLearning =
  | ContinuousMemoryTurnLearningSuccess
  | ContinuousMemoryTurnLearningFailure;

export interface ContinuousMemoryTurnResult<T = unknown> {
  readonly format: 'furypipe-continuous-memory-turn/v1';
  readonly recall: ContinuousMemoryBeforeTurnResult;
  readonly preparedFuryPrompt?: FuryPromptCompileInput;
  readonly assistantMessage: string;
  readonly value?: T;
  readonly learning: ContinuousMemoryTurnLearning;
}

const MAX_ASSISTANT_MESSAGE_CHARS = 1_000_000;
const MAX_EXTRA_LEARNING_MESSAGES = 64;

function sectionValues(value: FuryPromptSectionValue | undefined): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  return Object.freeze(typeof value === 'string' ? [value] : [...value]);
}

function injectMemoryContext(
  input: FuryPromptCompileInput | undefined,
  contextBlock: string,
): FuryPromptCompileInput | undefined {
  if (input === undefined) return undefined;
  if (!contextBlock) return input;

  const existing = sectionValues(input.sections.context);
  const context = Object.freeze([...existing, contextBlock]);
  const sections: FuryPromptSections = Object.freeze({
    ...input.sections,
    context,
  });
  return Object.freeze({
    ...input,
    sections,
  });
}

function validateExecutionResult<T>(
  value: ContinuousMemoryTurnExecutionResult<T>,
): ContinuousMemoryTurnExecutionResult<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('continuous memory turn executor returned an invalid result');
  }
  if (
    typeof value.assistantMessage !== 'string'
    || value.assistantMessage.trim().length === 0
    || value.assistantMessage.length > MAX_ASSISTANT_MESSAGE_CHARS
    || value.assistantMessage.includes('\0')
  ) {
    throw new Error('continuous memory turn assistantMessage must be a bounded non-empty string');
  }
  if (value.learningMessages !== undefined) {
    if (
      !Array.isArray(value.learningMessages)
      || value.learningMessages.length > MAX_EXTRA_LEARNING_MESSAGES
    ) {
      throw new Error('continuous memory turn learningMessages are invalid');
    }
    for (const message of value.learningMessages) {
      if (
        !message
        || typeof message !== 'object'
        || !['user', 'assistant', 'tool'].includes(message.role)
        || typeof message.content !== 'string'
        || message.content.trim().length === 0
        || message.content.includes('\0')
      ) {
        throw new Error('continuous memory turn learningMessages contain an invalid message');
      }
    }
  }
  return value;
}

function safeLearningFailure(caught: unknown): ContinuousMemoryTurnLearningFailure {
  const message = caught instanceof Error ? caught.message : String(caught);
  const normalized = message.replace(/[\r\n\t]+/g, ' ').trim();
  return Object.freeze({
    status: 'failed_after_execution',
    reason: normalized.length === 0
      ? 'continuous memory learning failed'
      : normalized.slice(0, 512),
  });
}

/**
 * Run one host-owned conversational turn with governed Continuous Memory.
 *
 * Recall happens before execution and therefore fails closed: the host executor
 * is not called when recall cannot be established safely.
 *
 * Learning happens after execution. A learning failure is returned as a receipt
 * instead of re-running or throwing the completed external action.
 */
export async function runContinuousMemoryTurn<T = unknown>(
  input: ContinuousMemoryTurnInput<T>,
): Promise<ContinuousMemoryTurnResult<T>> {
  if (!input || typeof input !== 'object') {
    throw new TypeError('continuous memory turn input is required');
  }
  if (!input.engine || typeof input.engine.beforeTurn !== 'function' || typeof input.engine.afterTurn !== 'function') {
    throw new Error('continuous memory turn requires a Continuous Memory engine');
  }
  if (typeof input.execute !== 'function') {
    throw new Error('continuous memory turn requires an executor');
  }

  const recall = await input.engine.beforeTurn({
    conversationId: input.conversationId,
    turnId: input.turnId,
    scopes: input.scopes,
    messages: input.messages,
    ...(input.recallTerms === undefined ? {} : { terms: input.recallTerms }),
    ...(input.memoryClasses === undefined ? {} : { memoryClasses: input.memoryClasses }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });

  const preparedFuryPrompt = injectMemoryContext(input.furyPrompt, recall.contextBlock);
  const execution = validateExecutionResult(await input.execute(Object.freeze({
    recall,
    memoryContextBlock: recall.contextBlock,
    ...(preparedFuryPrompt === undefined ? {} : { furyPrompt: preparedFuryPrompt }),
  })));

  const completedMessages = Object.freeze([
    ...input.messages,
    ...(execution.learningMessages ?? []),
    Object.freeze({
      role: 'assistant' as const,
      content: execution.assistantMessage,
    }),
  ]);

  let learning: ContinuousMemoryTurnLearning;
  try {
    const result = await input.engine.afterTurn({
      conversationId: input.conversationId,
      turnId: input.turnId,
      scopes: input.scopes,
      messages: completedMessages,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    learning = Object.freeze({ status: 'completed', result });
  } catch (caught) {
    learning = safeLearningFailure(caught);
  }

  return Object.freeze({
    format: 'furypipe-continuous-memory-turn/v1',
    recall,
    ...(preparedFuryPrompt === undefined ? {} : { preparedFuryPrompt }),
    assistantMessage: execution.assistantMessage,
    ...(Object.prototype.hasOwnProperty.call(execution, 'value') ? { value: execution.value } : {}),
    learning,
  });
}
