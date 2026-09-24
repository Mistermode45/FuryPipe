# FuryPipe 0.16.0 — screen-reader acceptance checklist

## Statut et périmètre

Cette checklist fournit la preuve humaine manquante après
pnpm run validation:accessibility. Elle ne transforme pas les tests
automatisés en preuve d’usage réel et ne doit pas être marquée PASS sans
lecteur d’écran et navigateur réellement utilisés.

La validation est release-blocking pour toute affirmation d’accessibilité
manuelle ou pour une release qui déclare le Control Plane accessible. Elle
reste distincte de l’automated gate ACCESSIBILITY AUTOMATED.

## Préparation

Renseigner avant la session :

| Champ | Valeur |
|---|---|
| Candidate version | 0.16.0 |
| Exact source SHA |  |
| Date/heure UTC |  |
| Testeur |  |
| OS/build |  |
| Lecteur d’écran et version |  |
| Navigateur et version |  |
| Viewport/zoom |  |
| Locale/direction |  |
| URL ou commande de démarrage |  |

Tester au minimum une combinaison Windows avec NVDA + Chromium/Firefox et une
combinaison macOS avec VoiceOver + Safari lorsque ces environnements sont dans
le périmètre de livraison. Ajouter toute combinaison officiellement supportée.

## Parcours

Cocher PASS uniquement après observation réelle. En cas d’écart, cocher FAIL,
décrire le contrôle concerné et joindre une capture ou un log redacté qui ne
contient ni secret ni donnée utilisateur.

| ID | Contrôle | PASS/FAIL | Preuve ou observation |
|---|---|---|---|
| SR-01 | Le démarrage et le chargement du Control Plane annoncent un titre de page utile. |  |  |
| SR-02 | Les landmarks principaux sont identifiables et ordonnés : navigation, contenu principal, zones d’état. |  |  |
| SR-03 | Le focus clavier est visible, séquentiel et ne disparaît pas derrière un panneau ou une modale. |  |  |
| SR-04 | Les liens et boutons exposent un nom accessible qui décrit l’action. |  |  |
| SR-05 | Les changements de route, d’onglet ou de panneau sont annoncés sans lecture répétitive inutile. |  |  |
| SR-06 | Les états loading, empty, error et success sont distinguables par le lecteur d’écran. |  |  |
| SR-07 | Les contrôles de formulaire exposent leur label, leur état invalide et leur message d’erreur. |  |  |
| SR-08 | Les tableaux, listes et métriques exposent une structure compréhensible hors du contexte visuel. |  |  |
| SR-09 | Les notifications et changements asynchrones importants sont annoncés sans voler le focus. |  |  |
| SR-10 | Le mode RTL et les textes français/anglais ne créent pas de séquence de lecture incohérente. |  |  |
| SR-11 | La navigation reste utilisable à 200 % de zoom et sur un viewport étroit. |  |  |
| SR-12 | L’arrêt du runtime et le retour à un état hors ligne ne laissent pas un état annoncé comme sain. |  |  |

## Décision

La session est PASS seulement si tous les contrôles applicables sont
observés comme conformes, les écarts non applicables sont justifiés et la
preuve est liée au même SHA que le candidat. Sinon le statut est
MANUAL_REQUIRED ou FAIL; il ne doit pas être abaissé en PASS par inférence
depuis Lighthouse, axe, Playwright ou une capture statique.
