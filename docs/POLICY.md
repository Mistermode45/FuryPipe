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



## Policy runtime local

`src/core/policy-runtime.ts` fournit maintenant trois primitives exécutables locales :

- cache exact en mémoire, borné par nombre d'entrées, taille par entrée, taille totale et TTL ;
- retrieval réel sur `RecoveryIndex`, avec résultats metadata-only (handle, offsets, ligne, compte) ;
- hybrid explicite : retrieval d'abord, puis callback de transformation fourni par l'hôte uniquement si une preuve retrieval existe.

Le cache utilise des clés SHA-256 dérivées de l'identité provider/modèle et des octets exacts du payload. Les valeurs sont copiées à l'entrée et à la sortie pour empêcher une mutation silencieuse du cache.

`evaluatePolicyFabric()` accepte `runtimeCapabilities` : `retrieval` et `hybrid` ne sont éligibles que si les exécuteurs correspondants sont explicitement présents. Leur absence reste visible au lieu d'être convertie en capacité verte.

Ce cache est un cache local FuryPipe. Il ne prétend pas être le prompt-cache natif d'Anthropic/OpenAI/Google et ne remplace pas leurs contrats provider.
