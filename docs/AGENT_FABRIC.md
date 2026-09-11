# Agent Fabric FuryPipe — état local

`src/agent-fabric.ts` conserve le contrat de planification et
`src/agent-runtime.ts` ajoute un harness d’exécution piloté par l’application
hôte. Le runtime appelle réellement les callbacks enregistrés pour chaque
étape, skill et subagent ; il ne fournit ni shell, ni réseau ambiant, ni
credentials, ni modèle implicite.

## Contrat

Un plan ordonne cinq étapes : `research` → `plan` → `implement` → `review` →
`verify`. Chaque étape possède un propriétaire, une permission et des preuves
requises. Le plan par défaut est entièrement read-only. L’écriture ne devient
possible que si l’appelant passe explicitement `allowWrites: true`, et reste
limitée à l’étape `implementer`. Le réseau est désactivé et les secrets ne sont
jamais demandés.

Le budget de contexte est borné entre 256 et 200 000 tokens. L’objectif est
représenté par un digest opaque ; le plan ne conserve pas le texte d’objectif.
Les gates empêchent de considérer un workflow terminé sans recherche préalable,
review et vérification.

## Runtime

`runAgent()` exécute séquentiellement `research` → `plan` → `implement` →
`review` → `verify`. Une étape absente, une preuve vide, un budget dépassé, une
erreur d’exécution ou un échec de mémoire bloque le run au lieu de produire un
résultat DONE.

Le mode par défaut reste `read`. L’étape `implement` ne reçoit
`scoped-write` que si l’appelant active explicitement `allowWrites` et fournit
une liste bornée de chemins autorisés. Les skills et subagents suivent la même
règle. Les skills peuvent exposer une health check ; un état `unhealthy` les
bloque, tandis que l’état `unknown` reste visible dans le résultat.

Chaque contexte expose `network: disabled` et `secrets: never_requested`. Les
appels MCP sont limités à une allowlist de méthodes et les skills/subagents
déclarés `network: required` sont refusés. Aucun résultat de callback ni
objectif plaintext n’est écrit dans la mémoire : seuls des digests, statuts,
étapes et compteurs sont persistés.

Un résultat `handoff_required` fournit un snapshot vérifiable contenant le
digest d’objectif, l’étape suivante, les étapes terminées et le budget utilisé.
`runAgent(request, snapshot)` vérifie l’objectif, l’ordre des étapes et le
budget avant de reprendre. Lorsqu’un `furyPrompt` est explicitement fourni,
il est compilé une seule fois ; les callbacks reçoivent le texte compilé et le
snapshot lie la reprise à son digest sans conserver ce texte.

`createRecoveryAgentMemoryStore()` fournit l’adaptateur durable pour les
reprises entre processus. Chaque résultat est enveloppé dans un objet
Recovery immuable et indexé par des métadonnées exactes (`source`, `runId`,
`stage`, `contentType`). Le payload ne contient que le format, l’étape, le
statut et le digest opaque du résultat ; l’objectif, le prompt et les preuves
textuelles n’y sont pas écrits. La liste des manifests est bornée à 10 000
éléments et la lecture revalide chaque enveloppe avant de la rendre au runtime.
Le snapshot reste transporté explicitement par l’hôte : cet adaptateur ne
fabrique ni worker, ni modèle, ni orchestration distante.

## Décisions de sources

Le registre `AGENT_FABRIC_DECISIONS` documente les décisions
`ADOPT`/`PORT`/`ADAPT`/`WRAP`/`REFERENCE_ONLY`/`REJECT` avec source, référence,
licence/provenance, raison, sécurité et maintenance. ECC et Matt Pocock skills
sont utilisés comme références de patterns, sans copie de code ni vendoring.
FuryPipe garde ses propres contrats et n’essaie pas de devenir un clone ECC.

Cette tranche reste `PARTIAL` : le harness local, l’adaptateur Recovery et la
reprise testée dans un processus enfant sont exécutables. Aucun adaptateur de
modèle réel, orchestrateur distribué, kill/reprise à chaque phase ou
environnement externe n’est déclaré livré.
