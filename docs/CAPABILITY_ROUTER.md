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
