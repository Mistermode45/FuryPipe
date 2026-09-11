# MCP FuryPipe — tranche locale

Le binaire `furypipe-mcp` fournit un serveur MCP local en transport stdio. Il
utilise le SDK officiel `@modelcontextprotocol/server` `2.0.0`. Le même
registre d’outils sert le protocole moderne `2026-07-28` et le fallback legacy
`2025-11-25`; le SDK sélectionne l’ère à l’ouverture de la connexion. Il ne
lance pas de listener HTTP, ne lit pas de credential provider et n’est pas
activé automatiquement.

Outils exposés :

- `index_text` : écrit du texte UTF-8 borné ;
- `index_bytes` : écrit des bytes fournis en base64 canonique ;
- `fetch_text` : restitue du texte UTF-8 ;
- `fetch_bytes` : restitue un tableau de bytes borné ;
- `fetch_bytes_base64` : restitue les bytes arbitraires en base64 ;
- `fetch_range` : restitue une plage half-open exacte en base64 ;
- `fetch_lines` : restitue une plage de lignes 1-based bornée ;
- `verify_handle` : vérifie l’existence et le digest ;
- `manifest` : restitue le manifest versionné ;
- `delete_handle` : supprime uniquement le handle adressé.

`fetch_exact` reste disponible comme alias legacy de `fetch_bytes_base64` :
son résultat est toujours base64, y compris pour un objet binaire, et n’est
jamais présenté comme du texte.

Limites : message 2 MiB, objet indexé 1 MiB, metadata scalaire et bornée,
range maximale 1 MiB, tableau bytes maximal 64 KiB et plage maximale de 10 000
lignes. Les erreurs ne recopient pas le texte soumis.
Le namespace provient de `FURYPIPE_TENANT` et est limité à `[A-Za-z0-9_-]`.

Exécution locale après build :

```text
FURYPIPE_RECOVERY_ROOT=<directory> FURYPIPE_TENANT=default furypipe-mcp
```

Le module `dist/mcp-modern.js` expose aussi `createModernMcpHandler()` pour
une intégration fetch-native testable. Il n’est pas monté en endpoint HTTP par
le binaire : host/origin validation, bearer auth/OAuth, resource indicators et
déploiement restent à intégrer dans l’application hôte.

Cette tranche prouve le registre commun et le transport stdio dual-era en
local, pas une certification complète HTTP/OAuth ni une validation client
hébergée. Les limites de taille et de validation restent celles de la
surface legacy, en plus des validations de schéma du SDK moderne.
