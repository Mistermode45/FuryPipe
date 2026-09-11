# FuryPrompt Compiler — état V5

`src/fury-prompt.ts` compile des sections structurées en une sortie déterministe
et inspectable. Les sections acceptées sont, dans cet ordre :

`Intent`, `Role`, `Objective`, `Context`, `Inputs`, `Constraints`, `Task`,
`Plan`, `Tools`, `Skills`, `MCP`, `Subagents`, `Output Contract`,
`Acceptance Criteria`, `Verification`.

## Niveaux

Le niveau peut être fourni explicitement. Sans niveau explicite, l’inférence est
bornée et déterministe :

- `TRIVIAL` : une seule section courte, rendue sans titres afin de ne pas gonfler
  un prompt simple ;
- `STANDARD` : sections étiquetées dans l’ordre canonique ;
- `ENGINEERING` : contraintes, plan, outils, skills, MCP ou gates de sortie ;
- `RESEARCH` : contexte, inputs ou vérification sans section d’exécution ;
- `MULTI_AGENT` : présence de `Subagents` ;
- `SECURITY_CRITICAL` : uniquement sur signal explicite de l’appelant.

L’inférence ne classe pas un prompt comme critique uniquement parce qu’un mot
lié à la sécurité apparaît dans son texte.

## Exactitude et intégrations

Chaque compilation expose le prompt, sa taille UTF-8, des digests SHA-256 de la
source structurée et de la sortie, ainsi qu’un manifest `ExactGuard` sans
conserver les valeurs protégées dans le manifest. Le prompt lui-même est bien
sûr la sortie demandée et peut contenir le contenu fourni par l’appelant.

Les `integrationHints` annoncent les contrats metadata-only attendus par
Context Fabric et Agent Fabric. Ils ne déclenchent ni transform provider, ni
outil, ni skill, ni serveur MCP, ni agent. L’exécution de ces surfaces doit
rester explicite dans leurs propres runtimes.

Les valeurs sont bornées avant rendu : 256 valeurs maximum par section, 1 MiB
par valeur et 8 MiB d’inputs cumulés. Les sections vides et les valeurs non
textuelles sont refusées.

## Preuve et limite

`tests/fury-prompt.test.ts` couvre la compacité triviale, les quinze sections,
l’ordre canonique, la déterminisme, les valeurs exactes, le manifest
ExactGuard, le signal security-critical et les bornes d’entrée.

Le statut M12 est `PARTIAL` : le compilateur public et ses contrats sont
testés localement, mais son appel automatique dans `transformRequest` et son
exécution par un Agent Harness n’existent pas encore. Aucun claim de runtime
multi-agent ne doit être déduit de ce module seul.
