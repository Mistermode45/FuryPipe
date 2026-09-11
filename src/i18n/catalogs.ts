import type { MessageCatalog } from './index.js';

export const EN_MESSAGES: MessageCatalog = Object.freeze({
  'status.ready': 'Ready',
  'status.partial': 'Partial',
  'status.notTested': 'Not tested',
  'status.costUnknown': 'Cost unknown',
  'benchmark.invalid': 'Benchmark comparison is invalid',
  'benchmark.executed': 'Benchmark executed',
  'security.blockedBySetting': 'Blocked by repository setting',
  'common.items': '{count} items',
});

export const FR_MESSAGES: MessageCatalog = Object.freeze({
  'status.ready': 'Prêt',
  'status.partial': 'Partiel',
  'status.notTested': 'Non testé',
  'status.costUnknown': 'Coût inconnu',
  'benchmark.invalid': 'La comparaison du benchmark est invalide',
  'benchmark.executed': 'Benchmark exécuté',
  'security.blockedBySetting': 'Bloqué par un réglage du dépôt',
  'common.items': '{count} éléments',
});

export const CORE_CATALOGS = Object.freeze({
  en: EN_MESSAGES,
  fr: FR_MESSAGES,
});
