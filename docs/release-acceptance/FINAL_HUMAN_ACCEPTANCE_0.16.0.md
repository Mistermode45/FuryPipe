# FuryPipe 0.16.0 — final human acceptance

Ce parcours est destiné à Mathis. Il prend environ 5 à 10 minutes et ne
demande aucun provider, aucun credential et aucun appel externe payant.

Le code produit est gelé. Le SHA du code avant ce commit documentaire était :

~~~text
f292ec23d69cfe6cff89cc083e0a872a987e2995
~~~

Après le commit documentaire, relever le SHA réellement utilisé par la session
avec git -C <worktree> rev-parse HEAD. Ne jamais réutiliser un ancien SHA
comme preuve du head final.

## 1. Installer exactement le package RC

Dans PowerShell, depuis le worktree RC :

~~~powershell
$Root = 'C:\Users\loicd\Desktop\FuryPipe-Build\FuryPipe-v0.16.0-RC'
$Tarball = Join-Path $Root 'artifacts\rc-preparation\package\furypipe-0.16.0.tgz'
$Acceptance = Join-Path $env:TEMP 'furypipe-0.16.0-human-acceptance'

New-Item -ItemType Directory -Force -Path $Acceptance | Out-Null
Set-Location $Acceptance
npm init -y
pnpm add --ignore-scripts $Tarball

$env:FURYPIPE_CONFIG = Join-Path $Acceptance 'config.json'
$env:FURYPIPE_LOG = Join-Path $Acceptance 'events.jsonl'
$env:FURYPIPE_HOST = '127.0.0.1'
$env:FURYPIPE_PORT = '48721'
$env:FURYPIPE_SOURCE_COMMIT = (git -C $Root rev-parse HEAD).Trim()

pnpm exec furypipe --version
pnpm exec furypipe setup --lang=fr --yes --no-color
pnpm exec furypipe doctor --json
~~~

Attendu :

~~~text
0.16.0
~~~

Le doctor --json doit fournir un état de runtime lisible. Un provider
absent peut apparaître unknown, unavailable ou degraded; cela ne doit pas
être transformé en faux ready provider.

## 2. Dashboard et Control Plane

Dans le même terminal :

~~~powershell
pnpm exec furypipe start
~~~

Ouvrir avec Chromium, Chrome ou Edge :

~~~text
URL       http://127.0.0.1:48721/
Page      Dashboard / Control Plane
Viewport  1440x900, puis 390x844
~~~

Contrôles courts :

| Contrôle | Décision | Observation attendue |
|---|---|---|
| Dashboard | PASS / FAIL | La page s’ouvre, le titre et l’action principale sont compréhensibles. |
| Control Plane / readiness | PASS / FAIL | Les sections sont lisibles; l’état reste observation-only et source-bound. |
| Empty state | PASS / FAIL | Un profil neuf affiche un état vide explicite, sans données inventées. |
| Degraded state | PASS / FAIL | Sans credential provider, l’option externe reste unknown/degraded, sans faux succès. |
| Error state | PASS / FAIL | Ouvrir http://127.0.0.1:48721/does-not-exist; l’erreur/404 est compréhensible. |
| Responsive | PASS / FAIL | À 390x844, aucune action importante n’est coupée ou recouverte. |

Contrôles read-only facultatifs dans le même navigateur :

~~~text
http://127.0.0.1:48721/api/beta.json
http://127.0.0.1:48721/api/control-plane.json
~~~

## 3. WebChat et reconnexion

Dans un second terminal, depuis le répertoire d’acceptance :

~~~powershell
pnpm exec furypipe gateway start --json
~~~

Utiliser exactement l’URL et le code bootstrap imprimés par la commande. Le
port loopback attendu par défaut est :

~~~text
Origin   http://127.0.0.1:48722
WebChat  http://127.0.0.1:48722/gateway/webchat/
~~~

Contrôles :

| Contrôle | Décision | Observation attendue |
|---|---|---|
| WebChat bootstrap | PASS / FAIL | Le code à usage unique ouvre une session locale. |
| WebChat empty state | PASS / FAIL | La conversation vide est compréhensible; aucun provider n’est requis. |
| Reconnect | PASS / FAIL | Arrêter puis relancer le Gateway; recharger la page; la reconnexion reste bornée et explicite. |
| External inference | PASS / FAIL | Aucun appel provider n’est attendu pendant cette acceptance. |

Ne pas ajouter de credential pour rendre le test vert. Une inférence provider
live appartient à E1 et reste hors de cette acceptance core.

## 4. Web Studio

Le package expose Web Studio comme artefact statique et comme surface de
conformance browser. Le contrat actuel ne monte pas Web Studio sur
http://127.0.0.1:48721/ et furypipe start ne fournit pas de route locale
/studio-qa.

Donc :

- ne pas inventer une URL locale Web Studio;
- si Mathis dispose d’une cible hébergée autorisée, ouvrir l’URL fournie par
  le mainteneur, avec le chemin exact /studio-qa;
- utiliser Chromium à 1440x900, puis 390x844;
- noter PASS ou FAIL seulement après observation humaine;
- sans URL hébergée autorisée, laisser Web Studio = PENDING et ne pas le
  transformer en PASS à partir de la QA automatisée.

La QA automatisée existante couvre la surface statique, mais ne remplace pas
cette observation humaine : Web Studio cross-engine = 120/120 n’est pas une
acceptation visuelle humaine.

## 5. Captures minimales

Ne prendre que ces captures, sans secrets, tokens, prompts privés ou données
utilisateur :

~~~text
01-dashboard.png       Dashboard à 1440x900
02-control-plane.png   Control Plane/readiness développé à 1440x900
03-web-studio.png      Web Studio hébergé, uniquement si URL autorisée
04-degraded-state.png  État provider absent/degraded
05-webchat.png         WebChat connecté, conversation vide
06-mobile-or-narrow.png Dashboard à 390x844
~~~

Chaque capture doit être accompagnée du SHA observé, du navigateur, du
viewport et de la locale. Les captures ne sont pas ajoutées au dépôt sans
validation séparée.

## 6. Screen reader — parcours minimal Windows

Utiliser NVDA + Chromium si NVDA est déjà disponible. Sinon laisser le statut
PENDING; ne pas télécharger un logiciel depuis une source non approuvée
dans ce parcours.

Sur http://127.0.0.1:48721/ :

1. ouvrir la page et écouter le titre annoncé;
2. parcourir les headings avec H;
3. parcourir les boutons avec B;
4. parcourir les liens avec K;
5. parcourir les contrôles de formulaire avec F;
6. ouvrir le panneau ou dialog disponible avec Enter;
7. fermer avec Escape et vérifier le retour du focus;
8. déclencher/rechercher un message loading, error ou degraded;
9. vérifier qu’une information importante n’est pas uniquement visuelle.

| Contrôle | PASS / FAIL | Observation |
|---|---|---|
| Titre de page annoncé |  |  |
| Headings compréhensibles |  |  |
| Boutons nommés |  |  |
| Liens nommés |  |  |
| Contrôles de formulaire nommés |  |  |
| Dialog title et fermeture |  |  |
| Focus compréhensible |  |  |
| Messages error/degraded annoncés |  |  |
| Information non visuelle disponible |  |  |

La checklist complète reste dans
[SCREEN_READER_CHECKLIST.md](SCREEN_READER_CHECKLIST.md). Ne pas utiliser
Lighthouse, axe ou la suite Playwright comme substitut à cette observation.

## Réponse attendue de Mathis

~~~text
VISUAL HUMAN = PASS | FAIL | PENDING
SCREEN READER HUMAN = PASS | FAIL | PENDING
WEB STUDIO URL = <URL autorisée ou NOT_PROVIDED>
SCREENSHOTS = 01..06 ou liste des captures réellement prises
NOTES = <écarts observés, sans secret>
~~~
