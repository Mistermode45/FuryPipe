# FuryPipe

> **FR** — Orchestration de contexte, agents, skills, MCP, mémoire et providers pour workflows IA exigeants.  
> **EN** — Context, agent, skill, MCP, memory and provider orchestration for demanding AI workflows.

FuryPipe est un runtime et une boîte à outils **production-oriented** pour préparer, gouverner, exécuter et vérifier des workflows IA complexes. Le projet reste en phase de hardening : les APIs évoluent encore et **aucune publication npm / release / déploiement final n’est autorisé sans décision explicite du mainteneur**.

---

## Français

### Ce que FuryPipe apporte

FuryPipe ne se limite pas à un proxy ou à un compilateur de prompt. Le projet combine plusieurs couches indépendantes mais composables :

| Domaine | Modules principaux | Rôle |
|---|---|---|
| Orchestration | FuryPrompt, Capability Router, Instruction Fabric, Task Orchestrator | Transformer un objectif en plan exploitable, instructions pertinentes et quality gates |
| Agents | Agent Fabric, Agent Runtime, subagents, skill registry | Exécuter des étapes gouvernées avec budgets, preuves et permissions explicites |
| Contexte | Context IR, Context Fabric, Context Optimizer, cache planner | Classer, réduire et ordonner le contexte sans charger tout l’écosystème à chaque requête |
| Exactitude | ExactGuard, Recovery Store, receipts | Préserver les valeurs exactes, contrôler la récupération et tracer les transformations |
| Mémoire | Learning, Knowledge, Long-Term Memory, Continuous Memory | Conserver des connaissances durables avec révisions, scopes, oubli logique et purge |
| MCP | MCP moderne, MCP HTTP Node, runtime MCP historique | Exposer et consommer des capacités MCP avec frontières explicites |
| Providers | Provider Fabric, Provider Runtime, OmniRoute | Résoudre et router les providers sans confondre disponibilité, autorisation et exécution |
| Sécurité | Policy Engine, Policy Fabric, Policy Runtime | Centraliser les décisions de politique, refus et récupération |
| Opérations | Doctor, Control Room, Web Studio | Diagnostic, preuves runtime et surfaces d’administration |

### Pipeline recommandé

Le chemin de préparation actuel est :

```text
Objectif utilisateur
      │
      ▼
Capability Router
  ├─ capability packs
  ├─ skills éligibles
  ├─ plugins / MCP disponibles
  └─ quality gates
      │
      ▼
Instruction Fabric
  ├─ instructions par domaine
  ├─ budget d'instructions
  └─ règles explicites > règles automatiques
      │
      ▼
Context Optimizer
  ├─ metadata
  ├─ summary
  ├─ full
  └─ executable
      │
      ▼
FuryPrompt
      │
      ▼
Agent Runtime / Provider Runtime
      │
      ├─ preuves
      ├─ receipts
      └─ vérifications
```

La **Continuous Memory** s’intègre au niveau du tour conversationnel : rappel avant exécution, apprentissage après exécution réussie. Le contenu rappelé reste de la **donnée**, jamais une instruction prioritaire.

### Sélection automatique des capacités

FuryPipe peut sélectionner les capacités réellement pertinentes pour la tâche au lieu de charger toutes les skills, tous les plugins et tous les MCP.

Exemples déjà couverts nativement :

- ingénierie logicielle ;
- site marketing ;
- application web ;
- recherche ;
- apprentissage ;
- création et opérations business ;
- automatisation ;
- data / analytics ;
- plugin Minecraft ;
- mod Minecraft ;
- ressource FiveM ;
- extension de serveur de jeu.

Le Capability Router peut aussi déléguer l’analyse d’un domaine non natif à un analyzer fourni par l’hôte. Les résultats restent ensuite validés contre l’inventaire réellement enregistré.

### Instruction Fabric

Instruction Fabric ajoute uniquement les consignes utiles à la tâche courante.

Facettes natives actuelles :

- production engineering ;
- prompt authoring ;
- website production ;
- creative direction ;
- research evidence ;
- security assurance ;
- marketing conversion ;
- Minecraft plugin engineering ;
- FiveM resource engineering ;
- business operations.

Les règles explicitement demandées sont obligatoires. Les règles automatiques peuvent être écartées si le budget de contexte est dépassé.

### Context Optimizer

Context Optimizer choisit la représentation minimale suffisante d’un élément de contexte :

```text
metadata → summary → full → executable
```

Principes :

- les capacités non sélectionnées restent en metadata ;
- les résumés doivent être fournis/validés par l’appelant ;
- les données exactes ne sont jamais silencieusement dégradées ;
- les secrets sont bloqués par défaut ;
- les budgets globaux et par type sont indépendants ;
- le préfixe stable peut être privilégié pour le cache lorsque le provider autorise le réordonnancement.

### Continuous Memory

Continuous Memory s’appuie sur Recovery + Long-Term Memory et ne nécessite pas de provider mémoire externe.

Comportements importants :

- rappel borné avant un tour ;
- apprentissage borné après le tour ;
- corrections versionnées ;
- clé sémantique stable ;
- transcript brut non persisté comme mémoire durable ;
- secrets jamais mémorisés ;
- données sensibles bloquées par défaut ;
- inférences soumises à un seuil plus strict ;
- oubli logique et purge physique séparés ;
- mémoire rappelée explicitement marquée comme donnée non privilégiée.

L’API de tour protège aussi les side effects : si l’apprentissage mémoire échoue **après** une exécution externe réussie, FuryPipe ne relance pas automatiquement l’exécuteur.

### Modèle de sécurité

Quelques invariants structurants :

- lecture par défaut ;
- écritures bornées par chemin et par étape ;
- réseau désactivé par défaut dans Agent Runtime ;
- aucun secret implicitement demandé ;
- aucun plugin tiers installé automatiquement ;
- aucun MCP arbitraire considéré comme fiable ;
- contenu externe, mémoire et tool output considérés comme données non fiables ;
- `selected` ≠ `available` ≠ `connected` ≠ `authorized` ≠ `executed` ≠ `verified` ;
- les déclarations de succès doivent reposer sur des preuves ou receipts réels.

Voir [SECURITY.md](SECURITY.md) et [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

### Installation développeur

Prérequis :

- Node.js **>= 22.14** ;
- pnpm **10.21.0** recommandé par le dépôt.

```bash
git clone <votre-clone-du-depot>
cd FuryPipe
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
```

Diagnostic local :

```bash
node bin/cli.js doctor
```

Le package expose le binaire principal :

```text
furypipe
```

La publication npm n’est pas encore considérée comme une étape autorisée du workflow de hardening.

### Portée modèle par défaut

La configuration publique FuryPipe utilise `FURYPIPE_MODELS`. Le scope sans configuration est maintenu comme contrat avec le runtime :

Default model scope: `FURYPIPE_MODELS=claude-fable-5,gemini`

Exemples :

```bash
FURYPIPE_MODELS=off furypipe start
FURYPIPE_MODELS=claude-fable-5,gpt-5.6-sol furypipe start
```

Une ancienne variable d’environnement reste acceptée en fallback de compatibilité interne lorsqu’aucune valeur `FURYPIPE_MODELS` n’est fournie, mais elle n’est plus l’interface documentée.

### Export hors ligne

FuryPipe peut produire les artefacts de contexte sans démarrer le proxy :

```bash
furypipe export --stdin < prompt.txt
furypipe export --git
```

Selon l’entrée, l’export peut produire `page-*.png`, `factsheet.txt` et `prompt.txt`. Ce workflow permet de préparer ou inspecter les artefacts en mode offline.

### Commandes de développement

```bash
pnpm run typecheck
pnpm test
pnpm run build
pnpm run audit
pnpm run package:smoke
```

La CI couvre plusieurs versions Node et plusieurs OS. Le résultat d’un build local ne remplace pas les gates de la branche de hardening.

### Entrées package principales

Le package exporte notamment :

```text
furypipe/capability-router
furypipe/instruction-fabric
furypipe/context-optimizer
furypipe/continuous-memory
furypipe/continuous-memory-turn
furypipe/agent-runtime
furypipe/skill-registry
furypipe/plugin-bundles
furypipe/fury-prompt
furypipe/long-term-memory
furypipe/provider-runtime
furypipe/omniroute
furypipe/mcp-modern
furypipe/context-fabric
furypipe/exact-guard
```

Le **Task Orchestrator** est présent dans le code de hardening ; son export package suit le même processus de validation séparé avant d’être considéré public.

### Documentation

Points d’entrée utiles :

- [Capability Router](docs/CAPABILITY_ROUTER.md)
- [Instruction Fabric](docs/INSTRUCTION_FABRIC.md)
- [Context Optimizer](docs/CONTEXT_OPTIMIZER.md)
- [Task Orchestrator](docs/TASK_ORCHESTRATOR.md)
- [Continuous Memory](docs/CONTINUOUS_MEMORY.md)
- [Continuous Memory Turn](docs/CONTINUOUS_MEMORY_TURN.md)
- [FuryPrompt](docs/FURY_PROMPT.md)
- [Agent Fabric](docs/AGENT_FABRIC.md)
- [Context Fabric](docs/CONTEXT_FABRIC.md)
- [Provider Fabric](docs/PROVIDER_FABRIC.md)
- [OmniRoute](docs/OMNIROUTE.md)
- [MCP](docs/MCP.md)
- [Policy](docs/POLICY.md)
- [Receipts](docs/RECEIPTS.md)
- [CLI](docs/CLI.md)

### Statut release

Le projet est en phase de **production hardening**.

Avant toute release publique, FuryPipe exige au minimum les validations configurées dans le dépôt : CI, sécurité, provenance, supply-chain, licences, benchmark contract et analyse statique. Une gate verte n’autorise pas à elle seule une publication.

Les attributions et obligations tierces restent dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) et [LICENSE](LICENSE).

---

## English

### Overview

FuryPipe is a production-oriented runtime and toolkit for governed AI workflows. It combines context orchestration, structured prompts, task-aware capability selection, skills, MCP, provider routing, memory, policy, evidence and runtime diagnostics.

The project is still in hardening. Public release, npm publication and final deployment remain explicit maintainer decisions.

### Core architecture

```text
User objective
    ↓
Capability Router
    ↓
Instruction Fabric
    ↓
Context Optimizer
    ↓
FuryPrompt
    ↓
Agent Runtime / Provider Runtime
    ↓
Evidence + receipts + verification
```

Continuous Memory operates at the host turn boundary: recall before execution, governed learning after execution.

### Key properties

- task-aware capability routing;
- bounded instruction composition;
- deferred capability discovery;
- exact-context protection;
- secret context blocked by default;
- governed Agent Runtime stages;
- explicit plugin and MCP truth states;
- long-term memory with revision and forgetting controls;
- provider routing separated from authorization;
- no implicit release, install or deployment actions.

### Developer setup

Requirements:

- Node.js **>= 22.14**;
- repository package manager: **pnpm 10.21.0**.

```bash
git clone <your-repository-clone>
cd FuryPipe
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
```

Useful checks:

```bash
pnpm run audit
pnpm run package:smoke
node bin/cli.js doctor
```

## Offline export (no proxy)

FuryPipe can prepare context artifacts without running the proxy.

```bash
furypipe export --stdin < prompt.txt
furypipe export --git
```

Depending on the input, the export can emit `page-*.png`, `factsheet.txt` and `prompt.txt`. This is useful for inspecting or handing off generated context artifacts while keeping proxy execution out of the workflow.

### Documentation

Start with:

- [Capability Router](docs/CAPABILITY_ROUTER.md)
- [Instruction Fabric](docs/INSTRUCTION_FABRIC.md)
- [Context Optimizer](docs/CONTEXT_OPTIMIZER.md)
- [Task Orchestrator](docs/TASK_ORCHESTRATOR.md)
- [Continuous Memory](docs/CONTINUOUS_MEMORY.md)
- [Agent Fabric](docs/AGENT_FABRIC.md)
- [MCP](docs/MCP.md)
- [Security model](docs/SECURITY_MODEL.md)

Third-party obligations and attribution are tracked separately in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## License

See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
