# FuryPipe V5 — compatibilité constatée

| Surface | État |
|---|---|
| Node.js | production `24.21.0` ; CI `22.23.2`, `24.21.0`, `26.8.2` ; package `>=22.14` |
| npm | 11.14.1 localement |
| pnpm | 10.21.0 imposé par `packageManager` |
| OS local | Windows 11 x64 |
| MCP | JSON-RPC 2.0, protocole `2025-11-25`, transport stdio local |
| Recovery | filesystem local, namespace explicite, SHA-256, quotas objet/namespace/global, GC orphan/TTL, backup/restore atomiques |
| Provider live | NON TESTÉ |
| MCP HTTP/OAuth | NON IMPLÉMENTÉ |
| OpenClaw | NON IMPLÉMENTÉ |
| Linux/macOS CI | matrice GitHub Actions active ; derniers runs de référence verts sur Ubuntu/Windows/macOS et Node 22/24/26 |

La matrice V5 considère Node 24 comme runtime de production. Node 22 reste
une compatibilité LTS supplémentaire et Node 26 la branche Current
supplémentaire. Node 20 n'est plus déclaré supporté : le code ne nécessite
plus cette compatibilité et la première exécution CI a confirmé qu'un test
Windows y était moins déterministe.

Le mode ExactGuard automatique par défaut est `balanced`. `safe` et
`coding-safe` sont disponibles ; `safetyMode: false` est l’opt-out explicite
pour les intégrations qui assument la perte. Un span protégé dans un bloc
live reste textuel ; l’externalisation vers Recovery et la redaction restent
des stratégies séparées, non activées silencieusement.

Une version de protocole ou un runtime absent de cette table n’est pas
implicitement compatible.
