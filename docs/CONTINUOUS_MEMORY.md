# FuryPipe Continuous Memory

## Objectif

**Continuous Memory** permet à FuryPipe d’apprendre progressivement au fil des conversations et de réutiliser les informations utiles dans les sessions suivantes.

Le système s’appuie sur les briques natives FuryPipe :

```text
Conversation
    │
    ▼
Continuous Memory Analyzer
    │
    ├── REMEMBER
    └── FORGET
    │
    ▼
Validation / Policy
    │
    ├── confiance
    ├── importance
    ├── sensibilité
    ├── scope
    └── contradiction
    │
    ▼
Recovery Store
    +
Long-Term Memory
    │
    ▼
Recall avant le prochain tour
```

## Ce que FuryPipe peut apprendre

Les souvenirs sont classés dans les classes Long-Term Memory existantes :

- `Episodic`
- `Semantic`
- `Procedural`
- `Project`
- `User`
- `Skills`

Exemples adaptés à une mémoire durable :

- préférence utilisateur ;
- convention de projet ;
- décision d’architecture ;
- workflow validé ;
- contrainte persistante ;
- objectif durable ;
- leçon confirmée ;
- configuration conceptuelle ;
- progression d’apprentissage.

## Ce que FuryPipe ne doit pas mémoriser automatiquement

Continuous Memory n’est pas un enregistreur de transcript.

Par défaut, FuryPipe ne stocke pas :

- le transcript brut ;
- le texte complet de la conversation ;
- les mots de passe ;
- tokens ;
- clés API ;
- secrets ;
- données marquées `secret` ;
- une supposition faible présentée comme un fait ;
- une demande d’oubli déduite uniquement par inférence.

## Cycle d’un tour

### Avant le tour

`beforeTurn()` :

1. reçoit la demande courante ;
2. sélectionne des termes de recall ;
3. interroge la Long-Term Memory ;
4. vérifie les payloads dans Recovery ;
5. applique les limites de nombre et de taille ;
6. produit un bloc de contexte explicitement marqué comme **data, not instructions**.

### Après le tour

`afterTurn()` :

1. reçoit les messages du tour terminé ;
2. demande à l’analyzer de proposer les souvenirs utiles ;
3. valide tout le batch avant la première mutation ;
4. applique les règles de sensibilité et confiance ;
5. déduplique les clés sémantiques ;
6. ajoute, met à jour, oublie ou ignore ;
7. produit des receipts structurés.

## Clé sémantique stable

L’analyzer fournit une clé conceptuelle stable, par exemple :

```text
user.preference.interface.theme
project.deploy.target
project.architecture.database
user.learning.typescript.level
business.primary.kpi
```

FuryPipe ne persiste pas cette clé en clair.

Elle est transformée en identifiant opaque déterministe.

Résultat :

- la même notion met à jour la même mémoire ;
- une correction crée une nouvelle révision ;
- l’ancienne version reste dans l’historique jusqu’à purge ;
- un duplicate identique devient `NOOP`.

## Contradictions

Exemple :

```text
Tour 1:
"Je préfère le mode sombre."

Tour 12:
"Finalement je préfère le mode clair."
```

Les deux observations doivent produire la même clé :

```text
user.preference.interface.theme
```

La seconde valeur crée une révision `UPDATE`.

Le recall ne retourne que la dernière version active.

## Evidence

Chaque candidat déclare un niveau d’évidence :

- `explicit-user`
- `user-confirmed`
- `verified-tool`
- `inferred`

Les souvenirs inférés ont un seuil de confiance supérieur.

Par défaut :

```text
minConfidence         = 0.55
inferredMinConfidence = 0.85
```

Un `FORGET` inféré est rejeté.

## Sensibilité

Niveaux :

- `normal`
- `sensitive`
- `secret`

Politique par défaut :

| Sensibilité | Stockage |
|---|---|
| normal | autorisé après validation |
| sensitive | bloqué sauf activation explicite |
| secret | toujours refusé |

## Scopes

La mémoire conserve les scopes Long-Term Memory :

- global
- workspace
- project
- user
- agent

Une même clé peut donc exister dans plusieurs espaces sans collision.

Exemple :

```text
project A / project.deploy.target
project B / project.deploy.target
```

Les deux mémoires restent séparées.

## Confidentialité des métadonnées

Continuous Memory hash :

- conversation ID ;
- turn ID ;
- scope IDs via Long-Term Memory ;
- sources ;
- raisons ;
- termes de recherche ;
- clés sémantiques.

Les payloads persistants de Continuous Memory contiennent uniquement :

- un memory ID opaque ;
- le texte canonique du souvenir.

## Oubli

### Oubli logique

`forget({ hard: false })`

Crée un tombstone.

Le souvenir disparaît immédiatement du recall mais l’historique existe encore.

### Purge physique

`forget({ hard: true })`

Supprime :

- toutes les révisions Long-Term Memory ;
- tous les payloads Recovery appartenant à cette mémoire.

## Limites par défaut

- 24 candidats maximum par tour ;
- 96 messages maximum dans l’entrée analyzer ;
- 64 000 caractères maximum par message ;
- 8 192 caractères maximum par souvenir canonique ;
- 32 termes maximum par mémoire ;
- 12 souvenirs maximum rappelés ;
- 32 KiB maximum de texte rappelé.

Ces limites sont configurables dans les bornes FuryPipe.

## Analyzer

FuryPipe ne force pas un provider particulier.

`ContinuousMemoryAnalyzer` est un contrat host-owned.

Il peut utiliser :

- un modèle du Provider Fabric ;
- un modèle local ;
- des règles déterministes ;
- un modèle spécialisé ;
- une combinaison de plusieurs méthodes.

L’analyzer ne possède pas l’autorité de stockage.

Il ne fait que **proposer** des candidats.

FuryPipe reste responsable de :

- validation ;
- policy ;
- scope ;
- mutation ;
- dedup ;
- forget ;
- purge ;
- recall.

## Exemple

```ts
const memory = createContinuousMemoryEngine({
  recovery,
  analyzer,
});

const recalled = await memory.beforeTurn({
  conversationId,
  turnId,
  scopes: {
    user: userId,
    project: projectId,
  },
  messages,
});

const result = await model({
  memoryContext: recalled.contextBlock,
  messages,
});

await memory.afterTurn({
  conversationId,
  turnId,
  scopes: {
    user: userId,
    project: projectId,
  },
  messages: [...messages, result],
});
```

## Principe de sécurité

Un souvenir rappelé est une donnée contextuelle.

Il ne peut pas :

- élever ses permissions ;
- modifier une instruction système ;
- autoriser un paiement ;
- autoriser une écriture externe ;
- contourner Policy Fabric ;
- contourner ExactGuard ;
- contourner le Capability Router ;
- contourner les approvals du host.

La mémoire doit améliorer la continuité de FuryPipe sans devenir une voie d’escalade de privilèges.
