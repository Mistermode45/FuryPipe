# Context Fabric — état local

## Context IR

`src/core/context-ir.ts` produit des blocs typés sans conserver le texte source
en clair. Chaque bloc porte rôle provider, type sémantique, confiance,
provenance, hash SHA-256, ranges, exactness, volatilité, cache, effets de bord,
sensibilité, éligibilité, dépendances, références, tour logique et lineage.

## Classification locale

`src/core/content-classifier.ts` classe de façon déterministe un texte en
`plain_text`, `json`, `code`, `log`, `tool_output` ou `markdown`. Il retourne
uniquement des métadonnées, des signaux bornés et les classes ExactGuard : les
valeurs source ne sont pas conservées. Un contenu secret-like est `deny`, un
contenu contenant des valeurs protégées est `guarded`, et le reste est
`allow`. Cette surface est préparatoire ; elle ne réécrit pas encore les
requêtes provider.

## Retrieval exact

`src/core/source-retrieval.ts` fournit un index local de handles du Recovery
Store. La recherche est littérale et bornée : elle renvoie le handle, la
source, la ligne et les offsets UTF-16, jamais le texte trouvé. Les objets
binaires ou UTF-8 invalides restent récupérables par handle mais sont exclus
de la recherche texte. Aucun vecteur ne devient une source de vérité.

## Document compiler

`src/core/document-compiler.ts` découpe un document en blocs UTF-8 bornés,
classe chaque bloc et construit un Context IR sans conserver le texte dans le
résultat. Les contenus secrets deviennent `BYTE_EXACT_REQUIRED`/`deny`, les
contenus protégés `TOKEN_EXACT_REQUIRED`/`guarded`, et les autres restent
éligibles à une transformation future. Les offsets sont des offsets d’octets
UTF-8 ; les hashes IR restent vérifiables avec le texte source détenu par
l’appelant.

## Instruction Ledger

`src/core/instruction-ledger.ts` conserve le texte des instructions et son rôle
source. Une entrée `latest_user_request` doit rester de rôle `user`; un texte
system/developer ne peut pas être relabelisé silencieusement. Le ledger est
append-only par API et valide les hashes ainsi que le pointeur du dernier tour
utilisateur.

## Cache planner

`src/core/cache-planner.ts` ne modifie pas la requête. Il propose une
organisation stable/semi-stable/dynamique, force `raw_passthrough` en présence
d’un bloc protégé et signale quand un contrat provider est requis. Aucun
`cache_control`, ordre wire ou marqueur n’est réécrit par cette tranche.

## Intégration runtime M5

`src/core/context-fabric.ts` relie désormais ces primitives dans le chemin
réel `transformRequest` : le body JSON est parsé, ses surfaces textuelles sont
classées, un Context IR est construit, le ledger de provenance est validé, le
contrat de cache Anthropic est évalué et la policy produit une stratégie
estimée avant le transformeur historique. À la sortie, l’analyse est
complétée avec la stratégie observée (`raw` ou `guarded-lossy`), les tailles
d’entrée/sortie et l’état de vérification. `native-cache` reste une
recommandation du planner tant qu’un exécuteur de cache provider dédié n’est
pas branché.

`TransformInfo.contextFabric` est un diagnostic borné : il expose des
compteurs, catégories, états de validation et identifiants `ctx_` opaques,
mais ni ledger, ni IR complet, ni texte source. L’analyse ne possède pas le
body sortant et ne peut donc pas réordonner ou réécrire la conversation.

## Externalize ExactGuard

L’externalisation est une stratégie explicitement opt-in :

```ts
const result = await transformAnthropicMessages({
  body,
  model,
  options: {
    exactGuard: { representationPolicy: 'externalize' },
    recoveryStore,
    emitReceipt: true,
  },
});
```

Les spans sémantiques sont remplacés par des marqueurs contenant un handle
Recovery ; chaque handle est vérifié immédiatement par hash et relu avant que
la requête provider-shaped ne soit retournée. Les champs d’identité de
protocole (`id`, `tool_use_id`, `request_id`, etc.) ne sont jamais remplacés :
si un tel champ est protégé, le chemin échoue fermé et conserve la requête
native. Sans `recoveryStore`, l’opt-in externalize échoue également fermé.

La stratégie `redact` n’est pas exécutée par défaut et aucune donnée n’est
silencieusement supprimée. Le receipt opt-in porte la stratégie `externalize`
et les handles, sans plaintext ; `verifyCompressionReceipt` vérifie les octets
de la requête originale et provider-shaped, tandis que `RecoveryStore.verify`
et `get` vérifient la récupération exacte du span.

La policy et les coûts restent `estimated` tant qu’un oracle provider/modèle
et des coûts de retrieval vérifiés ne sont pas disponibles. Cette intégration
M5 ne marque donc pas M6 comme terminé et ne prétend pas fournir une preuve
provider hébergée.
