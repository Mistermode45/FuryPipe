# ADR-0001 — Base upstream et séparation des remotes

## Statut

Accepté — 2026-09-11

## Décision

Le dépôt FuryPipe local utilise `origin` pour `Mistermode45/FuryPipe` et `upstream` pour `teamchong/pxpipe`. La branche locale `main` est initialisée sur le commit upstream exact `8ba82b713a1e823bc1c09b7a68e47f63caa7b426` tant que le dépôt cible ne possède pas encore d'historique.

## Raisons

Cette disposition permet de mesurer pxpipe avant modification et de conserver une provenance Git explicite. Aucun push n'est réalisé.

## Conséquences

Le dépôt local reste une base upstream traçable, mais contient maintenant des tranches locales documentées dans `docs/PXPIPE_GAP_ANALYSIS.md`. Il ne s’agit pas encore d’une release FuryPipe : aucune publication ni synchronisation distante n’a été réalisée.
