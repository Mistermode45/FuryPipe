# FuryPipe — suivi des tâches

| ID | Milestone | État | Preuve / limite |
|---|---|---|---|
| M0 | Reality check, provenance, recherche, pilotage | DOING | Environnement, upstream et sources initiales vérifiés ; delta V4.3 à compléter |
| M1 | Fork upstream et baseline reproductible | DONE_LOCAL | SHA épinglé ; install/typecheck/tests/audit/build documentés ; CI multi-OS et provider réel non testés |
| M2 | Core protocol-safe et pass-through | PARTIAL_UPSTREAM | Routes/proxy upstream couverts par 1 217 tests ; ExactGuard/Context IR ne sont pas encore branchés au transform wire, receipt opt-in seulement |
| M3 | ExactGuard et Recovery Store | DONE_LOCAL | 13 tests dédiés verts sur ExactGuard, CAS et receipts ; manifests déterministes, CAS SHA-256 namespace-aware et receipt opt-in ; intégration ExactGuard complète au pipeline lossy et BLAKE3/zstd restent ouverts |
| M4 | Cache planner et cost/token oracles | PARTIAL_LOCAL | Planner consultatif typé ; pas de cost oracle/provider contract |
| M5 | Stratégies structurées/code/log/tool output | PARTIAL_LOCAL | `src/core/content-classifier.ts` classe JSON/code/log/tool output/Markdown avec ExactGuard et politique `allow`/`guarded`/`deny` ; stratégies de transformation dédiées encore ouvertes ; 3 tests |
| M6 | Retrieval et document compiler | PARTIAL_LOCAL | Index exact local et compilateur documentaire UTF-8 vers Context IR, avec classification/éligibilité conservatrice sans plaintext ; compilation multi-format et intégration wire encore ouvertes ; 5 tests |
| M7 | Optical Engine 2.0 | TODO | Non implémenté |
| M8 | Policy, routing, canary et circuit breaker | PARTIAL_LOCAL | Policy engine décisionnel et contraintes dures ; routing/canary/circuit breaker restent ouverts |
| M9 | OpenClaw et MCP | PARTIAL_LOCAL | MCP stdio local implémenté et testé ; OpenClaw, MCP HTTP et conformance externes restent bloqués |
| M10 | Dashboard et observabilité | PARTIAL_UPSTREAM | Dashboard upstream présent ; receipt local vérifiable ajouté, mais vues dashboard ExactGuard/Recovery/receipts FuryPipe non ajoutées |
| M11 | Sécurité, confidentialité et supply chain | PARTIAL | audit production vert ; matrice licences/SBOM/secrets/CI à compléter |
| M12 | Benchmarks et comparaisons | TODO | Aucun chiffre FuryPipe publié avant mesure |
| M13 | Release candidate | BLOCKED | CI multi-OS/arch, publication et artefacts externes non disponibles/autorisation requise ; tarball local dry-run vert |

Les états `DONE` ne sont utilisés qu'avec une preuve répertoriée.
