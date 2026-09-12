# FuryPipe CLI

FuryPipe expose la commande principale `furypipe` ainsi que les binaires MCP
`furypipe-mcp` et `furypipe-mcp-http`.

## Commandes

```text
furypipe
furypipe doctor [--json] [--locale=<BCP-47>]
furypipe stats [--json] [--file <path>]
furypipe export [...]
furypipe warp [--route PATTERN=TARGET]... -- <agent>
```

### `furypipe`

Démarre le proxy local FuryPipe. Le binding par défaut reste loopback-only.

### `furypipe doctor`

Inspecte l'environnement local, les dépendances et les surfaces FuryPipe sans
lire ni afficher les credentials. La sortie humaine accepte `--locale=fr`,
`--locale=en` et les variantes BCP-47 résolues vers les catalogues disponibles.
La sortie `--json` reste stable et non traduite.

### `furypipe stats`

Analyse le journal JSONL hors ligne. Le chemin par défaut est
`~/.furypipe/events.jsonl` pour une nouvelle installation. Une installation
existante utilisant l'ancien emplacement est reprise automatiquement si le
nouveau fichier n'existe pas.

### `furypipe export`

Rend des fichiers, répertoires, stdin ou changements Git sous forme de pages PNG,
avec `factsheet.txt`, `manifest.json` et `prompt.txt`. Aucun proxy en cours
d'exécution n'est requis.

### `furypipe warp`

Lance une commande derrière le routage FuryPipe et permet d'ajouter des règles
`--route PATTERN=TARGET`. Le runtime ne crée pas une seconde instance du proxy.

## Configuration principale

Variables FuryPipe officielles :

```text
FURYPIPE_MODELS
FURYPIPE_CONFIG
FURYPIPE_LOG
FURYPIPE_DISABLE
FURYPIPE_UPSTREAM
FURYPIPE_PROVIDER
FURYPIPE_GATEWAY_BASE_URL
FURYPIPE_GATEWAY_HEADERS
FURYPIPE_DUMP_DIR
FURYPIPE_RENDER_CACHE_BYTES
FURYPIPE_DEBUG_CAPTURE_4XX
FURYPIPE_MAX_REQUEST_BYTES
```

Les anciens noms restent acceptés uniquement comme fallback de compatibilité. Ils
ne sont pas la surface recommandée.

## Sécurité

- le dashboard reste loopback-only ;
- les credentials ne sont pas imprimés par `doctor` ;
- les URL affichées sont normalisées sans userinfo, query string ni fragment ;
- les outils absents sont déclarés `unavailable`, jamais installés automatiquement ;
- les captures 4xx complètes restent opt-in car elles peuvent contenir prompts et secrets.
