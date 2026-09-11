# Agent Fabric FuryPipe — état local

`src/agent-fabric.ts` est une couche de planification metadata-only. Elle
n’exécute pas d’agent, ne lance pas de shell, ne contacte pas de réseau et ne
lit pas de secrets.

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

## Décisions de sources

Le registre `AGENT_FABRIC_DECISIONS` documente les décisions
`ADOPT`/`PORT`/`ADAPT`/`WRAP`/`REFERENCE_ONLY`/`REJECT` avec source, référence,
licence/provenance, raison, sécurité et maintenance. ECC et Matt Pocock skills
sont utilisés comme références de patterns, sans copie de code ni vendoring.
FuryPipe garde ses propres contrats et n’essaie pas de devenir un clone ECC.

Cette tranche reste `PARTIAL` : elle fournit un contrat de plan et des gates
testés, pas un harness multi-agent runtime, pas une mémoire de prompts, pas un
handoff interprocessus et pas une intégration d’exécution de skills.
