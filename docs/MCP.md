# MCP FuryPipe — transport local et HTTP

Le binaire `furypipe-mcp` fournit un serveur MCP local en transport stdio. Il
utilise le SDK officiel `@modelcontextprotocol/server` `2.0.0`. Le même
registre d’outils sert le protocole moderne `2026-07-28` et le fallback legacy
`2025-11-25`; le SDK sélectionne l’ère à l’ouverture de la connexion. Le
transport stdio ne lance pas de listener HTTP et ne lit pas de credential
provider.

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

Le binaire `furypipe-mcp-http` monte le même handler sur un vrai listener
`node:http`. Il est séparé du proxy d’inférence et ne démarre jamais par
défaut. Le mode CLI fourni est volontairement loopback-only et doit être
activé explicitement :

```text
FURYPIPE_MCP_HTTP_ALLOW_UNAUTH_LOOPBACK=1 \
FURYPIPE_MCP_HTTP_HOST=127.0.0.1 \
FURYPIPE_MCP_HTTP_PORT=47822 \
FURYPIPE_RECOVERY_ROOT=<directory> \
FURYPIPE_TENANT=default \
furypipe-mcp-http
```

`FURYPIPE_MCP_HTTP_HOST` et `FURYPIPE_MCP_HTTP_PORT` contrôlent uniquement
ce listener dédié ; le chemin exposé est `/mcp`. Le listener réel conserve les
limites, contrôles Host/Origin, médias, Bearer éventuel, annulation et délai
du handler fetch-native. Pour un bind non loopback, utiliser l’API
`listenMcpHttpNode()` avec un verifier Bearer OAuth et les allowlists adaptées ;
le binaire CLI ne transforme pas un token statique en authentification de
production.

Le module `dist/mcp-modern.js` expose deux surfaces HTTP fetch-native :

- `createModernMcpHandler()` : adaptateur SDK brut, pour un hôte qui possède
  déjà ses propres contrôles de frontière ;
- `createProductionMcpHandler()` : façade bornée qui exige un allowlist Host,
  valide Origin, méthode, `Content-Type`, `Accept`, taille de corps et
  JSON-RPC avant dispatch, propage l’annulation, impose un délai maximal et
  ajoute des en-têtes anti-cache/anti-MIME-sniffing/CORS contrôlés.

Pour un endpoint distant, fournir `bearerAuth` avec un vrai vérificateur OAuth
2.0 Resource Server. Le middleware officiel du SDK vérifie l’expiration et les
scopes puis transmet uniquement `AuthInfo` au serveur. Pour un outil local sans
authentification, `allowUnauthenticatedLoopback: true` est obligatoire et la
construction refuse tout hostname non loopback. `oauthMetadata` active, si
configuré par l’hôte, les routes de découverte RFC 9728/RFC 8414 ; FuryPipe ne
fabrique pas d’Authorization Server et ne stocke aucun credential.

Exemple minimal loopback, après build :

```ts
const handler = createProductionMcpHandler(store, {
  allowedHostnames: ['127.0.0.1', 'localhost'],
  allowUnauthenticatedLoopback: true,
});
```

L’hôte doit monter `handler.fetch` uniquement sur son endpoint MCP et fournir
un `Host` réel. Pour un déploiement non loopback, l’allowlist et
`bearerAuth.verifier` sont obligatoires ; un token statique dans un test ne
constitue pas un fournisseur OAuth de production.

Cette tranche prouve localement le registre commun, le transport stdio
dual-era, la frontière HTTP fetch-native, le listener Node réel et ses rejets négatifs. Elle ne vaut
pas une certification client hébergée, un test réseau multi-processus, ni une
intégration à un Authorization Server réel. Les limites de taille et de
validation restent celles de la surface legacy, en plus des validations de
schéma du SDK moderne.
