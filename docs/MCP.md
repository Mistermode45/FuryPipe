# MCP FuryPipe — tranche locale

Le binaire `furypipe-mcp` fournit un serveur MCP local en transport stdio. Il
ne lance pas de listener HTTP, ne lit pas de credential provider et n’est pas
activé automatiquement.

Outils exposés :

- `index_text` : écrit un texte borné dans le Recovery Store et retourne un handle SHA-256 ;
- `fetch_exact` : restitue les bytes exacts d’un handle ;
- `fetch_lines` : restitue une plage de lignes 1-based bornée ;
- `verify_handle` : vérifie l’existence et le digest du contenu.

Limites : message 2 MiB, texte indexé 1 MiB, metadata scalaire et bornée,
plage maximale de 10 000 lignes. Les erreurs ne recopient pas le texte soumis.
Le namespace provient de `FURYPIPE_TENANT` et est limité à `[A-Za-z0-9_-]`.

Exécution locale après build :

```text
FURYPIPE_RECOVERY_ROOT=<directory> FURYPIPE_TENANT=default furypipe-mcp
```

Cette surface est une compatibilité stdio locale, pas une certification MCP
HTTP. Pour HTTP, l’authentification doit suivre la spec MCP courante et ses
resource indicators ; aucune implémentation HTTP n’est présente dans cette
tranche.

