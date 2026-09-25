# FuryPipe 0.16.0 — external validation inventory

## Règle commune

Les validations E1–E8 sont des classes de preuve séparées. Une présence de
variable d’environnement, un adaptateur installé ou un test local ne constitue
pas une validation externe. Toute commande live doit être déclenchée avec une
autorisation explicite, une cible allowlistée, un nombre de requêtes borné et
une sortie sans secret.

Le code RC peut être déclaré prêt pour ses gates automatisables sans fabriquer
une preuve live absente. Une release publique reste soumise aux gates
release-blocking et à l’autorité humaine ci-dessous.

## Matrice

| Classe | Requis pour le code RC | Optionnel ou conditionnel | Release-blocking | Credentials/coût | Mutation externe | Commande préparée | Preuve attendue | Rollback |
|---|---|---|---|---|---|---|---|---|
| E1 REAL_PROVIDER | Non, tant qu’aucune disponibilité/performance provider n’est revendiquée | Oui pour un déploiement qui active un provider réel ou une claim de performance | Oui si le provider live est déclaré dans le périmètre de release | Clé provider; coût possible; 1 requête max dans le harness | Une requête de génération peut coûter et créer une trace côté provider | pnpm run validation:provider-live | SHA exact, provider/modèle, HTTP status, résultat transport borné; jamais le body ou la clé | Pas de rollback du provider; annuler/fermer la requête côté provider et supprimer les artefacts locaux |
| E2 REAL_OIDC | Non pour le code local; contrat OIDC local requis | Oui pour une installation qui annonce OAuth/OIDC réel | Oui pour une release qui annonce un Authorization Server ou un tenant OAuth validé | Issuer, client/token selon flux; coût généralement nul mais accès sensible | Discovery/JWKS/userinfo en lecture; token exchange non déclenché par défaut | pnpm run validation:oidc-live | Discovery, issuer exact, JWKS, négatifs, audience/expiry/signature si le flux complet est autorisé | Révoquer le client/token selon l’IdP; aucune mutation FuryPipe automatique |
| E3 THIRD_PARTY_REMOTE_MCP | Non; MCP local/hosted contract séparé | Oui pour un endpoint tiers réellement supporté | Oui si l’endpoint tiers est présenté comme supporté dans la release | Endpoint HTTPS, auth éventuelle; coût dépend du tiers | Harness limité à initialize/tools/list; tools/call interdit par défaut | pnpm run validation:mcp-remote | Endpoint public, DNS/TLS, source SHA, initialize, tools/list, auth négatifs et reconnect si autorisés | Retirer l’endpoint/config et révoquer le credential; ne pas annuler des mutations non prouvées |
| E4 EXTERNAL_OPENCLAW | Non; adapter local et probe fail-closed suffisent au code | Oui si une gateway OpenClaw externe est dans le scope | Oui si compatibilité gateway externe est revendiquée | URL explicite; token éventuel; probe health sans génération | Probe health/readiness seulement | pnpm run openclaw:probe avec opt-in explicite | URL allowlistée, health/startup/ready, source et timestamp; aucune génération implicite | Arrêter la probe; aucun changement de gateway |
| E5 MANUAL_SCREEN_READER | Automatisation utile mais insuffisante | Non optionnel pour une claim d’accessibilité manuelle | Oui pour la claim d’accessibilité et le Control Plane déclaré accessible | Aucun credential produit; compte de test possible | Aucune mutation externe attendue | Checklist SCREEN_READER_CHECKLIST.md | Testeur, OS, lecteur, navigateur, parcours, observations et preuves liées au SHA | Corriger le code puis rejouer la session; aucune donnée utilisateur à restaurer |
| E6 HUMAN_VISUAL_REVIEW | Automatisation navigateur utile mais insuffisante | Non optionnel pour une claim visuelle/pixel parity | Oui pour les surfaces visuelles déclarées dans la release | Aucun credential sauf environnement de design explicitement autorisé | Figma réel non exécuté par défaut | Checklist VISUAL_ACCEPTANCE_CHECKLIST.md | Viewport, DPR, locale, thème, capture redactée et décision humaine | Revenir au candidat précédent et rejouer les viewports; aucune suppression de source |
| E7 RELEASE_PROVENANCE | Préparation locale et PR requises | Attestation signée requise sur événement éligible non-PR | Oui avant tag/publication | OIDC GitHub Actions, pas de secret npm long-lived | Attestation/artifact GitHub seulement; pas de publication | Workflow .github/workflows/provenance.yml | Artifact exact, SHA-256, attestation GitHub, source SHA et run ID | Ne pas publier; invalider l’évidence et refaire le run sur le SHA exact |
| E8 RELEASE_AUTHORITY | Toujours séparée des gates techniques | Jamais implicite | Oui avant merge release, tag, npm publish, GitHub Release ou deploy | Décision mainteneur; aucun secret ajouté au dépôt | Merge/tag/publish/deploy/restart sont des mutations | Revue humaine et autorisation explicite; aucune commande exécutée dans ce track | Autorisation enregistrée, scope, version, SHA et actions permises | Stopper avant action; toute action déjà autorisée suit la procédure de rollback dédiée |

## Contrat des harness live

Les trois commandes nouvelles refusent toute requête tant que les deux
conditions suivantes ne sont pas présentes :

    FURYPIPE_LIVE_VALIDATION=1
    <classe>_AUTHORIZED=YES

Les secrets sont lus uniquement en mémoire, leur valeur n’est jamais écrite
dans l’évidence, et les réponses externes ne sont pas recopiées. Sans opt-in,
le résultat est AUTHORIZATION_REQUIRED et requestExecuted=false.

Les harness ne doivent pas être ajoutés à la CI publique avec des secrets
implicites. Toute exécution live doit être un run dédié, lié au SHA exact, et
rester distincte de PASS des contrats locaux.
