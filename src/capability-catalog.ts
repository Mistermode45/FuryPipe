/**
 * Public, non-executing Capability Catalog facade.
 *
 * This module exposes the static metadata/trust/scoring/catalog/activation
 * primitives needed to build a governed catalog without exposing runtime
 * execution authority.
 */

export * from './ecosystem/types.js';
export {
  normalizeCapabilityCandidate,
  serializeCapabilityCandidate,
} from './ecosystem/normalize.js';
export { serializeCapabilityManifest } from './ecosystem/importer.js';
export * from './ecosystem/registry.js';
export * from './fury-trust.js';
export * from './fury-score.js';
export * from './capability-catalog-resolver.js';
export * from './capability-activation.js';
export * from './universal-capability.js';
