# FuryPipe 0.16.0 — final human acceptance

Ce parcours est destiné à Mathis. Il prend environ 5 à 10 minutes et ne
demande aucun provider, aucun credential et aucun appel externe payant.

Cette acceptance remplace celle faite avec le paquet d’avant le correctif
Gateway : elle doit être rejouée avec le tarball RC final ci-dessous.

## 0. Identité du paquet

Le seul artefact d’acceptance et de release candidate est le tarball produit
par le job GitHub Actions **RC Preparation Evidence / prepare** sur le head
exact de la PR #226 (ubuntu-24.04, Node 24.21.0, npm fourni avec Node).

~~~text
Source commit   f41aa957619a0d4b468f81a5d627b4980f783ac1
Artefact        furypipe-rc-preparation-f41aa957619a0d4b468f81a5d627b4980f783ac1  (package/furypipe-0.16.0.tgz)
SHA-256         99feb17fc8747e9b5de8a5cf23f58536a5a348d66242bfb62690703a7bbdf08a
Taille          5,404,064 octets
Content digest  30108a5fa50a23245d1e21b7d528311e0d2d624b30f68314a8724fe9a47af052
~~~

Un commit ultérieur purement documentaire ne modifie aucun fichier packagé :
l’artefact RC Preparation du head final doit afficher exactement le même
SHA-256. Les deux artefacts sont alors interchangeables.

Pourquoi un seul artefact canonique :

- le contenu du paquet est désormais identique sur Linux, macOS et Windows
  (`.gitattributes` force LF, tous les fichiers packagés sont en mode 644;
  `validation:package-reproducibility` tourne sur les 9 jobs CI 3 OS × 3 Node
  et refuse tout octet CR ou mode non portable; les 9 content digests sont
  identiques);
- le SHA-256 du tarball lui-même est identique sur les 9 jobs CI et le job
  RC Preparation (npm 10.9.8, 11.19.0 et 11.19.1); une autre version de npm
  pourrait changer l’enveloppe gzip/tar sans changer le contenu, d’où le
  content digest;
- l’ancien digest Windows `7d26a8…` venait d’un checkout CRLF, `9b2627…`
  d’avant le correctif Gateway, `b6a651…` et `a60919…` de heads
  intermédiaires : tous sont obsolètes.

Le digest npm final (`dist.integrity`) sera celui du paquet publié par le
workflow de release; il est vérifié séparément après publication
(POST_PUBLISH_VERIFICATION_0.16.0.md).

## 1. Installer exactement le package RC

Télécharger l’artefact `furypipe-rc-preparation-f41aa957619a0d4b468f81a5d627b4980f783ac1` depuis
l’onglet Checks de la PR #226 (job RC Preparation Evidence), puis
l’extraire. Utiliser npm/npx : le shim pnpm global de ce poste pointe sur
lui-même et ne doit pas masquer le résultat FuryPipe. Ce choix concerne
seulement ce parcours d’acceptance; le développement du dépôt reste sur pnpm.

~~~powershell
$Tarball = 'C:\chemin\vers\furypipe-0.16.0.tgz'
(Get-FileHash -Algorithm SHA256 $Tarball).Hash.ToLower()
~~~

Attendu : exactement le SHA-256 de la section 0. Sinon, arrêter.

~~~powershell
$Acceptance = Join-Path $env:TEMP 'furypipe-0.16.0-final-acceptance'
Remove-Item -Recurse -Force $Acceptance -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Acceptance | Out-Null
Set-Location $Acceptance
npm init -y
npm install --ignore-scripts $Tarball

$env:FURYPIPE_CONFIG = Join-Path $Acceptance 'config.json'
$env:FURYPIPE_LOG = Join-Path $Acceptance 'events.jsonl'
$env:FURYPIPE_HOST = '127.0.0.1'
$env:FURYPIPE_PORT = '48721'
$env:FURYPIPE_SOURCE_COMMIT = 'f41aa957619a0d4b468f81a5d627b4980f783ac1'

npx --no-install furypipe --version
npx --no-install furypipe setup --lang=fr --yes --no-color
npx --no-install furypipe doctor --json
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
npx --no-install furypipe start
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
npx --no-install furypipe gateway start --json
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
