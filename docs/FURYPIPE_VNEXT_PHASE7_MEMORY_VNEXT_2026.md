# FuryPipe VNext — Phase 7 Memory VNext

## Statut et périmètre

Cette tranche est empilée sur le HEAD Phase 6 validé :

```text
base: 51839182066a4520fed29cf396856495d8400fc3
track: vnext-phase7-memory-vnext
```

Le module `src/memory-vnext.ts` ajoute une boundary de gouvernance au-dessus
du `RecoveryStore` existant. Il ne crée ni deuxième `RecoveryStore`, ni
deuxième Gateway, ni deuxième policy engine. `LongTermMemoryStore` et
`ContinuousMemoryEngine` restent compatibles et inchangés : Memory VNext
expose un contrat plus strict pour les nouvelles intégrations qui ont besoin
de provenance, de contrôle utilisateur et d’injection sélective.

La tranche ne prétend pas fournir une suppression globale de données chez des
sources externes. Une demande d’oubli supprime ou marque les objets locaux
gouvernés et signale explicitement que les copies hors du `RecoveryStore` ne
sont pas contrôlées.

## 1. Modèle d’états

Les états ne sont pas aplatis :

```text
observation externe
    ↓ observe() — mémoire process-local, non persistée
candidate
    ↓ authorize() + accept()
accepted
    ↓ activate()
active
    ├─ search() → relevant hit
    ├─ inject() → selected context item, si budget/policy
    └─ disable() → disabled

requestForget()
    └─ forgotten tombstone → purge locale optionnelle, jamais de résurrection
```

Les invariants sont les suivants :

```text
observed != candidate
candidate != accepted
accepted != active
active != relevant
relevant != injected
injected != authoritative
forgotten request != physical deletion everywhere
deleted local index != all source copies deleted
```

`inject()` produit un bloc explicitement data-only. Même une mémoire active et
pertinente ne reçoit aucune autorité d’exécution.

## 2. Provenance persistée

Chaque révision durable contient :

- `memoryId` et `version` déterministes pour la clé sémantique et le scope ;
- `sourceKind` et `sourceIdDigest` ; aucun identifiant source brut n’est écrit ;
- `createdAt`, `updatedAt` et `lastConfirmedAt` ;
- `evidenceClass` et `acceptance` séparés ;
- classe mémoire, confiance, rétention, visibilité et scope digesté ;
- digests des termes et du contenu ;
- handle opaque vers le contenu chiffrable par le RecoveryStore ;
- raison de transition sous forme de digest ;
- révision précédente et état courant.

Les sources externes (`web-observation`, documents et messages externes) et
les inférences de modèle ne peuvent pas devenir une mémoire sans
`acceptedBy: user-confirmed` et une décision d’autorisation fournie par
l’hôte. Le contenu externe ne peut pas choisir sa rétention : `retention` est
un champ séparé fourni par le boundary gouvernée.

Les secrets ne sont jamais acceptés. Les données sensibles sont refusées par
défaut et ne peuvent être activées qu’avec une policy hôte explicite.

## 3. Persistence et crash semantics

Le module utilise les primitives existantes de `RecoveryStore` :

1. le contenu immuable est publié dans le namespace Recovery avec un handle ;
2. la révision mémoire est publiée par `putBounded()` avec une clé de mémoire,
   une version unique et des quotas atomiques ;
3. après publication, la révision sélectionnée est relue et comparée ; une
   course de versions est refusée ;
4. un contenu orphelin laissé par un échec avant publication de la révision
   reste récupérable par la GC Recovery ;
5. `requestForget()` publie d’abord une tombstone. Une interruption pendant
   le nettoyage local ne peut donc pas rendre l’ancienne mémoire active ; le
   receipt retourne `partial` au lieu de prétendre à une suppression complète.

Une tombstone conservée empêche la résurrection d’une même identité mémoire,
même après réouverture d’un nouveau `RecoveryStore` sur le même namespace.

Quotas explicites :

- texte candidat borné ;
- nombre de termes, résultats, items injectés et octets de contexte bornés ;
- nombre total de révisions, révisions par mémoire et sources révoquées borné ;
- limites RecoveryStore toujours actives en dessous (objet, namespace et store).

## 4. Sécurité et frontières de confiance

### Autorité

L’authorizer hôte reçoit uniquement des digests, IDs mémoire et opérations
bornées. Sans callback d’autorisation, toutes les opérations gouvernées sont
refusées par défaut. `observe()` ne persiste rien et ne crée aucun permit.

### Scope et confidentialité

Les recherches exigent un ensemble de scopes exacts. Le scope brut est
transformé en digest avant comparaison et persistance ; un scope utilisateur
ne peut pas être substitué à un autre par simple variation textuelle. La
visibilité doit correspondre au type de scope (`private` pour user/agent,
`workspace` pour workspace, etc.). Le caller reste responsable de ne fournir
que les scopes autorisés par son identité authentifiée.

### Poisoning et prompt injection

Le texte mémorisé reste une donnée. `inject()` ajoute provenance, délimiteurs
et un avertissement data-only ; aucune chaîne mémorisée ne peut modifier la
policy ou produire une autorité. Les claims externes et les inférences de
modèle restent leurs classes d’évidence propres, même après confirmation.

### Révocation et oubli

`revokeSource()` publie un marqueur durable qui bloque recherche, nouvelle
acceptation et activation pour la source digérée. Le marqueur n’efface pas une
copie du document ou du message source : le receipt le déclare.

`requestForget()` conserve une tombstone locale et rapporte séparément :

```text
localTombstonePersisted
localDeletion
externalCopies = not-controlled
sourceCopies = unknown
```

## 5. Sélection et Context Optimizer

Le chemin d’injection est :

```text
task / terms
  → lexical terms bornés
  → recherche par scope, état, rétention, source et classe
  → score déterministe de pertinence
  → representations metadata/summary/full
  → optimizeContext() existant
  → budget octets/items
  → provenance-preserving data-only context
```

Memory VNext ne dump jamais le store complet. Les éléments différés restent
visibles dans le plan de l’optimiseur avec la raison de budget ou de sélection.
Le budget final inclut l’en-tête de sécurité et fait l’objet d’un contrôle
UTF-8 après compilation.

## 6. Schémas critiques et fail-closed

Les frontières JSON rejettent :

- champs inconnus ;
- prototypes non standards ;
- symboles ;
- getters/setters ;
- tableaux sparse ;
- timestamps non sûrs, flottants ou négatifs ;
- digests et handles mal formés ;
- transitions incompatibles avec l’état courant.

Les records et receipts retournés sont gelés. Les erreurs d’intégrité de
payload, de révision, de scope ou de budget arrêtent l’opération au lieu de
sélectionner silencieusement un gagnant.

## 7. Gates Phase 7

| Gate | Contrat | Preuve attendue |
|---|---|---|
| 7.0 | architecture, provenance et trust boundaries | ce document + types discriminés |
| 7.1 | record, candidate, retention, scope, visibility | validation exacte + tests adversariaux |
| 7.2 | Recovery durable, quotas, tombstone, restart | tests local/restart et Recovery existant |
| 7.3 | index/retrieval borné, score déterministe, révocation | tests scope/source/TTL |
| 7.4 | injection sélective et budget partagé | tests Context Optimizer + byte bound |
| 7.5 | inspect/search/disable/forget/retention/source revoke | receipts et authorizer default-deny |
| 7.6 | poisoning, secrets, external evidence | tests d’injection et absence de secrets |
| 7.7 | status data-only | aucun contenu ni autorité dans l’observabilité |
| 7.8 | exact-head, build, package, CI multi-OS | preuves attachées au SHA final uniquement |

## 8. Non-objectifs et limites

- aucun embedding, vector database, provider ou extraction LLM implicite ;
- aucune synchronisation automatique avec des sources externes ;
- aucune suppression à distance d’un document, message, navigateur ou backup
  hors du RecoveryStore ;
- aucune attribution d’autorité au texte rappelé ;
- aucun runtime Paper/provider/client réel revendiqué par les tests locaux ;
- aucune fusion, release, tag, publication npm ou déploiement.

Le statut d’une gate ne sera déclaré `PASS` qu’après tests locaux, build,
package smoke, Secret Scan et CI sur le SHA exact de la PR Phase 7.
