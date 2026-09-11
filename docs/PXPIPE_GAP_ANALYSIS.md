# Analyse d’écart pxpipe → FuryPipe

État basé sur le commit upstream épinglé `8ba82b713a1e823bc1c09b7a68e47f63caa7b426`, inspecté le 2026-09-11. `LOCAL_FIX` signifie que le checkout local contient une correction, pas que l’upstream est corrigé.

| Surface | État | Preuve | Limite / prochaine action |
|---|---|---|---|
| Proxy Anthropic/OpenAI/Gemini, SSE, backpressure | `UPSTREAM_PRESENT` | `src/core/proxy.ts`, `src/node.ts`, suite upstream 1 217 tests | Pas encore prouvé par providers réels |
| Windows build | `LOCAL_FIX` | Build upstream reproduit `C:\\C:\\...typescript\\bin\\tsc` ; `scripts/build.mjs` utilise maintenant `pathToFileURL` + `fileURLToPath` ; build 0 | macOS/Linux non testés |
| Pass-through hors scope modèle | `UPSTREAM_PRESENT` | Tests `cache-stability-e2e.test.ts`, applicabilité ; receipt opt-in local | Manifest/ExactGuard ne réécrivent pas les octets ; intégration plus large au pipeline encore ouverte |
| Exact values / hashes / secrets | `LOCAL_SLICE` | `ExactGuard` local détecte/manifeste ; modes automatiques sur `transformRequest` ; receipts opt-in des wrappers Anthropic/OpenAI | Externalize vers Recovery et redact autorisé restent à câbler dans le transform |
| Recovery byte-exact | `LOCAL_SLICE` | `src/core/recovery-store.ts` ; CAS/namespace/intégrité, quotas global/namespace, orphan/TTL GC et backup/restore testés | Pas BLAKE3, zstd, SQLite, chiffrement/ACL ni crash process réel ; handles pas encore émis automatiquement par transform |
| Cache alignment | `UPSTREAM_PRESENT` | Tests de stabilité/cache et `src/core/proxy.ts` | Planificateur multi-provider FuryPipe non ajouté |
| Instruction ledger / Context IR | `LOCAL_SLICE` | `src/core/instruction-ledger.ts`, `src/core/context-ir.ts`, tests dédiés | Blocs typés et ledger append-only locaux ; intégration au transform wire encore ouverte |
| Retrieval exact/source-aware | `LOCAL_SLICE` | `src/core/source-retrieval.ts` et `src/core/document-compiler.ts`, 5 tests dédiés | Recherche littérale et compilation UTF-8 locale ; multi-format, pagination externe et retrieval vectoriel optionnel restent ouverts |
| Policy/canary/circuit breaker | `PARTIAL_UPSTREAM` | Contrôles et telemetry upstream présents selon les modules | Matrice FuryPipe `ON/OFF/AUTO/LOCKED/...` non implémentée |
| Policy engine | `LOCAL_SLICE` | `src/core/policy-engine.ts`, 3 tests dédiés ; raw forcé sur contraintes dures | Pas encore branché au runtime proxy ni au canary provider |
| Content classification | `LOCAL_SLICE` | `src/core/content-classifier.ts`, classification sans plaintext et 3 tests | Pas encore de stratégies dédiées ni d’intégration automatique au wire |
| Dashboard | `PARTIAL_UPSTREAM` | Dashboard local upstream et `/proxy-stats` présents | Pas encore de Control Room FuryPipe/receipts/ExactGuard |
| OpenClaw | `BLOCKED_EXTERNAL` | Docs officielles consultées ; aucun runtime OpenClaw local utilisé | Construire adapter séparé + contract tests avec version réellement installée |
| MCP | `LOCAL_SLICE` | `src/mcp.ts`, `bin/mcp.js`, 6 tests ciblés, handshake réel `2025-11-25` | HTTP/OAuth/conformance et OpenClaw restent non testés |
| Licences | `PARTIAL` | `pnpm licenses list --json` : MIT 57, Apache-2.0 7, MIT OR Apache-2.0 4, ISC 3, MPL-2.0 2, autres déclarées dans `THIRD_PARTY_NOTICES.md` | Revue obligations/attribution complète avant publication |
| Security audit | `PARTIAL` | `pnpm audit --prod --audit-level high` sortie 0 | Audit statique/secrets/SBOM/CodeQL et multi-OS restants |
| CLI / package identity | `LOCAL_SLICE` | `package.json` = `furypipe@0.13.2`, bins `furypipe` + `pxpipe`; `npm pack --dry-run` = 141 entrées ; `doctor --json` sortie 0 | `npx furypipe@latest` impossible à prouver avant publication ; dist-tags non configurés |

## Choix

Le premier changement est additif et public (`./exact-guard`, `./recovery-store`) afin d’isoler la preuve d’exactitude et la récupération avant de toucher au chemin provider. Le renderer upstream reste inchangé par M3.

## Compromis

SHA-256 et bytes bruts maximisent la portabilité et évitent une nouvelle dépendance native. Le coût est l’écart au design cible BLAKE3/zstd ; cet écart est déclaré et ne doit pas être présenté comme une implémentation complète du Recovery Store V4.
