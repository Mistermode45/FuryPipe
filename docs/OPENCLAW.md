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
