# FuryPipe 0.16.0 — visual acceptance checklist

## Statut et périmètre

Cette checklist couvre l’acceptation humaine du Control Plane et du Web
Studio. Elle complète les matrices Playwright et l’automated accessibility
gate; elle ne les remplace pas. Un rendu source-bound ou une capture
automatique ne prouve pas à lui seul une acceptation visuelle.

La validation est release-blocking pour toute affirmation de qualité visuelle,
de parité client ou de pixel accuracy. Le périmètre exact doit être limité
aux surfaces réellement déclarées dans la release.

## Préparation

| Champ | Valeur |
|---|---|
| Candidate version | 0.16.0 |
| Exact source SHA |  |
| Testeur |  |
| OS, navigateur et version |  |
| Viewport et device pixel ratio |  |
| Locale/direction |  |
| Light/dark theme |  |
| URL ou fixture |  |

Viewports minimaux à couvrir lorsque la surface est dans le périmètre :
320, 375, 768, 1024 et 1440 CSS px de largeur. Tester également les seuils
de responsive effectivement déclarés par la surface.

## Parcours

| ID | Contrôle | PASS/FAIL | Preuve ou observation |
|---|---|---|---|
| VA-01 | La hiérarchie visuelle rend immédiatement lisibles navigation, état du runtime et action principale. |  |  |
| VA-02 | Les états initial, loading, empty, error, degraded et ready sont visuellement distincts. |  |  |
| VA-03 | Le contraste, le focus, les bordures et les textes restent lisibles en light et dark theme. |  |  |
| VA-04 | Les boutons, liens, onglets et panneaux ne changent pas de géométrie de manière trompeuse au focus ou au hover. |  |  |
| VA-05 | Les textes longs, erreurs, noms de modèles et métriques ne provoquent pas de débordement ou de recouvrement. |  |  |
| VA-06 | Les tableaux, cartes, graphiques et badges restent compréhensibles sans dépendre uniquement de la couleur. |  |  |
| VA-07 | La navigation mobile n’écrase pas le contenu et les actions secondaires restent retrouvables. |  |  |
| VA-08 | Le mode RTL inverse les relations visuelles attendues sans chevauchement ni icône ambiguë. |  |  |
| VA-09 | Le Web Studio affiche clairement ses états de connexion, aperçu et erreur sans prétendre à une session Figma réelle. |  |  |
| VA-10 | Une capture du résultat est liée au SHA et au viewport; aucune capture privée ou donnée utilisateur n’est ajoutée au dépôt. |  |  |

## Décision

PASS exige un examen humain documenté sur chaque combinaison applicable. Une
capture manquante, un viewport non couvert ou une divergence non expliquée
reste MANUAL_REQUIRED; elle ne devient pas PASS parce que le test navigateur
est vert.
