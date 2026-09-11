# Baseline pxpipe / FuryPipe — 2026-09-11

## Identité

- Commit upstream : `8ba82b713a1e823bc1c09b7a68e47f63caa7b426`
- Branche locale : `main`
- Date d’exécution : 2026-09-11
- OS local : Windows 11 x64
- Node local vérifié : 26.8.2 ; baseline production V5 : 24.21.0
- npm : 11.14.1
- pnpm : 12.3.4

## Résultats exécutés

| Commande | Résultat | Mesure / preuve |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | lockfile à jour ; sortie 0 ; 20,22 s ; pnpm projet 10.21.0 |
| `pnpm run typecheck` avant patch | PASS | sortie 0 ; 0,82 s |
| `pnpm test` avant patch | PASS | 78 fichiers ; 1 217 tests ; sortie 0 ; 14,18 s |
| `pnpm run build` avant patch | FAIL | sortie 1 ; 0,57 s ; chemin Windows `C:\\C:\\Users...typescript\\bin\\tsc` |
| `pnpm run build` après patch | PASS | sortie 0 ; 1,18 s ; 212 fichiers dist ; 28 014 788 octets ; smoke `0.13.2` |
| `pnpm exec vitest run tests/exact-guard.test.ts tests/recovery-store.test.ts` | PASS | 2 fichiers ; 7 tests ; sortie 0 ; 0,26 s |
| `pnpm run typecheck` après patch M3 | PASS | sortie 0 ; 0,72 s |
| `pnpm test` après Context Fabric/Policy/MCP | PASS | 84 fichiers ; 1 236 tests ; sortie 0 ; 13,67 s |
| `pnpm exec vitest run tests/receipt.test.ts` | PASS | 1 fichier ; 5 tests ; sortie 0 ; Vitest 5.0.0 |
| `pnpm test` après receipts | PASS | 85 fichiers ; 1 239 tests ; sortie 0 ; 14,05 s |
| `pnpm update --latest` | PASS | 7 dépendances déclarées actualisées ; lockfile régénéré ; pnpm projet 10.21.0 |
| `pnpm install --frozen-lockfile` après mise à jour | PASS | lockfile à jour ; sortie 0 ; 0,47 s |
| `pnpm test` après mise à jour dépendances | PASS | 85 fichiers ; 1 240 tests ; Vitest 5.0.0 ; sortie 0 ; 14,63 s |
| `pnpm run typecheck` après mise à jour dépendances | PASS | sortie 0 |
| `pnpm run build` après mise à jour dépendances | PASS | sortie 0 ; `dist/node.js` + `dist/mcp.js` ; smoke `0.13.2` |
| `pnpm test` après receipts OpenAI | PASS | 85 fichiers ; 1 241 tests ; sortie 0 ; 13,52 s ; Vitest 5.0.0 |
| `pnpm run typecheck` après receipts OpenAI | PASS | sortie 0 |
| `pnpm run build` après receipts OpenAI | PASS | sortie 0 ; `dist/node.js` + `dist/mcp.js` ; smoke `0.13.2` |
| `pnpm exec vitest run` M5/M6 ciblé | PASS | 3 fichiers ; 8 tests ; classifier, retrieval exact et document compiler |
| `pnpm test` après M5/M6 | PASS | 88 fichiers ; 1 249 tests ; sortie 0 ; 15,59 s ; Vitest 5.0.0 |
| `pnpm run typecheck` après M5/M6 | PASS | sortie 0 |
| `pnpm run build` après M5/M6 | PASS | sortie 0 ; `dist/node.js` + `dist/mcp.js` ; smoke `0.13.2` |
| `pnpm run typecheck` après receipts | PASS | sortie 0 |
| `pnpm run build` après receipts | PASS | sortie 0 ; `dist/node.js` + `dist/mcp.js` ; smoke `0.13.2` |
| `pnpm audit --prod --audit-level high` | PASS | `No known vulnerabilities found` ; sortie 0 ; 6,24 s |
| `pnpm outdated --format json` après mise à jour | PASS | objet vide `{}` ; aucune dépendance obsolète détectée par pnpm |
| `node dist/node.js doctor --json` | PASS | sortie 0 ; Node 26.8.2, npm 11.14.1, pnpm projet 10.21.0 détectés ; Docker/OpenClaw indisponibles |
| `node --input-type=module` public export smoke | PASS | `createCompressionReceipt` exporté par `dist/core/index.js` |
| `npm pack --dry-run --json` après M5/M6 | PASS | package `furypipe@0.13.2` ; 147 entrées ; 4 064 314 octets compressés / 16 459 325 décompressés ; Context Fabric, Policy, MCP stdio, receipts, classifier, retrieval et compiler inclus ; aucun tarball publié |
| `pnpm licenses list --json` après M5/M6 | PASS | MIT 57, Apache-2.0 7, MIT OR Apache-2.0 4, ISC 3, MPL-2.0 2, Apache-2.0 AND LGPL-3.0-or-later 1, CC0-1.0 1, BSD-3-Clause 1 |

## Continuation V5 — CI et runtime

| Élément | Résultat | Mesure / preuve |
|---|---|---|
| Push de `v5-production-hardening` | PASS | branche distante à `d03db733406efb003cb70007bab48b6623f9a892` |
| PR de vérification | PASS | draft PR #2 contre `v5-codex-review-clean`, sans merge |
| CI ancienne matrice | PARTIAL | 5 jobs verts ; Windows Node 20 a échoué sur `ENOTEMPTY` pendant le nettoyage de `tests/node-security.test.ts` |
| Test sécurité Windows ciblé après correction | PASS | 1 fichier ; 4 tests ; retries bornés de suppression NTFS |
| Package smoke réel | PASS | `npm pack`, installation du tarball dans un répertoire temporaire, CLI `--version`, `doctor --json`, handshake MCP |
| Matrice CI V5 — run push `34627466584` | PASS | 9/9 jobs verts : Node 22.23.2, 24.21.0 et 26.8.2 sur Ubuntu, Windows et macOS ; package smoke inclus |
| Matrice CI V5 — run PR `34627470246` | PARTIAL | 8/9 jobs verts ; Windows Node 22 a encore exposé `EBUSY` après `exit`, corrigé ensuite par attente `close` |
| Matrice CI V5 — run push `34628201836` | PASS | 9/9 jobs verts après attente `close` : Ubuntu/Windows/macOS × Node 22.23.2/24.21.0/26.8.2 |
| Matrice CI V5 — run PR `34628205790` | PASS | 9/9 jobs verts sur la PR draft, package smoke inclus |
| ExactGuard automatic modes | PASS local | modes `safe`/`balanced`/`coding-safe`, balanced par défaut, opt-out explicite ; suite complète 88 fichiers / 1 262 tests |
| Recovery global/orphan tranche | PASS local | quota partagé entre namespaces, queue d’écriture par racine, manifeste systématique, GC des objets sans manifeste ; 9 tests Recovery |
| MCP SDK dual-era ciblé | PASS local | `tests/mcp-modern.test.ts` : 1 fichier / 2 tests ; discovery `2026-07-28`, 11 outils, index/fetch exact et enveloppe requise |
| Suite complète post-MCP SDK | PASS local | 89 fichiers ; 1 264 tests ; sortie 0 ; 14,41 s |
| Typecheck/build post-MCP SDK | PASS local | `pnpm run typecheck`, `pnpm run build` ; sortie 0 ; `dist/mcp-modern.js` émis et version CLI `0.13.2` |
| Package smoke post-MCP SDK | PASS local | tarball réel installé ; CLI, doctor et handshake stdio legacy SDK validés ; `furypipe-0.13.2.tgz` |
| Matrice CI SDK — run push `34634021388` | PASS | 9/9 jobs : Ubuntu/Windows/macOS × Node 22.23.2/24.21.0/26.8.2 ; package smoke moderne + legacy inclus |
| Matrice CI SDK — run PR `34634025667` | PASS | 9/9 jobs sur la PR draft #2 ; même matrice et mêmes gates ; aucune fusion effectuée |

Les versions Node de cette matrice sont relevées depuis l'index officiel des
distributions Node.js le 2026-09-11. Le Node 26 local reste installé pour le
développement, mais n'est pas le runtime de production.

Les rapports JUnit `build/test-results/test/TEST-*.xml` ne sont pas produits par la configuration Vitest actuelle : `XML_REPORTS=0`. Le décompte ci-dessus vient donc de la sortie Vitest, pas d’un rapport XML fabriqué.

## Cause du build Windows

Dans `scripts/build.mjs`, la base `file://${tsPkgPath}` construisait une URL invalide sous Windows et produisait un chemin `C:\\C:\\...`. Le correctif local résout le binaire avec `pathToFileURL()` puis convertit avec `fileURLToPath()`. Ce correctif est local au checkout et ne prouve pas que le commit upstream l’intègre.

## Limites connues avant mesure

- Docker n'est pas installé localement.
- Les providers réels, credentials et appels payants ne sont pas utilisés sans préflight/autorisation.
- Les tests locaux ne prouvent pas la compatibilité client/provider hébergée, CI multi-OS ou publication npm.
- Le projet upstream conserve `packageManager: pnpm@10.21.0`; pnpm global 12.3.4 est installé mais n’est pas imposé au lockfile.
- `npm pack` émet trois warnings de configuration pnpm inconnue (`minimum-release-age`, `minimum-release-age-exclude`, `ignore-pnpmfile`) ; ils proviennent du `.npmrc` du projet et ne bloquent pas le dry-run.
- La validation macOS/Linux, Docker multi-architecture, OpenClaw, MCP HTTP, publication npm, provenance attestée et tests provider réels restent non exécutés.
