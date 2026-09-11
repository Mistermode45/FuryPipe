# Recherche FuryPipe

Les sources ci-dessous sont les premiers éléments vérifiés. La recherche normative complète et les changements de version seront documentés avant toute refonte majeure.

| Topic | Source | Primary? | Accessed | Version/date | Key facts | Impact on FuryPipe | Confidence |
|---|---|---:|---|---|---|---|---|
| Node release | https://nodejs.org/en/about/previous-releases | Oui | 2026-09-10 | v26.8.2 | Node 26 est la branche courante observée ; production doit distinguer Current/LTS | Runtime local installé en 26.8.2 | élevée |
| Node installer | https://nodejs.org/dist/v26.8.2/ | Oui | 2026-09-10 | v26.8.2 | MSI x64 et manifeste SHA disponibles | MSI téléchargé, hash et signature vérifiés | élevée |
| pxpipe upstream | https://github.com/teamchong/pxpipe | Oui | 2026-09-11 | main `8ba82b713a1e823bc1c09b7a68e47f63caa7b426` | Source obligatoire à auditer et pinner | Base de code locale | élevée |
| npm trusted publishers | https://docs.npmjs.com/trusted-publishers/ | Oui | 2026-09-11 | documentation courante | OIDC, provenance automatique sous conditions, pas de token long-lived recommandé | Préparer release sans publier | élevée |
| OpenClaw manifest | https://docs.openclaw.ai/plugins/manifest | Oui | 2026-09-11 | documentation courante | `openclaw.plugin.json` requis pour plugin natif ; formats bundle séparés | Adapter isolé et versionné | élevée |
| MCP authorization | https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization | Oui | 2026-09-11 | spec 2025-11-25 | OAuth/resource indicators pour HTTP ; stdio hors ce flux | Ne pas inventer l’auth HTTP | élevée |
| MCP base safety | https://modelcontextprotocol.io/specification/2025-03-26/index | Oui | 2026-09-11 | spec 2025-03-26 | Consentement, accès données et tool safety explicitement requis | Validation/consentement avant outils | élevée |

À compléter : licence package upstream et attribution, docs provider détaillées, Agent Skills, scanners, benchmarks, Docker, OpenClaw runtime et MCP conformance. Les résultats absents ne doivent pas être présentés comme validés.
