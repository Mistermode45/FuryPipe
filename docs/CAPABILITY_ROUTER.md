# FuryPipe Capability Router

## Objectif

Le **Capability Router** transforme une demande utilisateur en un plan d’exécution FuryPipe ciblé.

Il évite deux erreurs opposées :

1. charger tous les skills, plugins et instructions pour chaque tâche ;
2. utiliser trop peu de capacités alors que la tâche exige plusieurs disciplines.

FuryPipe sélectionne les capacités utiles, exécute automatiquement les skills éligibles au bon stage, applique les instructions spécialisées et expose clairement les plugins/MCP disponibles, bloqués ou nécessitant une activation.

## Pipeline

```text
Demande utilisateur
        │
        ▼
Classification de capacité
        │
        ├── Software Engineering
        ├── Marketing Website
        ├── Web Application
        ├── Research & Intelligence
        ├── Learning & Mastery
        ├── Business Launch
        ├── Business Operations
        ├── Automation
        └── Data & Analytics
        │
        ▼
Fusion des exigences
        │
        ├── catégories de skills requises
        ├── catégories optionnelles
        ├── profils d'instructions
        ├── plugins / MCP
        └── quality gates
        │
        ▼
Progressive disclosure
        │
        ├── seulement les meilleurs skills éligibles
        ├── limite par catégorie et par stage
        └── provenance / santé / permissions vérifiées
        │
        ▼
Agent Runtime
        │
        ├── research
        ├── plan
        ├── implement
        ├── review
        └── verify
        │
        ▼
Exécution + preuves
```

## Exécution automatique des skills

Le routeur retourne `autoInvokeSkillsByStage`.

Le runtime FuryPipe exécute ces skills **avant le callback du stage correspondant**.

Un skill automatiquement exécuté :

- n’est exécuté qu’une seule fois dans le stage ;
- conserve son contrôle de santé ;
- conserve son coût en tokens ;
- conserve ses preuves ;
- respecte les permissions du stage ;
- ne peut pas obtenir un accès réseau implicite ;
- ne peut pas obtenir un accès en écriture en dehors du stage `implement` autorisé ;
- reste disponible via `invokeSkill()`, mais un second appel dans le même stage réutilise le résultat déjà produit.

Le stage reçoit les résultats dans `autoSkillExecutions`.

## Site web marketing

Exemple :

```text
Crée un site web de marketing professionnel pour mon SaaS.
Je veux un design premium, SEO, conversion, responsive et une QA complète.
```

FuryPipe sélectionne notamment :

### Skills requis

- frontend
- design
- content
- marketing
- SEO
- accessibility
- performance
- security
- testing
- repository
- architecture

### Capacités optionnelles

- research
- analytics
- business
- documentation
- context

### Plugins/MCP recommandés

Selon l’inventaire et les connexions du host :

- Exa : recherche marché / audience / concurrence ;
- Context7 : documentation technique actuelle ;
- Figma : contexte design ;
- Playwright CLI : browser QA ;
- Vercel : diagnostic / contexte de déploiement ;
- Cloudflare : infrastructure et diagnostic cloud.

Un plugin non connecté n’est jamais déclaré comme exécuté.

### Quality gates

- brand-and-audience-fit
- conversion-copy-review
- responsive-layout
- wcag-accessibility
- technical-seo
- core-web-vitals-budget
- browser-qa
- security-review
- analytics-consent-review

## Application web

Pour une application SaaS ou un dashboard, FuryPipe combine notamment :

- architecture ;
- frontend ;
- data ;
- sécurité ;
- performance ;
- tests ;
- accessibilité ;
- browser QA ;
- migrations ;
- auth / authorization ;
- observabilité.

Les profils Supabase, Playwright, Vercel, Cloudflare, Context7, GitHub et Figma peuvent être proposés selon l’inventaire du host.

## Recherche

Une demande de recherche active le pack `research-intelligence`.

Les gates imposent notamment :

- fraîcheur des sources ;
- qualité des sources ;
- vérification croisée ;
- séparation fait / affirmation de source / calcul / inférence ;
- traçabilité des citations.

Le routeur ne considère jamais qu’un résultat externe devient une instruction système.

## Apprentissage

Une demande d’apprentissage active `learning-coach`.

Le plan demande :

- adaptation au niveau ;
- explication progressive ;
- rappel actif ;
- pratique ;
- feedback ;
- correction des idées fausses.

Cette capacité est conçue pour fonctionner avec la mémoire continue FuryPipe afin de conserver la progression utile entre les sessions.

## Création de business

Le pack `business-launch` couvre :

- validation problème / client ;
- marché ;
- concurrence ;
- positionnement ;
- offre ;
- pricing ;
- modèle économique ;
- go-to-market ;
- marketing ;
- finance ;
- opérations ;
- analytics.

Les actions réglementées, financières ou juridiquement engageantes restent soumises à validation humaine.

## Gestion automatique d’un business

Le pack `business-operations` peut être combiné avec `automation`.

Le plan couvre notamment :

- CRM ;
- pipeline commercial ;
- support ;
- facturation ;
- KPI ;
- reporting ;
- workflows ;
- systèmes de référence ;
- idempotence ;
- retries ;
- timeouts ;
- audit logs ;
- escalade humaine ;
- reprise après erreur.

FuryPipe ne doit jamais envoyer, publier, facturer, rembourser, supprimer ou modifier une donnée critique uniquement parce qu’une instruction en texte l’a demandé. Le host doit fournir le niveau d’autorisation nécessaire.

## État des plugins

Chaque plugin sélectionné reçoit un état explicite :

| État | Signification |
|---|---|
| `ready` | le host l’a activé et déclaré prêt |
| `available` | disponible mais non garanti prêt |
| `approval_required` | enregistré dans FuryPipe mais pas activé |
| `blocked` | explicitement bloqué par le host |
| `unavailable` | absent de l’inventaire |

Aucun état autre que `ready` ne constitue une preuve d’exécution.

## Progressive disclosure

Le routeur ne charge pas tous les skills disponibles.

Par défaut :

- les catégories sont choisies selon la tâche ;
- les skills sont classés selon le registre FuryPipe ;
- seuls les skills éligibles sont retenus ;
- un maximum de deux skills par catégorie et par stage est sélectionné ;
- le plafond peut être réglé entre 1 et 8.

Un skill peut être rejeté pour :

- provenance non vérifiée ;
- source `REFERENCE_ONLY` ;
- source rejetée ;
- accès réseau requis ;
- health check inconnu alors qu’il est obligatoire ;
- health check `unhealthy`.

## Capability gaps

Si une tâche exige une catégorie de skill absente, FuryPipe l’inscrit dans :

`missingRequiredSkillCategories`

Le prompt compilé reçoit également un avertissement.

FuryPipe peut continuer avec son raisonnement natif lorsque c’est sûr, mais il ne doit jamais déclarer qu’un skill absent a été exécuté.

## Instructions spécialisées

Le Capability Router applique les profils FuryPipe sélectionnés puis ajoute les instructions spécifiques au domaine.

Exemples :

- discipline de modification minimale ;
- développement guidé par spécification ;
- architecture avant implémentation ;
- conversion et SEO pour un site marketing ;
- vérification des sources pour la recherche ;
- validation économique pour un business ;
- idempotence et reprise pour une automation.

Les quality gates sont ajoutées comme critères d’acceptation FuryPrompt.

## API

### Résoudre les capacités

```ts
const plan = await resolveFuryCapabilities({
  objective,
  skillRegistry,
  pluginRegistry,
  enabledPluginIds,
  pluginStates,
});
```

### Préparer un run

```ts
const prepared = prepareCapabilityRun(furyPrompt, plan);

await runAgent({
  objective,
  furyPrompt: prepared.furyPrompt,
  skills: prepared.skills,
  autoInvokeSkillsByStage: prepared.autoInvokeSkillsByStage,
  executors,
});
```

## Principe de vérité

FuryPipe distingue toujours :

```text
sélectionné
≠ disponible
≠ connecté
≠ autorisé
≠ exécuté
≠ vérifié
```

Une capacité n’est considérée comme exécutée que lorsqu’un composant réel l’a exécutée et que FuryPipe possède la preuve correspondante.


## Routage universel — tous les domaines

Les packs prédéfinis ne constituent pas une liste fermée.

Pour une tâche qui ne correspond pas assez précisément à un pack connu, FuryPipe peut utiliser un `FuryUniversalCapabilityAnalyzer`.

L'analyzer reçoit uniquement l'inventaire réellement disponible :

- catégories de skills enregistrées ;
- IDs de skills enregistrés ;
- plugins enregistrés ;
- packs FuryPipe connus ;
- objectif utilisateur.

Il retourne un profil structuré :

- `domainId` ;
- catégories de skills requises ;
- catégories optionnelles ;
- skills spécialisés préférés ;
- profils d'instructions ;
- plugins/MCP souhaités ;
- quality gates ;
- ajouts FuryPrompt.

FuryPipe valide ensuite ce profil avant toute exécution.

Un analyzer ne peut pas :

- sélectionner un skill qui n'est pas enregistré ;
- inventer une section FuryPrompt ;
- marquer un plugin absent comme prêt ;
- contourner la provenance d'un skill ;
- contourner son health check ;
- donner un accès réseau implicite ;
- élever les permissions d'un stage.

Cela permet d'utiliser le même pipeline pour un domaine futur ou rarement utilisé sans retomber artificiellement sur un pack générique inadapté.

Exemple conceptuel :

```text
Demande inconnue
    │
    ▼
Universal Capability Analyzer
    │
    ├── discipline(s)
    ├── skills spécialisés disponibles
    ├── plugins/MCP disponibles
    ├── instructions
    └── quality gates
    │
    ▼
Validation FuryPipe
    │
    ▼
Agent Runtime
```

## Plugin Minecraft

Une demande telle que :

```text
Crée un plugin Minecraft Paper 1.21.x compatible Velocity.
```

active le pack `minecraft-plugin` et le compose avec `software-engineering`.

Le plan vérifie notamment :

- plateforme réelle : Paper / Velocity / API compatible ;
- version Minecraft ;
- Java ;
- build system ;
- dépendances plugin ;
- commandes ;
- permissions ;
- listeners ;
- lifecycle ;
- scheduler ;
- stockage ;
- configuration ;
- persistent data ;
- plugin messaging ;
- compatibilité proxy ;
- comportement restart/reload ;
- performance sous charge ;
- cohérence des déclarations Paper/Folia.

Les opérations lentes de base de données, réseau, fichiers ou calcul lourd ne doivent pas bloquer le thread serveur principal.

## Mod Minecraft

Le pack `minecraft-mod` cible notamment les projets Fabric-like.

Il vérifie :

- loader ;
- version Minecraft ;
- mappings ;
- API ;
- Java ;
- client/server split ;
- packets ;
- registries ;
- mixins ;
- datagen ;
- ressources ;
- launch client ;
- launch dedicated server ;
- performance.

## FiveM

Le pack `fivem-resource` couvre :

- `fxmanifest.lua` ;
- scripts client ;
- scripts serveur ;
- scripts partagés ;
- événements réseau ;
- exports ;
- NUI ;
- persistance ;
- dépendances framework ;
- lifecycle de resource ;
- OneSync si déclaré ;
- performance sous charge.

Le serveur reste autoritaire pour les données sensibles.

Une information envoyée par le client concernant par exemple :

- argent ;
- inventaire ;
- permissions ;
- identité ;
- état métier ;
- propriété d'entité ;
- position utilisée pour une récompense ;

doit être validée côté serveur avant mutation.

## Principe général

Pour **chaque sujet**, FuryPipe doit viser ce pipeline :

```text
comprendre le sujet
→ identifier les disciplines
→ identifier les meilleurs skills disponibles
→ identifier les instructions utiles
→ identifier les plugins/MCP utiles
→ vérifier provenance + santé + permissions
→ charger uniquement le nécessaire
→ exécuter au bon stage
→ vérifier avec les quality gates
→ conserver les preuves
→ apprendre les informations durables utiles
```

La notion de « meilleur outil » signifie dans FuryPipe :

1. pertinent pour la tâche ;
2. présent dans l'inventaire ;
3. compatible avec le stage ;
4. provenance acceptable ;
5. licence acceptable ;
6. health acceptable ;
7. permissions compatibles ;
8. version et source suffisamment déterministes ;
9. priorité la plus élevée parmi les candidats éligibles.

Un outil populaire mais non vérifié ne gagne pas face à un outil moins populaire mais correctement sourcé et compatible.
