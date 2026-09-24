# FuryPipe — final validation closure

Date de la passe : 2026-09-24.

Ce document décrit la clôture des validations locales et reproductibles de
FuryPipe. Le SHA exact de la passe finale est celui retourné par `git rev-parse
HEAD` et par la Draft PR #225 au moment du rapport ; il n'est volontairement
pas recopié ici afin d'éviter qu'un changement documentaire rende un digest
faux.

## Source de vérité GitHub

- Dépôt : `Mistermode45/FuryPipe`.
- Parent conservé : PR #224, `OPEN + DRAFT`, branche
  `codex/furypipe-final-completion`, HEAD parent
  `ebaa8e41fd2a5820fbd33fbfc04aecf8dbb4ca57`.
- Track de clôture : PR #225, `OPEN + DRAFT`, branche
  `codex/furypipe-final-validation-closure`, base exacte égale au HEAD parent.
- Aucun merge, release, tag, publication npm, déploiement, redémarrage de
  production, force-push ou réécriture d'historique n'est inclus.

## Classification finale des marqueurs

La recherche des états `BLOCKED`, `NOT_VERIFIED`, `NOT_EXECUTED`, `PARTIAL`,
`PENDING`, `TODO`, `FIXME` et `HACK` traverse `BASELINE.md`, `WORKLOG.md`,
`docs/`, `README*`, `src/`, `tests/`, `scripts/`, `bench/` et
`.github/workflows/`. Les occurrences ci-dessous sont des classes de preuve,
pas des suppressions de texte historique.

### A — automatisable maintenant : fermé

- Upgrade local : `scripts/upgrade-rollback-smoke.mjs` construit des tarballs
  depuis le ref courant et `v0.14.0`, installe A puis B, migre, démarre,
  redémarre, vérifie doctor/status/task-plan, préserve les données possédées
  et non possédées et ne publie rien.
- Rollback : le même harness vérifie le rollback de configuration et le
  rollback binaire vers A, avec conservation de l'état et réinstallation de
  B ; le contrat `productionRollback` reste explicitement non revendiqué.
- Crash/reprise : `scripts/recovery-resilience-smoke.mjs` tue de vrais
  subprocessus, réouvre un `RecoveryStore`, vérifie le digest durable, le
  lock/temp cleanup et l'état d'automation après crash.
- Migration interrompue : les points `after-temp-fsync`, `before-rename`,
  `after-rename` et `before-receipt` sont exercés par throw et kill. Chaque
  cas finit dans `old-valid` ou `new-valid`, sans état intermédiaire accepté.
- Wake automation : une occurrence one-shot est persistée, le processus est
  tué avant échéance, la reprise à `t=1000` la réclame, l'observation suivante
  retourne `observed` et `countRuns()` vaut exactement 1. La sémantique
  démontrée est donc un run-once coalescé avec coordination durable, pas une
  promesse générale d'exactly-once d'un effet externe.
- Unknown outcome : une automation armée puis tuée devient
  `outcome-unknown`, `automaticReplayAllowed=false` et une nouvelle claim est
  rejetée jusqu'à réconciliation explicite.
- Gateway local : `scripts/gateway-restart-smoke.mjs` vérifie start, auth,
  WebSocket connect/disconnect, origin invalide, payload boundary, kill,
  restart, reconnect, stale origin et shutdown gracieux.
- Clean room/self-host : `scripts/clean-room-package-smoke.mjs` exécute le
  binaire du tarball installé avec HOME/config/data/port isolés, vérifie
  setup, doctor, migration, plan, readiness, shutdown, restart, rollback et
  uninstall/reinstall.
- MCP/provider local : `scripts/local-contracts.mjs` exécute les suites
  locales HTTP/stdio/modern MCP, sécurité de fixture, transports provider,
  streaming, erreurs, retry/timeout/cancellation et frontières OpenClaw
  locales. Les suites spécialisées donnent la preuve contractuelle sans
  credential réel.
- Frontend/accessibilité : `scripts/accessibility-automation.mjs` exerce le
  DOM, labels/noms, landmarks, headings, ARIA, focus clavier, dialogs,
  contraste borné, reload, API, 503, fragment dégradé, route 404 et console.
  Le cross-browser réel couvre Chromium, Firefox et WebKit.
- Benchmark : `scripts/furybench-baseline-compare.mjs` construit la baseline
  compatible `24a2f7030c9fb7340229140f67e653688d5d039a`, mesure le candidat et
  compare le p95 avec la règle `candidate <= baseline * 1.25`.
- CI reproductible : les workflows dédiés couvrent clean room,
  upgrade/rollback, recovery/restart, contrats locaux, accessibilité et
  FuryBench. Les workflows sont action-pinned et les checks sont lus sur le
  SHA exact de la PR de clôture.

### B — dépendance externe : non automatisable depuis ce checkout

- credential et compte provider réel, trafic fournisseur facturable et
  validation de compte réel ;
- serveur MCP third-party réellement hébergé et client distant réel ;
- instance OpenClaw hébergée ou gateway d'un autre système ;
- Authorization Server/OIDC/issuer/JWKS et compte OAuth réel ;
- disponibilité du registre npm et collisions de version publiées.

Ces états ne sont pas promus par les fixtures locales.

### C — validation humaine ou autorisation : non automatisable sans décision

- revue visuelle humaine d'acceptation ;
- revue screen-reader réelle ;
- autorisation de release, merge, tag, publication npm ou déploiement ;
- rollback de production et redémarrage de production.

### D — historique ou texte de preuve : à conserver

Les `PARTIAL`, `BLOCKED`, `NOT_EXECUTED` et états analogues dans
`BASELINE.md`, `WORKLOG.md`, les rapports d'audit et les tests qui vérifient
un comportement fail-closed sont des archives ou des fixtures négatives.
Les effacer ferait perdre la provenance et pourrait transformer un état
non-observé en faux succès. Ils ne constituent pas des blockers A de cette
passe.

### E — non supporté ou hors périmètre explicite

- FuryPipe ne fournit pas d'Authorization Server ni de client authorization
  code/PKCE : le produit utilise un verifier/resource-server fourni par l'hôte.
  PKCE, refresh token et validation d'issuer relèvent donc du client/IdP
  externe, sans ajout d'un faux serveur OAuth dans ce track.
- Aucun service worker/PWA officiellement supporté n'a été trouvé dans la
  surface actuelle ; la résilience Dashboard/Web Studio est testée, mais une
  certification PWA n'est pas applicable.
- La durabilité après perte physique d'alimentation et la preuve complète de
  `fsync` de répertoire ne sont pas revendiquées. Les fautes d'écriture,
  rename, temp, lock stale, backup, symlink de configuration et reprise
  subprocess simulables sont couvertes ; les ACL Windows restent
  host-managed.

## Écritures atomiques et durabilité

Les preuves locales couvrent les temporaires privés, collisions d'objets,
cleanup après kill, lock stale, backup de manifest, recovery d'un manifest
renommé, symlink de config, lecture bornée, injection `fsync`/rename et
réconciliation `old-valid-or-new-valid`. Elles ne sont pas une preuve de
résistance à une coupure physique du courant sur chaque filesystem.

## Contrats externes volontairement séparés

- `MCP CONFORMANCE` désigne la conformance locale réelle ;
  `THIRD_PARTY_REMOTE_MCP` reste une preuve externe distincte.
- `PROVIDER CONTRACT` désigne les adaptateurs et transports HTTP/stream locaux
  testés avec erreurs 401/403/429/500, malformed, timeout, reset,
  cancellation et retry. `REAL_PROVIDER_CREDENTIAL` reste externe.
- `OAUTH CONTRACT` désigne la frontière resource-server/verifier et la
  redaction testées localement ; `REAL_EXTERNAL_OAUTH_ACCOUNT` reste externe.
- `OPENCLAW LOCAL` est observé par les tests de boundary/adapter ;
  `EXTERNAL HOSTED OPENCLAW` reste externe.

## Commandes de preuve

La passe finale doit conserver les résultats de :

```text
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run audit
pnpm run build
pnpm run package:smoke
pnpm run validation:upgrade-rollback
pnpm run validation:recovery
pnpm run validation:gateway
pnpm run validation:clean-room
pnpm run validation:local-contracts
pnpm run validation:accessibility
pnpm run validation:furybench
pnpm run browser:qa
pnpm run browser:webchat:qa
pnpm exec tsx scripts/security/check-actions-pinning.mjs
git diff --check
```

Les contrôles GitHub exact-head et leurs URLs restent la preuve hébergée de
la matrice OS/Node, du secret scan, des browsers, de la RC preparation et des
workflows dédiés. Un check d'un SHA précédent ne doit jamais être réutilisé
pour le SHA final.

## Limites et décision

Les blockers automatisables reproductibles sont fermés par les harnesses
ci-dessus. Le statut de release ne peut pas être promu par ce document : les
comptes/credentials, les environnements externes, l'acceptation humaine et
les autorisations de release restent des frontières explicites.
