# FuryPipe V5 — matrice centrale des exigences

Les statuts utilisés ici sont ceux du master V5. Une primitive présente mais
non atteignable n’est pas marquée DONE.

| Requirement | Implementation | Runtime | Test | CI | Security | Docs | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|
| M0 repository reality, baseline, branch | GitHub cible, baseline exacte, remotes et sources amont relevés | local Git | statique | non exécutée | revue provenance | SOURCE_LEDGER, UPSTREAM | DONE | `git ls-remote` ; branche `v5-production-hardening` à `26a9be93a765576ce338ed5b8d02bbff9f3f76fe` | aucun push |
| M1 hygiene/provenance/notices | docs de gouvernance, notices et ledger présents | local | statique | non exécutée | audit licence partiel | SOURCE_LEDGER, THIRD_PARTY_NOTICES | TESTED_LOCAL | `git diff --check`, inventaire licences antérieur | SBOM/attestation non produits |
| M2 duplicate IDs | identité scope/provenance/range/ordinal/hash | `createContextIR` réel | régression répétitive | non exécutée | déterministe, sans secret | ARCHITECTURE, AUDIT | TESTED_LOCAL | `tests/context-fabric.test.ts` | fuzz/property large à compléter |
| M2 Unicode compiler | segmentation grapheme, byte ranges UTF-8, CRLF | `compileDocument` réel | accents/emoji/combining/CRLF | non exécutée | pas de plaintext conservé dans IR | AUDIT, TESTING | TESTED_LOCAL | `tests/document-compiler.test.ts` | split structure-aware multi-format à compléter |
| M2 Instruction Ledger | scope, active/historical, supersedes, hash, dernier user | append/validate réels | conflit et historique | non exécutée | validation de provenance | ARCHITECTURE, AUDIT | TESTED_LOCAL | `tests/context-fabric.test.ts` | sérialisation V1 conservée |
| M3 ExactGuard runtime | gate `TransformOptions.exactGuard` avant lossy | `transformRequest` atteignable | UUID dans tool result, pass-through natif | non exécutée | aucun plaintext dans telemetry | AUDIT, DECISIONS | PARTIAL | `tests/keep-sharp.test.ts` | externalize/redact et activation par défaut à décider |
| M4 Recovery core | CAS SHA-256, namespace, atomicité, quotas namespace, TTL/GC, backup/restore sans écrasement | filesystem local | bytes, integrity, isolation, quota, GC, backup/restore | non exécutée | tenant namespace et limites | ARCHITECTURE, SECURITY | PARTIAL | `tests/recovery-store.test.ts` | quota global, chiffrement/ACL/SQLite/orphan GC à faire |
| M5 Context Fabric integration | classifier, IR, ledger et retrieval existent séparément | intégration runtime partielle | tests unitaires | non exécutée | provenance partielle | ARCHITECTURE | PARTIAL | modules `src/core/*` | wiring complet à poursuivre |
| M6 cache/policy | planner et policy typed | consultatif | tests policy | non exécutée | contraintes dures locales | docs/POLICY.md | PARTIAL | `tests/policy-engine.test.ts` | cost oracle/provider contract absent |
| M7 provider/model fabric | router historique, pas registry V5 complet | provider live non testé | tests historiques | non exécutée | auth route test local | COMPATIBILITY | PARTIAL | `src/core/provider-router.ts` | fallback/capability evidence à compléter |
| M8 MCP current + legacy | JSON-RPC stdio, 10 outils, alias `fetch_exact` exact bytes | stdio local | handshake/list/call/binary/range/delete | non exécutée | tailles bornées, metadata scalaires | COMPATIBILITY, docs/MCP.md | PARTIAL | `tests/mcp.test.ts` | HTTP sécurisé/OAuth non implémentés |
| M9 OpenClaw | aucun adapter actif | non atteignable | aucun runtime | non exécutée | docs seulement | COMPATIBILITY | TODO | aucune | blocker externe/runtime absent |
| M10 CI cross-platform | workflows présents, matrice Node 22/24/26, package smoke réel | Windows local + CI distante précédente | package/build/doctor/MCP local | nouvelle matrice en attente après push | audit local | TESTING | PARTIAL | `.github/workflows/ci.yml`, `scripts/package-smoke.mjs` | première CI : 5 jobs verts, Windows Node 20 instable sur nettoyage NTFS ; nouveau run requis |
| M11 agents/skills/MCP registry | recherches et docs sources seulement | non câblé | aucun harness complet | non exécutée | review manuelle | SOURCE_LEDGER | TODO | sources amont relevées | implémentation à poursuivre |
| M12 FuryPrompt compiler | non livré | non atteignable | aucun | non exécutée | non évaluée | — | TODO | aucune | scope distinct |
| M13 learning/knowledge | non livré | non atteignable | aucun | non exécutée | non évaluée | — | TODO | aucune | ne pas confondre memory locale et feature |
| M14 Web/Figma/Playwright/SEO | non livré | non atteignable | aucun | non exécutée | non évaluée | — | TODO | aucune | outils externes non nécessaires aux P0 |
| M15 Control Room V5 | dashboard upstream, vues V5 absentes | local partiel | tests historiques | non exécutée | metrics V5 absentes | — | PARTIAL | dashboard existant | exposition honnête à compléter |
| M16 supply chain/security | audit prod et notices existants | local | audit local antérieur | CodeQL/SBOM non exécutés | hardening partiel | SECURITY, THIRD_PARTY_NOTICES | PARTIAL | `pnpm audit` ; notices | aucun secret affiché |
| M17 benchmarks | fixtures/bench upstream | non certifié | benchmark V5 non exécuté | non exécutée | non applicable | — | TODO | aucune mesure nouvelle | ne publier aucun gain |
| M18 docs/i18n | docs FR de cette branche | local | statique | non exécutée | limites documentées | docs racine | TESTED_LOCAL | fichiers documentaires ci-dessus | EN/i18n produit à compléter |
| M19 release candidate | aucun release candidate | publication interdite | gates finales non rejouées | non vérifiée | release security incomplète | COMPATIBILITY | BLOCKED | absence CI/approbation publication | pas de merge, npm publish ou deploy |

## Ordre de continuation

Après ce checkpoint : intégrer Context Fabric au chemin réel, compléter les
policies ExactGuard externalize/redact avec Recovery, puis traiter les gates
M4/M8/M10 avant les surfaces OpenClaw et release.
