# FuryPipe — journal d’exécution

## 2026-09-11 — M0 checkpoint initial

- Workspace de départ : `C:\Users\loicd\Desktop\FuryPipe-Build` non Git, starter pack conservé.
- Dépôt cible cloné localement dans `FuryPipe` depuis `https://github.com/Mistermode45/FuryPipe.git` ; dépôt distant initialement vide.
- `origin` : `https://github.com/Mistermode45/FuryPipe.git`.
- `upstream` : `https://github.com/teamchong/pxpipe.git`.
- Branche locale : `main`, basée sur upstream `8ba82b713a1e823bc1c09b7a68e47f63caa7b426`.
- Environnement : Windows 11 x64, PowerShell 7.6.5, Git 2.54.0, Node.js 26.8.2, npm 11.14.1, pnpm 12.3.4 ; Docker absent.
- Baseline : installation frozen, typecheck et 1 217 tests upstream verts ; build upstream reproduit un défaut de chemin Windows.
- Correctif minimal dans `scripts/build.mjs` : résolution `fileURLToPath(pathToFileURL(...))` ; build, smoke test, typecheck et 1 236 tests verts après patch.
- M3 livré localement par tranches : `src/core/exact-guard.ts`, `src/core/recovery-store.ts`, exports package, puis receipts opt-in ; le store est SHA-256/raw bytes pour cette tranche. BLAKE3/zstd restent explicitement non implémentés.
- Audit production : `pnpm audit --prod --audit-level high` vert ; licences détectées via `pnpm licenses list --json`.
- Identité CLI locale : package `furypipe@0.13.2`, bins `furypipe` et alias legacy `pxpipe`; `doctor --json` détecte Node/npm/pnpm, outils et limites sans lire les secrets.
- CI `ci.yml` et workflow de release alignés sur Node `26.8.2`; publication npm toujours non exécutée.
- Context IR, Instruction Ledger et cache planner ajoutés dans `src/core`; MCP stdio local ajouté dans `src/mcp.ts` avec `furypipe-mcp`, handshake réel et 6 tests de contrat.
- Policy Engine ajouté dans `src/core/policy-engine.ts` : contraintes dures et décision `raw`/`native-cache`/`guarded-lossy`, sans mutation du proxy.
- Receipts opt-in ajoutés dans `src/core/receipt.ts` et `transformAnthropicMessages` : hashes SHA-256 des octets original/transformé, spans ExactGuard hashés, stratégie, handles et effets cache ; plaintext non conservé. Trois tests dédiés verts.
- Après receipts : suite complète 85 fichiers / 1 239 tests verte, typecheck vert, build Node + MCP vert ; export public vérifié et `npm pack --dry-run` vert avec 141 entrées. Le pack signale seulement trois clés `.npmrc` spécifiques à pnpm que npm ne connaît pas.
- Mise à jour complète des dépendances avec `pnpm update --latest` : `gpt-tokenizer 4.0.0`, `vitest 5.0.0`, `vite 8.3.0`, `wrangler 4.131.0`, `@cloudflare/workers-types 5.20260911.1`, `@napi-rs/canvas 1.0.9`, `@types/node 26.5.1`, `tsx 4.23.13` et lockfile synchronisé. `pnpm outdated --format json` est désormais vide.
- Validation après mise à jour : `pnpm install --frozen-lockfile`, 85 fichiers / 1 240 tests, typecheck, build, audit production, doctor et pack dry-run verts. Vitest 5 signale seulement une observation de performance sur ses isolates ; aucun échec.
- Receipts OpenAI ajoutés dans les wrappers Chat Completions et Responses via `TransformInfo.receipt`, sans modifier la sortie par défaut. Les tests receipts couvrent désormais Anthropic, les deux protocoles OpenAI et l'entrée UTF-8 invalide.
- Validation après ce branchement : suite complète 85 fichiers / 1 241 tests, typecheck et build Node + MCP verts ; aucune publication ni connexion provider réelle.
- M5 ajouté : `src/core/content-classifier.ts` classe JSON/code/log/tool output/Markdown, signale ExactGuard et retourne `allow`/`guarded`/`deny` sans plaintext.
- M6 ajouté : `src/core/source-retrieval.ts` indexe des handles et recherche littéralement avec offsets sans texte retourné ; `src/core/document-compiler.ts` découpe UTF-8 et construit un IR metadata-only.
- Validation M5/M6 : suite complète 88 fichiers / 1 249 tests, typecheck et build verts ; 8 tests ciblés classifier/retrieval/compiler, audit et package final à remesurer.
- Mesure finale M5/M6 : `npm pack --dry-run` = 147 entrées (4 064 314 octets compressés / 16 459 325 décompressés) ; inventaire licences actualisé (MIT 57, Apache-2.0 7, MIT OR Apache-2.0 4, ISC 3, MPL-2.0 2, autres déclarées dans les notices).
- Limite : CI macOS/Linux, Docker, publication et tests avec credentials/provider réels non exécutés.

## 2026-09-11 — M0/M2/M3/M4/M8 checkpoint V5 production hardening

- GitHub cible vérifié par `git ls-remote` ; le HEAD distant correspond exactement à `26a9be93a765576ce338ed5b8d02bbff9f3f76fe`.
- Remotes et sources amont vérifiés : pxpipe `8ba82b7…`, ECC `c9148d0…`, Matt Pocock skills `3cca18b…`.
- Branche locale créée sans écrasement : `v5-production-hardening`, commit de départ `26a9be93…`.
- M2 : IDs Context IR rendus uniques pour les chunks répétitifs ; compiler grapheme-safe, ranges UTF-8 et CRLF ; ledger avec scope/supersedes/historique.
- M3 : ExactGuard devient un gate réel de `transformRequest` lorsqu’il est configuré ; détection protégée = pass-through natif et diagnostic sans plaintext.
- M4 : Recovery Store ajouté : quotas optionnels objet/namespace, sérialisation des writes, TTL `expiresAt` et GC vérifiable.
- M8 : MCP stdio étendu à `index_text`, `index_bytes`, `fetch_text`, `fetch_bytes`, `fetch_bytes_base64`, `fetch_range`, `fetch_lines`, `verify_handle`, `manifest`, `delete_handle` ; `fetch_exact` reste un alias base64 exact.
- Tests ciblés : 5 fichiers, 26 tests verts ; typecheck vert.
- Limites : HTTP/OAuth MCP, OpenClaw, provider live, CI distante, chiffrement, backup/restore, SQLite et release restent non livrés.

## 2026-09-11 — MCP conformance boundary

- Spécification MCP officielle courante consultée : JSON-RPC 2.0, IDs de requête chaîne/entier non nul, notifications sans réponse, auth distincte pour HTTP et stdio.
- Dispatcher corrigé pour refuser les IDs absents, null ou non entiers sur les requêtes ; notifications restent sans réponse.
- ExactGuard custom rules bornées à 64 règles, patterns de 512 caractères et texte de 4 MiB maximum ; aucune valeur protégée n’est copiée dans le diagnostic.
- Tests ajoutés : frontière MCP et limites ExactGuard ; typecheck vert.
