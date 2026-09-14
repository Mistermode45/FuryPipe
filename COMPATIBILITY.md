# FuryPipe V5 — compatibilité constatée

| Surface | État |
|---|---|
| Node.js | production `24.21.0` ; CI `22.23.2`, `24.21.0`, `26.8.2` ; package `>=22.14` |
| npm | publication pinne explicitement `npm@12.0.2` dans le workflow Release ; la préparation RC n’exécute aucune publication |
| pnpm | 10.21.0 imposé par `packageManager` |
| OS local | Windows 11 x64 |
| MCP | SDK officiel `@modelcontextprotocol/server@2.0.0`, stdio moderne `2026-07-28` + fallback legacy `2025-11-25` |
| Recovery | filesystem local, namespace explicite, SHA-256, quotas objet/namespace/global, GC orphan/TTL, backup/restore, AES-256-GCM optionnel, rekey, verrou inter-processus et reprise de résidus temporaires après crash |
| Provider live | aucun endpoint hébergé validé ; runtime d’évidence explicite présent avec disponibilité TTL/fail-closed, sans probe réseau implicite |
| MCP HTTP/OAuth | handler fetch-native sécurisé + listener Node opt-in loopback testés ; Host/Origin/Bearer/OAuth metadata présents ; Authorization Server/verifier hébergé et conformance réseau externe non validés |
| OpenClaw | adapter de découverte/config/doctor local présent ; runtime gateway réel NON TESTÉ |
| Dashboard navigateur | QA réelle Chromium/Firefox/WebKit : 48 cas source-bound (3 moteurs × LTR/RTL × 8 largeurs incluant les seuils CSS) ; audit WCAG manuel et terrain restent distincts |
| Web Studio navigateur | 120 cas réels source-bound via Playwright 1.63.0 : desktop Chromium/Firefox/WebKit + mobile Chromium/WebKit × 6 viewports × 4 locales ; Figma réel, performance terrain et déploiement restent non validés |
| Policy GitHub | `v5-production-hardening` est protégée par le ruleset actif `FuryPipe Production Hardening` ; PR obligatoire, checks requis, branche à jour, conversations résolues, suppressions et force-push bloqués ; la preuve doit être relue avant release |
| CI multi-OS | matrice GitHub Actions Ubuntu 24.04 / macOS 14 / Windows 2025 × Node 22.23.2 / 24.21.0 / 26.8.2 ; chaque candidat doit être revalidé sur son SHA exact |

La matrice V5 considère Node 24 comme runtime de production. Node 22 reste
une compatibilité LTS supplémentaire et Node 26 la branche Current
supplémentaire. Node 20 n'est plus déclaré supporté : le code ne nécessite
plus cette compatibilité et la première exécution CI a confirmé qu'un test
Windows y était moins déterministe.

Le mode ExactGuard automatique par défaut est `balanced`. `safe` et
`coding-safe` sont disponibles ; `safetyMode: false` est l’opt-out explicite
pour les intégrations qui assument la perte. Un span protégé dans un bloc
live reste textuel. `representationPolicy: 'externalize'` est disponible
explicitement avec un `recoveryStore` ; les identités de protocole protégées
échouent fermé vers le natif. La redaction reste non implémentée et aucune de
ces stratégies n’est activée silencieusement.

Une version de protocole ou un runtime absent de cette table n’est pas
implicitement compatible.


## Provider runtime V5

Le hardening V5 expose un runtime provider optionnel pour des observations de santé et un catalogue de prix fournis explicitement par l’hôte. Une observation périmée redevient `unknown`; aucun provider n’est déclaré sain par défaut. Les prix ne sont connus que pour une paire provider/modèle enregistrée exactement ; sinon le résultat reste `COST_UNKNOWN`.

Cette surface ne constitue pas une validation hébergée des providers et n’autorise aucun claim de disponibilité externe.
