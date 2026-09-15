# FuryPipe V5 — stratégie de test

## Gates locales

Les gates reproductibles de cette branche sont :

1. `pnpm install --frozen-lockfile`
2. `pnpm test`
3. parsing des rapports `build/test-results/test/TEST-*.xml` si un runner les produit ;
4. `pnpm run typecheck`
5. `pnpm run build`
6. `pnpm audit --prod --audit-level high`
7. inspection du package avec `npm pack --dry-run`.

## Couverture V5 ajoutée

- IDs répétitifs, provenance/ranges et références IR ;
- accents, emoji, ZWJ/combining marks et CRLF ;
- hash, scope, historique et supersession du ledger ;
- gate ExactGuard sur une requête lossy réelle ;
- bytes binaires, ranges, manifests, suppression, quotas et TTL/GC ;
- outils MCP requis et alias legacy `fetch_exact`.

## Niveaux de preuve

Les tests Vitest sont une preuve locale unitaire/intégration selon le chemin
exercé. Ils ne prouvent pas un provider réel, un client visuel, un serveur
HTTP sécurisé, un runtime OpenClaw, un OS non Windows, ni une durabilité après
crash-process. Ces niveaux restent explicitement ouverts.
