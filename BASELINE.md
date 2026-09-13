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
