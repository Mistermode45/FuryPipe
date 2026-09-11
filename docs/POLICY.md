# Policy Engine — état local

`src/core/policy-engine.ts` produit une décision explicable sans appliquer de
transformation. Les contraintes dures gagnent toujours : byte/token exact,
opaque preserve, secret, opération non idempotente, SLA critique, provider
indisponible ou budget dépassé forcent `raw`.

Modes actuellement modélisés : `safe`, `balanced`, `aggressive`,
`coding-safe`, `logs`, `research`, `max-cache` et `offline-local`.

Le coût agrégé est explicitement marqué `estimated` sauf si l’appelant fournit
une mesure vérifiée. Le chemin `guarded-lossy` reste une recommandation ; il ne
modifie pas le body et ne remplace pas un provider contract test.

