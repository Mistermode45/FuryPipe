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
