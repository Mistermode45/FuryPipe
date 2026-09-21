/**
 * Phase 6 public surface.
 *
 * Browser observations, coding state, permits and receipts remain data-only
 * until a process-local runtime boundary consumes them. Serialized copies
 * never become execution authority.
 */
export * from './browser-runtime.js';
export * from './coding-runtime.js';
export * from './patch-engine.js';
export * from './codegraph.js';
export * from './phase6-verification.js';
