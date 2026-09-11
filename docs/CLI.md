# FuryPipe CLI — état local

Le package local s’appelle `furypipe` et expose deux binaires identiques :

- `furypipe` : nom FuryPipe destiné à la future distribution ;
- `pxpipe` : alias de compatibilité conservé pour les configurations existantes.

Commandes réellement disponibles dans cette tranche :

```text
furypipe start
furypipe doctor [--json] [--locale=<BCP-47>]
furypipe stats [--json] [--file <path>]
furypipe export [...]
furypipe warp [...] -- <agent>
```

`furypipe doctor` ne lit pas les credentials et ne les imprime pas. Les URL
upstream sont normalisées sans identifiant, query string ni fragment avant
affichage. Les outils absents sont indiqués `unavailable`; aucune installation
automatique n’est déclenchée. La sortie humaine conserve l’anglais historique
par défaut et accepte `--locale=fr`, `--locale=en` ou une variante BCP-47
résolue vers ces catalogues. La sortie `--json` reste stable et non traduite.

La commande `npx furypipe@latest` ne peut pas encore être validée : le package
n’a pas été publié et aucun dist-tag n’est configuré. `npm pack --dry-run` est
le seul contrôle de packaging exécuté localement.
