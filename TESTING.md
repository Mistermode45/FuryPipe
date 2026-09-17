# FuryPipe V5 — stratégie de test

## Gates locales

Les gates reproductibles de cette branche sont :

1. `pnpm install --frozen-lockfile`
2. `pnpm test`
3. `pnpm run typecheck`
4. `pnpm run build`
5. `pnpm run package:smoke`
6. `pnpm run audit`
7. `pnpm run browser:qa`
8. inspection du package avec `pnpm pack` ou `npm pack --dry-run`.

`pnpm test` utilise Vitest et publie son résultat dans la sortie console ; le
script standard ne produit pas de rapports JUnit `build/test-results/test/`.
Un reporter XML ajouté explicitement doit être traité comme une preuve
supplémentaire, pas comme une sortie garantie du gate par défaut.

Sur Windows, les deux smoke tests Chromium ciblés peuvent être exécutés
séparément :

```powershell
pnpm exec tsx scripts/dashboard-browser-qa.ts
pnpm exec tsx scripts/web-studio-browser-qa.ts
```

La QA Web Studio découvre `CHROME_BIN`, les chemins Chrome Windows standards
et `where.exe`. Elle reste une matrice Chromium partielle ; `pnpm run
browser:qa` conserve la preuve multi-moteurs via Chromium, Firefox et WebKit.

## Couverture V5 ajoutée

- IDs répétitifs, provenance/ranges et références IR ;
- accents, emoji, ZWJ/combining marks et CRLF ;
- hash, scope, historique et supersession du ledger ;
- gate ExactGuard sur une requête lossy réelle ;
- bytes binaires, ranges, manifests, suppression, quotas et TTL/GC ;
- outils MCP requis et alias legacy `fetch_exact`.

## Niveaux de preuve

Les tests Vitest sont une preuve locale unitaire/intégration selon le chemin
exercé. Les scripts Chromium et cross-browser sont une preuve navigateur
automatisée structurale, pas une validation lecteur d’écran ou une revue
visuelle humaine. Ces gates ne prouvent pas un provider réel, un runtime
OpenClaw, un hosted MCP/OAuth, une durabilité après crash-process ni une
validation production.
