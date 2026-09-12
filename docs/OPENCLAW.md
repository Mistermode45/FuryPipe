# OpenClaw adapter — état local

`src/openclaw.ts` est un adapter Node en lecture seule. Il suit les chemins
OpenClaw actuels : `OPENCLAW_CONFIG_PATH` peut désigner le fichier actif,
`OPENCLAW_HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_PROFILE` et
`OPENCLAW_WORKSPACE_DIR` modifient les chemins par défaut, et la configuration
par défaut est `~/.openclaw/openclaw.json` avec un workspace dans
`~/.openclaw/workspace`.

Le fichier est lu en JSON5 avec une dépendance JSON5 dédiée ; seuls le statut,
les chemins, le nombre d’agents, le bind
gateway, le mode d’authentification et les noms de champs sensibles sont
retournés. Les valeurs de tokens, mots de passe, API keys et credentials ne
sont jamais renvoyées ni affichées.

L’adapter refuse de traiter un chemin de configuration symbolique comme un
fichier régulier, signale un JSON5 invalide, vérifie seulement la présence des
fichiers de workspace connus et alerte sur un bind non-loopback sans mode
d’authentification déclaré. Il ne modifie ni configuration ni workspace.

Les fixtures couvrent JSON5, surcharge de chemins, fichier absent et fichier
invalide. Le doctor local ajoute ces informations bornées, mais le runtime
OpenClaw reste `OPENCLAW_NOT_TESTED` tant qu’un vrai binaire/gateway OpenClaw
n’a pas été utilisé. Aucun credential, gateway distant, OAuth ou appel modèle
n’est exécuté.


## Gateway HTTP probe

`probeOpenClawGateway()` fournit maintenant une sonde runtime opt-in sur les endpoints OpenClaw documentés :

- `GET /healthz` — liveness du serveur HTTP ;
- `GET /startupz` — démarrage terminé / admission trafic, sans confondre la santé des channels ;
- `GET /readyz` — readiness profonde incluant les channels configurés.

Le probe valide le contrat JSON et pas seulement le status HTTP. C'est nécessaire car une route inconnue peut être servie par le catch-all Control UI avec HTTP 200.

Sécurité :

- loopback uniquement par défaut ;
- `allowRemote: true` requis pour une origine distante explicitement approuvée ;
- HTTP/HTTPS seulement ;
- credentials intégrés dans l'URL interdits ;
- path/query/fragment fournis par l'appelant interdits ;
- timeout borné ;
- aucun body d'erreur distant n'est conservé ;
- aucun token/password n'est demandé : les endpoints de probe HTTP sont non authentifiés ;
- aucun endpoint `/v1/*`, session, outil, agent turn ou appel modèle n'est exécuté.

Le résultat distingue `healthy`, `not_ready`, `unreachable` et `invalid_contract`, puis expose un overall `healthy/degraded/unavailable`.

Cette primitive ne transforme pas M9 en validation OpenClaw hébergée. Tant qu'un vrai Gateway de l'environnement cible n'est pas sondé, `OPENCLAW_NOT_TESTED` / `BLOCKED_EXTERNAL_ENV` reste le statut honnête pour la preuve externe.
