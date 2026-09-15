# FuryPipe CLI

Le binaire public documenté est `furypipe`.

## Commandes

```text
furypipe start
furypipe doctor [--json] [--locale=<BCP-47>]
furypipe stats [--json] [--file <path>]
furypipe export [...]
furypipe warp [...] -- <agent>
```

## Doctor

`furypipe doctor` inspecte l’environnement runtime sans lire ni afficher les credentials.

Les URL upstream sont normalisées avant affichage : identifiants, query string et fragments sensibles ne sont pas exposés dans le rapport.

Les outils absents sont signalés comme `unavailable`. FuryPipe ne déclenche aucune installation automatique à partir de `doctor`.

La sortie humaine accepte notamment :

```text
--locale=fr
--locale=en
--locale=<variante BCP-47 résolue vers un catalogue supporté>
```

La sortie `--json` reste stable et non traduite afin de conserver un contrat machine exploitable.

## Export

`furypipe export` permet de préparer des artefacts de contexte sans imposer le démarrage du proxy.

Les modes disponibles incluent notamment les entrées stdin et Git selon les options réellement exposées par la commande.

## Warp

`furypipe warp ... -- <agent>` applique l’environnement FuryPipe au processus enfant demandé. Les permissions, credentials et capacités du processus cible ne sont pas élargis par la documentation CLI.

## État de distribution

Le package n’est pas considéré comme publiable uniquement parce que `npm pack` fonctionne.

Le hardening exige les gates configurées dans le dépôt, notamment :

- CI multi-OS / multi-Node ;
- analyse statique ;
- secret scan ;
- supply-chain ;
- licences ;
- provenance ;
- benchmark contract ;
- package smoke.

Aucune publication npm, release GitHub ou promotion finale ne doit être déduite de cette documentation.
