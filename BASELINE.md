# Baseline pxpipe / FuryPipe — 2026-09-11

> [!NOTE]
> **Historical evidence snapshot.** This file records V5 hardening checkpoints at the time they were observed. It is not the current release-status page. For current public state, see [README.md](README.md), [CHANGELOG.md](CHANGELOG.md) and [docs/RELEASE_SECURITY.md](docs/RELEASE_SECURITY.md).


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
| Push de `v5-production-hardening` | PASS | branche distante à `14593fd02338a148bec5bc06d38a25c6ae483892` |
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
| M5 Context Fabric runtime ciblé | PASS local | `tests/context-fabric-runtime.test.ts` : 2 tests ; analyse attachée à `transformRequest`, stratégie native/raw observée et plaintext absent du diagnostic |
| Suite complète post-M5 runtime | PASS local | 90 fichiers ; 1 266 tests ; sortie 0 ; 14,72 s ; Vitest 5.0.0 |
| Typecheck/build post-M5 runtime | PASS local | `pnpm run typecheck`, `pnpm run build` ; sortie 0 ; `dist/core/context-fabric.js` et déclarations émises ; version CLI `0.13.2` |
| CI docs-only commit `df46a07` — run push `34634492559` | PASS | 9/9 jobs verts : Ubuntu/Windows/macOS × Node 22.23.2/24.21.0/26.8.2 |
| CI docs-only commit `df46a07` — run PR `34634496448` | PASS | 9/9 jobs verts sur la PR draft #2 ; package smoke inclus ; aucune fusion effectuée |
| ExactGuard externalize E2E | PASS local | 2 tests : span sémantique vers Recovery, vérification hash/relecture, receipt `externalize`, échec fermé sur identité protocolaire |
| Matrice CI M5 runtime — run push `34636151930` | PASS | 9/9 jobs verts sur Ubuntu/Windows/macOS × Node 22.23.2/24.21.0/26.8.2 |
| Matrice CI M5 runtime — run PR `34636158894` | PASS | 9/9 jobs verts sur la PR draft #2 ; package smoke inclus ; aucune fusion effectuée |
| M6 policy fabric ciblé | PASS local | 4 tests : cinq stratégies évaluées séparément, circuit ouvert, fallback explicite, canary/rollback/régression bornés |
| M7 provider/model fabric ciblé | PASS local | 5 tests registry/fallback + intégration `ContextFabricAnalysis`; registry locale, alias/famille modèle, raisons de routage, cache et `COST_UNKNOWN`; disponibilité reste `unknown` |
| M9 OpenClaw adapter ciblé | PASS local | 5 tests fixtures JSON5, surcharge de chemins, état absent/invalide, doctor metadata-only ; runtime réel `OPENCLAW_NOT_TESTED` |
| M11 Agent Fabric ciblé | PASS local | 4 tests : registre de décisions sourcées, plan read-only/scoped-write, budget borné et digest sans plaintext ; harness runtime non exécuté |
| Licences après JSON5/M11 | PASS local | `pnpm licenses list --json` : MIT 61, Apache-2.0 7, MIT OR Apache-2.0 4, ISC 3, MPL-2.0 2, autres inchangées dans `THIRD_PARTY_NOTICES.md` |
| Correctif découverte processus Windows | PASS local | `scripts/restart.mjs` borne PowerShell à 5 s et replie sur `Get-Process`; `tests/restart.test.ts` : 23/23 |
| Matrice CI commit `14593fd` — run push `34641522151` | PASS | 9/9 jobs verts : Ubuntu 24.04, Windows 2025, macOS 14 × Node 22.23.2, 24.21.0 et 26.8.2 |
| Matrice CI commit `14593fd` — run PR `34641526734` | PASS | 9/9 jobs verts sur la PR draft #2 ; package smoke inclus ; aucune fusion effectuée |
| M8 HTTP boundary ciblée | PASS local | `tests/mcp-http.test.ts` : 12/12 ; Host/Origin, médias, taille, JSON-RPC/routage, annulation, Bearer, OAuth metadata et fallback legacy |
| Export package M8 | PASS local | `scripts/package-smoke.mjs` importe `furypipe/mcp-modern` depuis le tarball installé et vérifie `createProductionMcpHandler` |
| Gates locales M8 | PASS local | suite `96 fichiers / 1 289 tests`, typecheck, build, audit (`No known vulnerabilities found`) et package smoke `furypipe-0.13.2.tgz` |

## Checkpoint fusionné — 2026-09-11

| Élément | Résultat | Mesure / preuve |
|---|---|---|
| Commit contrôlé | PASS | `c4f0d16c5033ac59ca84c8d562c9e68e638ad62d` ; branche locale et `origin/v5-production-hardening` identiques |
| PR de travail | OPEN DRAFT | PR #2 vers `v5-codex-review-clean` ; aucune fusion effectuée |
| Suite locale combinée après fusion | PASS | `97` fichiers ; `1 295` tests ; sortie 0 |
| Typecheck/build/audit/package smoke après fusion | PASS | sorties 0 ; `furypipe-0.13.2.tgz` contrôlé ; aucun publish |
| CI push du commit courant | PASS | run `34646766437` ; `9/9` jobs verts ; Ubuntu 24.04/Windows 2025/macOS 14 × Node 22.23.2/24.21.0/26.8.2 |
| CI PR du commit courant | PASS | run `34646770940` ; `9/9` jobs verts sur la PR draft |
| CodeQL push | PASS | run `34646766357` ; analyse JavaScript/TypeScript verte |
| Supply Chain push | PASS | run `34646766430` ; gates de chaîne d’approvisionnement vertes |
| Secret Scan push | PASS | run `34646766565` ; aucun secret détecté par le workflow |
| Benchmark contract push | PASS | run `34646766411` ; contrat de résultat benchmark vert ; aucune mesure de performance exécutée |
| Équivalents PR security/benchmark | PASS | Secret Scan `34646770825`, benchmark contract `34646770793` ; mêmes gates PR vertes |

La fusion a intégré le commit parallèle `138f125d45f648c6ba4406b4ce48e13377d4619c`
sans réécriture d’historique ni force push. Les fichiers réservés à l’autre
track n’ont pas été modifiés par la tranche M8. Au moment de ce checkpoint,
la façade était encore uniquement fetch-native : aucun Authorization Server
ou conformance externe ne devait être inféré de la preuve CI.

## M8 listener Node — 2026-09-11

| Élément | Résultat | Mesure / preuve |
|---|---|---|
| Listener Node HTTP réel | PASS local | `listenMcpHttpNode()` sur `node:http`, requête `fetch` locale vers `/mcp`, liste moderne reçue |
| Isolation de route/méthode/bind | PASS local | `tests/mcp-http-node.test.ts` : `3/3` tests ; `/other` = 404, GET `/mcp` = 405 avec `Allow`, bind non loopback sans auth refusé |
| Authentification CLI | FAIL-CLOSED | `furypipe-mcp-http` exige `FURYPIPE_MCP_HTTP_ALLOW_UNAUTH_LOOPBACK=1` ; aucun token statique accepté |
| Export package listener | PASS local | `furypipe/mcp-http-node` importé depuis le tarball installé par `scripts/package-smoke.mjs` |
| Suite complète après listener | PASS local | `98` fichiers ; `1 299` tests ; sortie 0 |
| Build/typecheck/audit/package smoke | PASS local | sorties 0 ; `furypipe-0.13.2.tgz` contrôlé ; audit `No known vulnerabilities found` |

Cette preuve couvre le montage réseau local du transport MCP. Elle ne couvre
pas un listener distant authentifié, un Authorization Server, un verifier OAuth
hébergé, une conformance multi-client ou une validation réseau externe.

## M4 Recovery Store chiffré — 2026-09-11

| Élément | Résultat | Mesure / preuve |
|---|---|---|
| Recovery ciblé | PASS local | `tests/recovery-store.test.ts` : 14/14 ; CAS, namespace, quotas, TTL/GC, orphan, backup/restore, corruption, rotation et reprise de manifest |
| Chiffrement au repos | PASS local | AES-256-GCM par objet ; envelope `FURYENC1`, nonce 12 octets, tag GCM 16 octets, AAD liée au digest ; plaintext absent du fichier ciphertext |
| Rotation de clés | PASS local | `rekey()` conserve la lecture de `key-v1`, publie `key-v2`, remplace la référence du manifest ; `gc()` supprime l’ancienne variante non référencée |
| Migration legacy | FAIL-CLOSED | une configuration avec chiffrement refuse plaintext, backup et restore tant que `rekey()` n’a pas été demandé explicitement |
| Atomicité / reprise | PASS local borné | hard-link non-écrasant après `sync()` ; sauvegarde de manifest récupérée par un nouveau store après interruption simulée |
| Permissions | PARTIAL | `0700` répertoires et `0600` fichiers tentés ; ACL Windows host-managed, non certifiées par ce checkout |
| Gates après M4 | PASS local | suite complète `100 fichiers / 1 318 tests`, typecheck, build, audit production et package smoke ; tarball `furypipe-0.13.2.tgz` |

Le statut M4 reste `PARTIAL` : aucune preuve n’est encore produite pour un
kill réel au milieu des opérations, plusieurs processus concurrents, une
corruption du filesystem ou un backend SQLite. Les clés sont un contrat de
l’application hôte et ne sont ni générées ni persistées par FuryPipe.

## M12 FuryPrompt Compiler — 2026-09-11

| Élément | Résultat | Mesure / preuve |
|---|---|---|
| Compilateur structuré | PASS local borné | `compileFuryPrompt()` public ; 15 sections canoniques ; niveaux explicites et inférence bornée |
| Prompt trivial | PASS local | un seul court `Task` reste la sortie compacte sans wrapper de titres |
| Exactitude / inspectabilité | PASS local | rendu déterministe, valeurs exactes conservées, taille UTF-8, digests source/sortie et manifest ExactGuard `safe` |
| Sécurité des bornes | PASS local | valeurs vides/non textuelles refusées, 256 valeurs par section, 1 MiB par valeur, 8 MiB cumulés |
| Contrats Context/Agent Fabric | IMPLEMENTED_NOT_WIRED | `integrationHints` metadata-only ; aucune exécution automatique de transform, outil, skill, MCP ou agent |
| Tests ciblés | PASS local | `tests/fury-prompt.test.ts` : 5/5 |
| Package export | PASS local | export `furypipe/fury-prompt` contrôlé par package smoke |

M12 reste `PARTIAL` : la compilation est atteignable et testée, mais le
compilateur n’est pas encore branché automatiquement au chemin
`transformRequest` ni à un Agent Harness exécutable.

## M11 Agent Runtime — 2026-09-11

| Élément | Résultat | Mesure / preuve |
|---|---|---|
| Harness de stages | PASS local borné | `runAgent()` appelle réellement les cinq callbacks dans l’ordre ; executor manquant et preuve vide bloquent |
| Permissions | PASS local | read-only par défaut ; `scoped-write` seulement sur `implement` avec `allowWrites` et chemins explicitement bornés |
| Skills / subagents | PASS local borné | callbacks exécutables, health `healthy/unhealthy`, budget imbriqué compté, réseau requis refusé |
| MCP permissions | PASS local | allowlist de méthodes par serveur ; méthode non autorisée ou serveur réseau bloqué |
| Budget / verification | PASS local | compteur de tokens borné ; dépassement et résultats invalides échouent le run |
| Handoff / resume | PASS local borné | snapshot sans objectif plaintext, digest vérifié, reprise à l’étape attendue |
| Mémoire | PASS local borné | store mémoire conserve uniquement statuts, étapes et digests de résultats |
| Tests ciblés | PASS local | `tests/agent-fabric.test.ts` 4/4 + `tests/agent-runtime.test.ts` 5/5 |

M11 reste `PARTIAL` : la preuve porte sur un harness local à callbacks fournis
par l’hôte. Aucun modèle réel, provider, worker interprocessus, handoff
distribué ou stockage durable Recovery n’est exécuté ici.

## M13 Learning and Knowledge — 2026-09-11

| Élément | Résultat | Mesure / preuve |
|---|---|---|
| Parcours humain | PASS local borné | diagnostic sans identifiant plaintext, roadmap topologique, curriculum théorie/pratique/exercices/projet/quiz/explain-back, graphe de maîtrise et reviews espacées |
| Mise à jour de maîtrise | PASS local borné | `recordHumanLearningAttempt()` valide les scores bornés et recalcule maîtrise, gaps et intervalle de révision |
| Cycle agent | PASS local borné | callbacks réels `Plan -> Execute -> Verify -> Reflect -> Extract lesson -> Validate -> Store -> Reuse` |
| Mémoire agent | PASS local borné | store mémoire refuse les leçons non validées et conserve seulement digests, classe, compteurs et handle opaque |
| Package export | PASS local | export `furypipe/learning` contrôlé par `pnpm run package:smoke` sur le tarball réel `furypipe-0.13.2.tgz` |

M13 reste `PARTIAL` : aucun graphe de connaissances durable, RAG sémantique,
fine-tuning, modèle réel, worker interprocessus ou service hébergé n’est
implémenté et aucune de ces capacités n’est revendiquée.

Les versions Node de cette matrice sont relevées depuis l’index officiel des
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

## Track B — Registre écosystème MCP — 2026-09-12

Baseline code : `v5-production-hardening` / `423bef619c4306557838142008a858db65b4eea1`. Aucun connecteur externe n’a été installé, authentifié, démarré ou appelé.

| Vérification | Résultat | Preuve / limite |
|---|---|---|
| Schéma de `MCP_REGISTRY.md` | PASS | 19 fiches, IDs uniques; source/version/licence, transport/auth, outils/scope, filesystem/réseau, coût, health/dernier test, décision et approbation présents |
| `pnpm install --frozen-lockfile` | PASS | lockfile inchangé; pnpm projet 10.21.0 |
| `pnpm run typecheck` | PASS | sortie 0 |
| `pnpm test` | PASS | 122 fichiers; 1 516 tests |
| `pnpm run audit` | PASS | aucune vulnérabilité connue dans les dépendances de production |
| `pnpm run build` | PASS | `dist` + binaires Node/MCP; version smoke 0.13.2 |
| `pnpm run package:smoke` | PASS | installation/export depuis le tarball local `furypipe-0.13.2.tgz`; rien publié |
| Intégrations SaaS/externes | NOT_EXECUTED | pas de compte/token, tool call, probe health ou coût facturable |

Le statut MCP du produit demeure `PARTIAL` : OAuth réel, audience/issuer du verifier hébergé, interopérabilité multi-client et permissions sur des instances réelles restent à valider hors de cet environnement. L’audit conformance existant est épinglé à `48aaec7373ba87195922d6757b099804da9de6bc` et ne vaut pas certification des commits MCP ultérieurs.

## Governed Provider Request Executor — 2026-09-13

Baseline de code : `v5-production-hardening` / `d6b1944404e23c5a76a36b4b8ef6def6d8386d53`. Branche de travail : `v5-codex-governed-provider-executor`.

| Vérification | Résultat | Mesure / preuve |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | pnpm projet 10.21.0; lockfile inchangé |
| `pnpm run audit` | PASS | aucune vulnérabilité de production connue |
| `pnpm run typecheck` | PASS | sortie 0 |
| Tests ciblés | PASS | 5 fichiers; 90 tests |
| `pnpm test` | PASS | 151 fichiers; 1 813 tests |
| `pnpm run build` | PASS | modules/déclarations, `dist/node.js`, `dist/mcp.js`; version 0.13.2 |
| `pnpm run package:smoke` | PASS | package smoke, benchmark-claim smoke, provider-attempt smoke sur tarball local |
| Transport provider réel | NOT_EXECUTED | fake transports locaux uniquement; aucun réseau/provider réel/credential |
| Package public export | NOT_CHANGED | intégration packaging réservée à une autre piste |
| GitHub CI / PR | PASS / OPEN DRAFT | PR #106 vers `v5-production-hardening`, head `dcf22da274abb67eb5a8c9c147d8fff3d87b23d1`; 20 contrôles passés dont matrice 9/9 OS × Node; dependency review et attestation du tarball `SKIPPED` conditionnellement; PR non fusionnée |
| Publication / release / merge / deploy | NOT_EXECUTED | hors scope sans approbation explicite |

## Production Provider Transports — 2026-09-13

Baseline d'intégration : `v5-production-hardening` / `bc92bef794df25b2a7c5418464a7fee0e4c695f8`. Branche dédiée : `v5-codex-production-provider-transports`. Le HEAD de cette branche comprend le commit de transports et une fusion normale du tip d'intégration; aucun historique n'a été réécrit.

| Vérification | Résultat | Mesure / preuve |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | pnpm projet 10.21.0; lockfile inchangé |
| `pnpm run audit` | PASS | aucune vulnérabilité de production connue |
| `pnpm run typecheck` | PASS | sortie 0 |
| `pnpm test` | PASS | 157 fichiers; 1 873 tests |
| `pnpm run build` | PASS | modules/déclarations, `dist/node.js`, `dist/mcp.js`; version smoke 0.13.2 |
| `pnpm run package:smoke` | PASS | package, benchmark-claim, provider-attempt et governed-provider smoke sur tarball local |
| `git diff --check` | PASS | aucun whitespace error |
| Provider HTTP réel | NOT_EXECUTED | tests uniquement via fetch injecté; aucun credential, requête fournisseur ni trafic provider |
| Export package public des transports | DEFERRED | aucun changement à `package.json` ni au lockfile; barrel source seulement |
| Portée PR | REVIEWED | 18 fichiers au total (16 fichiers de transports/executor/docs/tests + `BASELINE.md` et `WORKLOG.md`); fichiers réservés, manifest, lockfile et smoke script exclus |
| CI GitHub / PR | PASS / OPEN DRAFT | PR #111 vers `v5-production-hardening`, head `5e09fd436b750530319ea242b6d0c1ffac0b6d55`; 20 contrôles PASS, matrice 9/9; Dependency Review et attestation du tarball `SKIPPED` conditionnellement; PR non fusionnée |
| Publish / release / tag / production deploy | NOT_EXECUTED | explicitement hors de ce travail |

## FuryPipe VNext Phase 6 Browser + Coding Runtime — 2026-09-21

| Vérification | Résultat | Mesure / preuve |
|---|---|---|
| Source de vérité | PASS exact HEAD | PR #216 Phase 5 revalidée sur son head courant `672a57a83c33990eb2be71f656929a1ed7ed5ae5`; aucun fichier Phase 5 concurrent n’a été réécrit |
| Branche / parent | PASS exact HEAD | `vnext-phase6-browser-coding-runtime`; synchronisation normale avec le head Phase 5 via `8b0cbc532eee3ca5d66d45ba220a1891c5edfe1d`; descendant local Phase 5 `3beec507992f4cb698c2ceda4190dca9a2e6c6a5` préservé hors piste |
| Architecture / threat model | PASS local borné | `docs/FURYPIPE_VNEXT_PHASE6_BROWSER_CODING_RUNTIME_2026.md`; aucune seconde Gateway/Kernel/RecoveryStore, observations data-only, états unknown et frontières de publication explicites |
| Browser runtime | PASS local borné | lifecycle, permits WeakMap one-shot, SSRF/DNS mixte/redirect, observations non fiables, upload/download et receipts testés par `tests/browser-runtime.test.ts` |
| Coding runtime | PASS local borné | repository/worktree, sandbox, process shell-free borné, patch engine exact-base/exact-file, CodeGraph V1 et verification coordinator testés par les quatre fichiers Phase 6 |
| `pnpm install --frozen-lockfile` | PASS | lockfile inchangé |
| Tests ciblés Phase 6 | PASS | 4 fichiers ; 18 tests |
| `pnpm test` | PASS | 249 fichiers ; 2 865 tests ; sortie 0 |
| `pnpm run typecheck` | PASS | TypeScript principal + hosted MCP ; sortie 0 |
| `pnpm run build` | PASS | dist bibliothèque/déclarations + Node/MCP + version smoke `0.15.0` |
| Phase 6 package smoke | PASS | `scripts/phase6-package-smoke.mjs` ; six exports importés depuis un tarball installé |
| `pnpm run package:smoke` complet | PASS | package, Phase 6, benchmark-claim, provider-attempt et governed-provider smoke ; sorties 0 |
| `pnpm run audit` | PASS | aucune vulnérabilité connue dans les dépendances production |
| `git diff --check` | PASS | sortie sans erreur après les dernières écritures locales |
| CI GitHub exact HEAD | PASS / OPEN DRAFT | PR #217 ; base `672a57a83c33990eb2be71f656929a1ed7ed5ae5`; head `2a67a417a6ebeed2885c35284f7537c1519eea86`; merge state `CLEAN`; 15/15 checks PASS |
| Secret Scan / Benchmark Contract / RC Preparation | PASS exact HEAD | checks GitHub `gitleaks`, `contract` et `prepare` PASS sur le head `2a67a417a6ebeed2885c35284f7537c1519eea86` |
| Browser QA hébergée | PASS exact HEAD | Dashboard Browser QA et Web Studio Browser QA PASS ; Cross-Browser QA PASS après rerun du job hébergé, 117/117 cas cross-engine et 15/15 cas Gateway WebChat réels |
| Provider/Git/junction/production runtime | RUNTIME_VALIDATION_REQUIRED | les harnesses browser hébergés ne prouvent pas un provider OAuth réel, un Git provider réel, le DNS pinning d’un host concret, les junction/reparse multi-OS ou un déploiement production |
| Merge / release / tag / npm publish / deploy | NOT_EXECUTED | interdits par le périmètre de cette phase |

| Phase 7 Memory VNext | READY_TO_START / NOT_STARTED | gates Phase 6 exact-head vertes ; Phase 7 n’a pas encore modifié ce track |

## FuryPipe VNext Phase 7 Memory VNext — 2026-09-21

| Vérification | Résultat | Mesure / preuve |
|---|---|---|
| Base exacte | PASS | track empilé sur le HEAD Phase 6 validé `51839182066a4520fed29cf396856495d8400fc3` |
| Architecture / provenance | PASS local borné | `docs/FURYPIPE_VNEXT_PHASE7_MEMORY_VNEXT_2026.md`; pas de second RecoveryStore, Gateway ou policy engine |
| Record / candidate schema | PASS local | `src/memory-vnext.ts` : champs exacts, provenance digested, acceptance distincte, retention/visibility/state discriminés |
| Gouvernance | PASS local borné | authorizer host-owned default-deny ; external/model evidence exige `user-confirmed` ; observation non persistée |
| Durable store / restart | PASS local borné | révisions Recovery bornées, tombstone avant purge locale, blocage de résurrection après réouverture |
| Retrieval / context | PASS local borné | scope exact, source revoke, TTL, score déterministe et `optimizeContext()` partagé ; budget UTF-8 final contrôlé |
| Tests ciblés | PASS local | `tests/memory-vnext.test.ts` : 6/6 |
| Suite complète | PASS local | 250 fichiers ; 2 871 tests ; sortie 0 |
| `pnpm run typecheck` | PASS local | TypeScript principal + hosted MCP ; sortie 0 |
| `pnpm run build` | PASS local | bibliothèque/déclarations + Node/MCP ; version smoke `0.15.0` |
| `pnpm run audit` | PASS local | aucune vulnérabilité connue dans les dépendances production |
| Package smoke | PASS local | package, Phase 6, Phase 7, benchmark-claim, provider-attempt et governed-provider ; tarball installé contrôlé |
| CI GitHub / exact head implementation | PASS / OPEN DRAFT | PR #218 ; base `51839182066a4520fed29cf396856495d8400fc3`; head `0fd246b9b5afe5de90dccb0556a4c7470eeab807`; merge state `CLEAN`; 15/15 checks PASS |
| Secret Scan / Browser QA | PASS exact head implementation | `gitleaks`, `contract`, `prepare`, deux Chromium et Cross-Browser QA PASS ; matrice 9/9 OS × Node PASS |
| Copies externes / providers / runtime | NOT_EXECUTED | aucune source externe, provider, OAuth, déploiement ou suppression distante appelée |
| Merge / release / tag / npm publish / deploy | NOT_EXECUTED | interdits par le périmètre |

## FuryPipe VNext Phase 10 Gate 10.2 — 2026-09-24 — local completion slice

| Vérification | Résultat | Mesure / preuve |
|---|---|---|
| Source de vérité / exact head | PASS exact | parent PR #223 `OPEN + DRAFT`, base Phase 9 `c3c3f5370c10ee414e685b9f422cd4fd8a022e55`, parent Phase 10 `4de5c3e75df4de720cb330dadda86515042e79c6`; PR #224 `OPEN + DRAFT`, base `4de5c3e75df4de720cb330dadda86515042e79c6`, head `80cceadab1d60f5ce1130bae7f24aaac8dbd6dcc`; worktree isolé |
| Cause racine | CONFIRMÉE | `src/beta-readiness.ts` n’était consommé ni par `doctor`, ni par startup, ni par une migration/config governance |
| Beta config governance | PASS local borné | observation <=1 MiB, symlink/non-file/future schema fail-closed, migration explicit/idempotent, atomic temp+fsync+rename, rollback own-marker only |
| Startup / doctor | PASS local borné | `doctor` expose `betaConfig`/`betaReadiness`; exit 2 si required blocker; startup refuse config/runtime blocker; optional unprobed reste degraded/task-ready |
| Secret boundary | PASS local borné | tests vérifient absence de credential values; snapshot contient uniquement états/reasons/digests; aucun provider probe |
| Tests ciblés | PASS local | 3 fichiers / 21 tests beta+doctor ; `tests/node-security.test.ts` 14/14 |
| `pnpm install --frozen-lockfile` | PASS | exécuté sur le parent exact avant modification; lockfile inchangé |
| `pnpm run typecheck` | PASS | TypeScript principal + hosted MCP |
| `pnpm test` | PASS | 280 fichiers ; 3 208 tests ; sortie 0 |
| `pnpm run build` | PASS | dist bibliothèque/déclarations + Node/MCP ; version smoke `0.15.0` |
| `pnpm run package:smoke` | PASS | package, Phase 6, Phase 7, Phase 8 ACP, benchmark-claim, provider-attempt, governed-provider; migration/rollback depuis tarball |
| `pnpm run audit` | PASS | aucune vulnérabilité production connue |
| Secret scan | PASS hébergé / PARTIAL local | `gitleaks` absent localement; hosted Secret Scan exact-head PR #224 `35993617547` PASS |
| Browser QA | PASS hébergé exact-head | aucune surface visuelle modifiée; Dashboard `35993617584`, Web Studio `35993617772`, Cross-Browser `35993617660` PASS |
| CI exact-head | PASS hébergé | Benchmark Contract `35993617851`, RC Preparation `35993617553`, CI `35993617806`, matrice 9/9 PASS |
| Publication / mutation externe | NOT_EXECUTED | pas de merge, release, tag, npm publish, deploy, restart production, force push ou migration de données réelle |

## FuryPipe 0.16.0 RC — 2026-09-25 — Gateway installé + identité du paquet

| Vérification | Résultat | Mesure / preuve |
|---|---|---|
| Source de vérité | PASS exact | PR #226 `OPEN + DRAFT`, base `eed62617…`; head code `f41aa957619a0d4b468f81a5d627b4980f783ac1` |
| Gateway installé (bundle) | PASS 3 OS × 3 Node | `gateway start --json` ready, loopback, arrêt propre, 0 dynamic require |
| MCP stdio installé via Gateway | PASS 3 OS × 3 Node | bootstrap + cookie → WebSocket `tools.source.inspect.stdio` → enfant MCP stdio → inventaire → fermeture |
| Preuve négative bundle | FAIL attendu | `external: []` → `Dynamic require of "events" is not supported` |
| Dashboard Browser QA | PASS | budget CDP 30 s; local 39/39; hébergé PASS |
| Reproductibilité paquet | PASS | 9/9 jobs CI + RC Preparation : SHA-256 `99feb17f…`, 5 404 064 octets, content `30108a5f…`, 614 fichiers mode 644, 0 CR |
| Tests | PASS | 284 fichiers / 3 223 tests |
| typecheck / build / audit | PASS | aucune vulnérabilité production connue |
| package:smoke / clean-room / upgrade-rollback / recovery / gateway / local-contracts | PASS local + hébergé | 0.15.0 → 0.16.0 → 0.15.0, config et données préservées |
| FuryBench | PASS local + hébergé | 3 rounds appariés, p95 candidat ≤ baseline × 1,25, 0 régression; mesure hors provider/production |
| Accessibilité automatisée | PASS local (Chromium) + hébergé | lecteur d’écran humain non remplacé |
| Cross-browser / WebChat | PASS hébergé | Firefox/WebKit indisponibles localement |
| Registre npm | 0.16.0 absent | `latest` = 0.15.0 |
| Publication / mutation externe | NOT_EXECUTED | aucun merge, tag, release, publish, deploy |
