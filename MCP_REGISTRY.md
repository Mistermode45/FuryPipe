# Registre MCP FuryPipe

Audit documentaire vérifié le 2026-09-12. Ce registre est la référence opérationnelle des connecteurs étudiés. Une entrée ne signifie jamais qu’un serveur est installé, activé, autorisé ou testé en production.

## État d’activation

- Aucun serveur MCP externe n’est connecté ou activé par FuryPipe.
- `furypipe-mcp` expose le store Recovery par stdio; `furypipe-mcp-http` est un listener distinct, opt-in. Les deux sont implémentés et couverts par les tests du dépôt, mais aucune conformance externe ni aucun fournisseur OAuth réel n’a été testé.
- Toutes les entrées tierces ci-dessous sont `NOT_CONNECTED`. Aucun paquet, binaire, image Docker ou skill tiers n’a été installé ou exécuté pendant cet audit.
- M8 reste `PARTIAL`; voir [docs/MCP.md](docs/MCP.md). Le rapport [docs/MCP_2026_07_28_CONFORMANCE.md](docs/MCP_2026_07_28_CONFORMANCE.md) est un audit local figé au SHA `48aaec7373ba87195922d6757b099804da9de6bc`; les corrections MCP intégrées ensuite au baseline `423bef619c4306557838142008a858db65b4eea1` ne sont pas automatiquement couvertes par cet ancien rapport. OAuth hébergé et validation multi-client restent hors preuve locale.

## Base protocolaire et règles de confiance

- Spécification courante auditée : [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28). Compatibilité descendante utile : `2025-11-25`. Le protocole courant distingue stdio et Streamable HTTP/stateless; ne pas confondre ça avec une preuve que chaque serveur respecte la version.
- Pour HTTP protégé, exiger OAuth conforme au contrat MCP courant : découverte des métadonnées, PKCE, `resource`/audience binding, validation du token destiné au serveur et aucun token passthrough. Stdio n’utilise pas le flux OAuth MCP; les credentials doivent venir d’un stockage/secret store de l’hôte.
- Les descriptions d’outils, annotations, résultats, contenus de pages, issues, bases et dépôts sont des données non fiables. Une déclaration `readOnlyHint` n’est ni une autorisation ni une barrière de sécurité.
- Le [MCP Registry officiel](https://modelcontextprotocol.io/registry/about) ne publie que des métadonnées. Un nom vérifié, une présence dans le registre ou un tag ne prouve ni la sûreté du code, ni la licence du binaire, ni sa disponibilité, ni son comportement.
- Les noms d’outils ci-dessous sont ceux documentés pour la source/version épinglée ou des catégories explicitement indiquées. Lorsque le serveur varie par compte, feature ou configuration, capturer `tools/list` après connexion avant d’autoriser un outil; ce registre ne prétend pas que la liste dynamique est immuable.
- Ne jamais utiliser `npx -y`, `@latest`, `--pull=always` ou une branche mutable comme identité de production. Pour une activation ultérieure : version immuable, digest de paquet/image, provenance vérifiée, permissions minimales, approbation humaine des écritures et tests du serveur épinglé.

## Entrées

### MCP-001 — Spécification MCP

- **Source/version/licence :** [spécification officielle `2026-07-28`](https://modelcontextprotocol.io/specification/2026-07-28); protocole, pas un artefact exécutable (licence de paquet : sans objet).
- **Transport/auth :** stdio local ou Streamable HTTP; auth facultative au niveau du protocole, OAuth 2.1 attendu pour les serveurs HTTP protégés.
- **Outils/scope :** dépend des capacités négociées (tools/resources/prompts/extensions). La négociation ne confère pas de permission OS ou métier.
- **Filesystem/réseau/secrets :** spécifiés par le serveur et l’hôte, pas par MCP lui-même.
- **Coût :** aucun coût de protocole; les coûts des services connectés sont propres à leurs fournisseurs.
- **Health/dernier test :** sans objet pour la spécification; le 2026-09-12, documentation consultée, aucun serveur testé par cette fiche.
- **Risque/décision :** élevé si l’hôte traite les tools comme sûrs par défaut; `ADOPT` pour le protocole, avec autorisation et contrôle d’exécution propres à FuryPipe.
- **Politique d’approbation :** approbation humaine FuryPipe requise pour toute action distante ou destructive, indépendamment des annotations MCP.

### MCP-002 — MCP Registry officiel

- **Source/version/licence :** [API/docs v1.0.0](https://registry.modelcontextprotocol.io/docs), code source [modelcontextprotocol/registry@739b70e8bc1bea203c5a35ab699f1df51d091568](https://github.com/modelcontextprotocol/registry/commit/739b70e8bc1bea203c5a35ab699f1df51d091568); licence SPDX racine `NOASSERTION` au snapshot (le dépôt documente une transition de MIT vers Apache-2.0). La documentation officielle indique encore que le service est en preview.
- **Transport/auth :** découverte par HTTPS; lecture metadata sans secret attendu; publication par identité GitHub/OIDC ou vérification DNS selon namespace.
- **Outils/scope :** recherche, versions, metadata de packages/endpoints, validation/publication. Le registre ne sert pas le code ni les binaires.
- **Filesystem/réseau/secrets :** aucun accès filesystem local; réseau vers le registre. Un secret d’éditeur n’est nécessaire que pour publier, jamais pour la découverte ordinaire.
- **Coût :** coût d’accès public non vérifié; aucune requête de registre effectuée durant cet audit.
- **Health/dernier test :** endpoint/ping documenté mais non sondé; documentation consultée le 2026-09-12.
- **Risque/décision :** faible pour la découverte seule, élevé si l’on convertit automatiquement une entrée en exécution; `ADOPT` découverte uniquement. Les paquets restent à vérifier dans leur registre d’artefacts propre.
- **Politique d’approbation :** découverte seule sans mutation; publication ou installation jamais automatique et soumise à une approbation humaine.

### MCP-003 — FuryPipe local stdio et HTTP

- **Source/version/licence :** FuryPipe `0.13.2`, package MIT; baseline de code avant cette mise à jour du registre : `423bef619c4306557838142008a858db65b4eea1`.
- **Transport/auth :** stdio local; listener Node HTTP distinct sur chemin `/mcp`, démarrage explicite. Le mode non-loopback requiert un vérificateur Bearer fourni par l’hôte; le CLI HTTP autonome est loopback-only sans auth explicite.
- **Outils/scope :** `index_*`, `fetch_*`, range/lines, `verify_handle`, `manifest`, `delete_handle`; namespace `FURYPIPE_TENANT`; quotas et tailles bornés.
- **Filesystem :** stdio lit/écrit uniquement dans le répertoire Recovery choisi.
- **Réseau/secrets :** aucune sortie réseau en stdio; HTTP n’écoute que si l’hôte démarre le listener. Pas de credential provider intégré; chiffrement Recovery optionnel et configuré séparément.
- **Coût :** aucun coût API tiers; stockage et ressources locaux à la charge de l’hôte.
- **Health/dernier test :** tests du listener dans la CI sur le baseline `423bef619c4306557838142008a858db65b4eea1`; suite locale exécutée le 2026-09-12. OAuth et conformance client externe non testés.
- **Risque/décision :** moyen en stdio local borné; élevé si mal exposé sur HTTP; `ADOPT` comme surface native, sans activation par défaut du listener.
- **Politique d’approbation :** conserver l’opt-in du listener; `delete_handle` reste une mutation explicite bornée à son handle.

### MCP-004 — GitHub MCP Server

- **Source/version/licence :** [github/github-mcp-server@7d13a7ad6f2a17f351a6d77ce280c85ae1821f4d](https://github.com/github/github-mcp-server/commit/7d13a7ad6f2a17f351a6d77ce280c85ae1821f4d), commit du 2026-09-08; MIT.
- **Transport/auth :** stdio local ou endpoint GitHub hébergé en HTTP; OAuth ou PAT selon mode. Le serveur distant n’émet pas lui-même l’identité OAuth du client.
- **Outils/scope :** selon les toolsets activés, notamment `get_file_contents`, `issue_read`, `pull_request_read`, `create_or_update_file`, `create_pull_request` et `merge_pull_request`; le catalogue exact varie avec la version/configuration. `--read-only` retire les tools mutateurs, sans remplacer les scopes du token.
- **Filesystem :** aucun filesystem du dépôt local dans le mode API distant.
- **Réseau/secrets :** accès réseau à GitHub; OAuth/PAT requis. Limiter le PAT aux dépôts et permissions strictement nécessaires.
- **Coût :** aucun prix MCP par appel vérifié; quotas API et conditions du compte GitHub s’appliquent et n’ont pas été vérifiés ici.
- **Health/dernier test :** non connecté/non sondé; documentation/source consultées le 2026-09-12, aucun tool exécuté.
- **Risque/décision :** moyen en lecture seule, élevé avec mutation; `WRAP`, opt-in, read-only par défaut, contenu public/PR non fiable et aucune mutation sans approbation.
- **Politique d’approbation :** lecture seule par défaut; création, écriture, workflow dispatch, merge et toute mutation exigent confirmation humaine par action.

### MCP-005 — Filesystem reference server

- **Source/version/licence :** [modelcontextprotocol/servers@d73f99efbfd40c3aa1b61e88728b3d49fb52608f](https://github.com/modelcontextprotocol/servers/commit/d73f99efbfd40c3aa1b61e88728b3d49fb52608f), sous-dossier `src/filesystem`, paquet `@modelcontextprotocol/server-filesystem@0.6.3`; `package.json` indique `SEE LICENSE IN LICENSE`, le README déclare MIT, mais aucun `src/filesystem/LICENSE` n’existe à ce SHA et la détection SPDX racine vaut `NOASSERTION`. Licence de l’archive npm publiée non vérifiée.
- **Transport/auth :** stdio; pas d’auth réseau.
- **Outils/scope :** `read_file`, `read_text_file`, `read_media_file`, `write_file`, `edit_file`, `create_directory`, `move_file`, `delete_file`, recherche et navigation dans les roots; les roots dynamiques client peuvent remplacer les chemins de démarrage.
- **Filesystem :** lecture, écriture, création, déplacement et suppression sous les roots accordés; les droits OS du processus restent déterminants.
- **Réseau/secrets :** pas de sortie réseau requise par les outils de fichiers documentés; aucun secret API requis.
- **Coût :** paquet MIT local sans tarif MCP par appel identifié; ressources disque/processus locales.
- **Health/dernier test :** non exécuté le 2026-09-12. L’advisory officiel [CVE-2025-53109 / GHSA-q66q-fx2p-7w4m](https://github.com/modelcontextprotocol/servers/security/advisories/GHSA-q66q-fx2p-7w4m) documente un symlink traversal corrigé en `0.6.3`; le paquet épinglé ici est cette version, mais doit être retesté avant toute activation.
- **Risque/décision :** élevé, car les tools mutent/suppriment des fichiers et le serveur tourne avec les droits du processus; `REFERENCE_ONLY` pour le profil FuryPipe par défaut. Préférer le store Recovery/API borné; toute exception exige aussi de vérifier le fichier de licence de l’archive publiée.
- **Politique d’approbation :** ne pas connecter au profil par défaut; tout accès en écriture/suppression nécessite racine jetable, allowlist OS et approbation humaine explicite.

### MCP-006 — Git reference server

- **Source/version/licence :** [modelcontextprotocol/servers@d73f99efbfd40c3aa1b61e88728b3d49fb52608f](https://github.com/modelcontextprotocol/servers/commit/d73f99efbfd40c3aa1b61e88728b3d49fb52608f), sous-dossier `src/git`; pas de manifeste/version de paquet dans ce sous-dossier au SHA épinglé; LICENSE du sous-projet MIT, licence racine `NOASSERTION`.
- **Transport/auth :** stdio local; pas d’auth réseau.
- **Outils/scope :** `git_status`, diff, log/show, create-branch, `git_add`, `git_commit`, `git_checkout`, `git_reset`; le README du snapshot qualifie le serveur d’early development.
- **Filesystem :** lecture et mutation du dépôt local, index et refs accessibles au processus.
- **Réseau/secrets :** le README n’indique pas de push/pull/fetch pour les outils documentés; credentials Git présents dans l’environnement du processus restent à risque.
- **Coût :** serveur local MIT; ressources d’exécution locales, pas de tarif par appel identifié.
- **Health/dernier test :** non exécuté le 2026-09-12; annotations destructives cohérentes non établies par cet audit.
- **Risque/décision :** élevé pour travail partagé/non commité; `REFERENCE_ONLY`. Utiliser l’API Git native du host et la revue de diff, pas un serveur générique pouvant toucher l’index/reset.
- **Politique d’approbation :** aucune activation sur checkout de travail; checkout/reset/commit/stage interdits sans revue humaine explicite et snapshot récupérable.

### MCP-007 — PostgreSQL MCP (`crystaldba/postgres-mcp`)

- **Source/version/licence :** [crystaldba/postgres-mcp@15c8e33353546148acc2d8bd784551cf3905d1e2](https://github.com/crystaldba/postgres-mcp/commit/15c8e33353546148acc2d8bd784551cf3905d1e2), commit du 2026-08-16; MIT.
- **Transport/auth :** processus local stdio/CLI et connexion PostgreSQL; secret DB via URL/env/config du client.
- **Outils/scope :** introspection PostgreSQL et outil SQL `execute_sql`; le commit audité fournit les modes `restricted` et `SafeSqlDriver`, mais son mode par défaut reste `UNRESTRICTED`.
- **Filesystem :** aucun accès au code du projet requis par les outils documentés; fichiers de configuration/credentials restent sous contrôle de l’hôte.
- **Réseau/secrets :** connexion PostgreSQL vers l’instance choisie; URL/credential DB privilégié si le rôle l’est.
- **Coût :** aucun prix propre au serveur vérifié; le coût d’instance/hébergement PostgreSQL dépend de l’opérateur et n’a pas été mesuré.
- **Health/dernier test :** aucune base connectée le 2026-09-12. Au commit audité, le mode global et la valeur par défaut CLI sont `UNRESTRICTED`; l’issue de sécurité [#164](https://github.com/crystaldba/postgres-mcp/issues/164) est encore ouverte.
- **Risque/décision :** critique dans le mode par défaut (requêtes SQL non restreintes); `REJECT` pour l’intégration par défaut. Une réévaluation future exige le mode restreint, rôle PostgreSQL réellement read-only, base de test, réseau limité et tests de requêtes destructives/refus.
- **Politique d’approbation :** pas d’accès production; requêtes/mutations uniquement sur base jetable/read-only, après approbation humaine par action.

### MCP-008 — Supabase MCP

- **Source/version/licence :** [supabase/mcp@f36c421225515296076fb86bb8a729e5432eedca](https://github.com/supabase/mcp/commit/f36c421225515296076fb86bb8a729e5432eedca), commit du 2026-09-12; Apache-2.0. Surface de service documentée par [Supabase MCP](https://supabase.com/docs/guides/ai-tools/mcp).
- **Transport/auth :** HTTPS hébergé avec OAuth/dynamic client registration; PAT possible pour CI; endpoint local Supabase CLI également documenté.
- **Outils/scope :** toolsets groupés par `features`, scope projet via `project_ref`; noms documentés notamment `list_tables`, `list_migrations`, `apply_migration`, `execute_sql`, `query_logs`, `get_advisors`, `generate_typescript_types`, `deploy_edge_function` et `search_docs`. `read_only=true` contraint SQL mais ne rend pas chaque tool non-SQL read-only.
- **Filesystem :** pas d’accès local de l’endpoint hébergé.
- **Réseau/secrets :** requêtes/contexte transmis à Supabase; OAuth/PAT selon client, limité à un projet et aux scopes nécessaires.
- **Coût :** dépend du plan/usage Supabase et n’a pas été vérifié; aucune requête ni ressource payante utilisée durant l’audit.
- **Health/dernier test :** aucun projet connecté/probe exécuté le 2026-09-12.
- **Risque/décision :** élevé (données de projet, SQL, fonctions, branches et certaines opérations mutantes); `WRAP`, externe opt-in uniquement, un projet précis, `read_only=true`, groupe minimum, approbation tool manuelle; aucun compte de production par défaut.
- **Politique d’approbation :** lecture limitée explicitement; toute écriture, branche, fonction ou opération de projet nécessite confirmation humaine, jamais de tenant prod par défaut.

### MCP-009 — Microsoft Playwright MCP

- **Source/version/licence :** [microsoft/playwright-mcp@8a13ef8e9f7385a0f89477922127f31cbfde9761](https://github.com/microsoft/playwright-mcp/commit/8a13ef8e9f7385a0f89477922127f31cbfde9761), commit du 2026-09-03; Apache-2.0.
- **Transport/auth :** stdio avec processus navigateur local; pas d’auth MCP.
- **Outils/scope :** `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_take_screenshot`, `browser_file_upload`, `browser_evaluate` et `browser_run_code_unsafe`, plus tools optionnels réseau/storage. Plusieurs tools modifient la page ou exécutent du code; la surface varie selon les caps/configuration.
- **Filesystem :** lecture de fichiers configurée par roots; l’éditeur avertit que les roots ne constituent pas une frontière de sécurité.
- **Réseau/secrets :** accès réseau du poste aux sites ouverts; cookies/session et contenus sensibles exposés si une session connectée est réutilisée.
- **Coût :** aucun prix MCP spécifique vérifié; navigation, infrastructure du navigateur et sites tiers peuvent avoir leurs propres coûts.
- **Health/dernier test :** aucune session navigateur lancée le 2026-09-12.
- **Risque/décision :** élevé (contenu web hostile, session, réseau, downloads); `WRAP`, optionnel, profil navigateur isolé, roots minimaux, allowlist egress/hosts, aucune session personnelle, validation client réelle pour M14.
- **Politique d’approbation :** lecture/navigation opt-in dans navigateur isolé; téléchargements, authentification, soumission de formulaires et toute action mutante nécessitent confirmation humaine.

### MCP-010 — Context7

- **Source/version/licence :** [upstash/context7@6f42b66f3b6dee20ba870dd6f70f1b565eb62e6e](https://github.com/upstash/context7/commit/6f42b66f3b6dee20ba870dd6f70f1b565eb62e6e), commit du 2026-09-11; MIT.
- **Transport/auth :** endpoint remote Streamable HTTP `https://mcp.context7.com/mcp`; OAuth MCP ou clé API selon client/usage.
- **Outils/scope :** résolution d’identifiants de bibliothèques et récupération d’extraits docs (ex. `resolve-library-id`, `query-docs`); les routes REST de soumission ne sont pas des tools MCP.
- **Filesystem :** aucun accès filesystem local attendu.
- **Réseau/secrets :** requêtes de recherche envoyées au service distant; OAuth/API key selon client et niveau d’usage.
- **Coût :** plan/quota/prix non vérifiés; aucune requête payante exécutée.
- **Health/dernier test :** non sondé le 2026-09-12; disponibilité non garantie dans ce registre.
- **Risque/décision :** faible à moyen, résultats externes non fiables et dépendance réseau; `WRAP`, opt-in read-only docs, citations/version de la documentation conservées, jamais utilisé comme exécuteur.
- **Politique d’approbation :** lecture/recherche seulement; aucune route de publication/mise à jour REST n’est autorisée par ce wrapper.

### MCP-011 — Codebase Memory MCP

- **Source/version/licence :** [DeusData/codebase-memory-mcp@042a58bb1f34f725b4e5c64f1e1f966c1b1130fc](https://github.com/DeusData/codebase-memory-mcp/commit/042a58bb1f34f725b4e5c64f1e1f966c1b1130fc), snapshot source du 2026-09-12; MIT. Dernière release déclarée consultée : `v0.10.8` (2026-08-19); le code de `main` n’est pas assimilé à cette release.
- **Transport/auth :** MCP local stdio/native binary; pas d’auth MCP.
- **Outils/scope :** `index_repository`, `list_projects`, `index_status`, `search_graph`, `trace_path`, `query_graph`, `get_code_snippet`, `search_code` et `delete_project` dans le snapshot audité; les outils d’index/suppression mutent l’index local. L’installateur peut modifier une config client et lancer un processus.
- **Filesystem :** lit le dépôt sélectionné et écrit son index/config local; l’installateur peut écrire ailleurs si non confiné.
- **Réseau/secrets :** politique publiée indiquant que le code n’est pas envoyé; requête GitHub best-effort de vérification de release après `initialize`; aucune clé provider annoncée.
- **Coût :** coût API tiers non identifié; CPU, mémoire et disque locaux requis; prix non vérifié.
- **Health/dernier test :** aucun binaire/release installé ou exécuté le 2026-09-12.
- **Risque/décision :** moyen/élevé du fait du filesystem, de l’installateur/processus et du réseau de mise à jour; `WRAP` candidate uniquement après audit du binaire signé/checksum, confinement au dépôt et contrôle/désactivation du check réseau si possible. FuryPipe Knowledge/Recovery reste l’autorité de mémoire durable native.
- **Politique d’approbation :** pas d’installation/configuration client automatique; audit binaire/checksum et consentement utilisateur, dépôt unique autorisé.

### MCP-012 — Exa Search MCP

- **Source/version/licence :** [exa-labs/exa-mcp-server@15ffb50519e719dc791cdc750ce5ed1934c0a1ed](https://github.com/exa-labs/exa-mcp-server/commit/15ffb50519e719dc791cdc750ce5ed1934c0a1ed), commit du 2026-08-21; MIT.
- **Transport/auth :** endpoint hébergé HTTPS `https://mcp.exa.ai/mcp`; anonyme avec quotas limités ou OAuth/API key pour plus de capacité.
- **Outils/scope :** tools par défaut `web_search_exa` et `web_fetch_exa`; `web_search_advanced_exa` et `agent_run` sont optionnels et le dernier requiert OAuth ou une clé API.
- **Filesystem :** aucun accès local attendu au serveur hosted.
- **Réseau/secrets :** termes, requêtes et URLs transmis à Exa; credential facultatif suivant quotas/features.
- **Coût :** quota anonyme et prix API/plan non vérifiés au 2026-09-12; aucune requête exécutée.
- **Health/dernier test :** non sondé le 2026-09-12.
- **Risque/décision :** moyen/élevé (données de recherche vers tiers, contenus prompt-injectables, limites/quotas); `WRAP`, un fournisseur principal opt-in par profil, citation/source obligatoire.
- **Politique d’approbation :** requêtes limitées aux données non confidentielles; budget, quota et fournisseur autorisés avant activation.

### MCP-013 — Firecrawl MCP

- **Source/version/licence :** [firecrawl/firecrawl-mcp-server@4db752ee00910e17ec73f28b40796f0830fe86da](https://github.com/firecrawl/firecrawl-mcp-server/commit/4db752ee00910e17ec73f28b40796f0830fe86da), snapshot du 2026-09-08; MIT. Docs officielles : [Firecrawl MCP](https://docs.firecrawl.dev/mcp-server).
- **Transport/auth :** remote Streamable HTTP, notamment `https://mcp.firecrawl.dev/v2/mcp` et le profil recherche `https://mcp.firecrawl.dev/v2/mcp-search`; OAuth pour la surface complète, bearer API key en mode serveur/CI, ou accès keyless limité; mode local stdio/HTTP aussi décrit.
- **Outils/scope :** en keyless `/v2/mcp`, `firecrawl_scrape`, `firecrawl_search`, `firecrawl_parse`; `/v2/mcp-search` expose six tools read-only. Le profil complet comprend notamment `firecrawl_map`, `firecrawl_crawl`, `firecrawl_interact` et des tools research/feedback; set évolutif.
- **Filesystem :** aucun accès local dans le mode hosted; mode local distinct avec accès lié au processus installé.
- **Réseau/secrets :** URLs/contenus transmis à Firecrawl; credential selon tools/quotas; egress vers sites ciblés.
- **Coût :** quotas keyless et coûts/credits des autres modes non vérifiés; aucune requête exécutée.
- **Health/dernier test :** endpoint health documenté mais non sondé le 2026-09-12.
- **Risque/décision :** élevé (fetch/crawl de domaines arbitraires, données tierces, egress); `WRAP` opt-in, budget/profondeur/taux/domaines bornés, validation d’URL/SSRF, respect des politiques/robots/CGU et interdiction de contourner auth/paywalls. Le respect de ces règles n’a pas été certifié pour ce connecteur.
- **Politique d’approbation :** fetch/crawl opt-in et allowlistée; aucune authentification, paywall ou contrôle d’accès contourné; confirmer les requêtes à volume/coût élevés.

### MCP-014 — Grafana MCP

- **Source/version/licence :** [grafana/mcp-grafana@ffd90536d160ff4f3eb4a4fa79217455b8f22f0c](https://github.com/grafana/mcp-grafana/commit/ffd90536d160ff4f3eb4a4fa79217455b8f22f0c), commit du 2026-09-11; Apache-2.0.
- **Transport/auth :** stdio, SSE ou Streamable HTTP; service-account token vers Grafana; HTTP caller-auth séparée et seulement active si configurée.
- **Outils/scope :** exemples de noms `search_dashboards`, `get_dashboard_by_uid`, `get_dashboard_panel_queries`, `query_prometheus`, `query_loki_logs` et `update_dashboard`; les catégories/query/write tools sont configurables. Grafana documente RBAC permission + resource scope par tool.
- **Filesystem :** config locale uniquement, si mode local.
- **Réseau/secrets :** accès à l’instance Grafana et éventuellement OTLP; service-account token pour données privées. Authentification entrante MCP HTTP non activée automatiquement.
- **Coût :** dépend du plan Grafana Cloud ou de l’infrastructure autohébergée; tarif non vérifié et aucune instance utilisée.
- **Health/dernier test :** aucune instance connectée/probe exécuté le 2026-09-12.
- **Risque/décision :** moyen en lecture avec RBAC minimal, élevé si Editor/Admin ou tools write; `WRAP`, opt-in, rôle Viewer/permissions exactes et catégories read-only seulement.
- **Politique d’approbation :** lecture avec rôle Viewer minimum; toute écriture, changement d’alerting ou Admin exige confirmation humaine par action.

### MCP-015 — Snyk Studio MCP (sécurité)

- **Source/version/licence :** [snyk/studio-mcp@f9756fa80e8a6426cb2efd66ffa49b7652173ee8](https://github.com/snyk/studio-mcp/commit/f9756fa80e8a6426cb2efd66ffa49b7652173ee8), snapshot du 2026-08-19; Apache-2.0. Docs Snyk : [Studio MCP](https://docs.snyk.io/integrations/snyk-studio-agentic-integrations/getting-started-with-snyk-studio).
- **Transport/auth :** serveur local via Snyk CLI, stdio ou SSE expérimental; OAuth/login CLI ou `SNYK_TOKEN` selon environnement.
- **Outils/scope :** `snyk_sca_scan`, `snyk_code_scan`, `snyk_iac_scan`, `snyk_container_scan`, `snyk_sbom_scan`, `snyk_aibom`, `snyk_trust`, `snyk_auth`, `snyk_logout` et `snyk_version`; profils Snyk Studio filtrent la surface. `snyk_sca_scan` peut lancer des outils tiers d’écosystème (p. ex. Gradle/Maven) pour résoudre les dépendances.
- **Filesystem :** lit le dépôt/répertoire ciblé et fichiers de configuration pertinents.
- **Réseau/secrets :** communique avec Snyk; token secret. Scan SCA peut lancer des exécutables d’écosystème pour résoudre les dépendances.
- **Coût :** dépend du plan/entitlements Snyk; non vérifié et aucun compte utilisé.
- **Health/dernier test :** non installé/non exécuté le 2026-09-12; aucune cible/identité Snyk fournie.
- **Risque/décision :** élevé (lecture dépôt + egress + potentiels exécutables de build tiers); `WRAP` seulement sur demande, dans un checkout isolé, avec profil scan limité et sans exécution implicite de build scripts non approuvés.
- **Politique d’approbation :** uniquement scan local autorisé; aucune écriture, auth, upload privé ou exécution de build tiers sans approbation explicite.

### MCP-016 — Figma MCP

- **Source/version/licence :** service hébergé sans source/version de binaire publique ni licence d’artefact identifiée; endpoint officiel `https://mcp.figma.com/mcp`, [guide Figma MCP](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server) et [liste officielle des outils](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/) consultés le 2026-09-12; conditions du service non auditées.
- **Transport/auth :** remote Streamable HTTP et OAuth Figma; variante desktop locale via app Figma.
- **Outils/scope :** lecture `get_design_context`, `get_metadata`, `get_screenshot`, `download_assets`, `get_variable_defs`, `get_motion_context`, `get_figjam`; écriture `use_figma`, `create_new_file`, `generate_diagram`, `upload_assets`, `generate_figma_design`, outils plugins/shaders/Code Connect. Tool list évolutive selon version et compte.
- **Filesystem :** serveur remote n’accède pas au filesystem local; le client agent peut ensuite écrire le code retourné dans son workspace. Desktop dépend du processus Figma local.
- **Réseau/secrets :** design/context et URLs de fichiers transmis au service Figma; accès aux fichiers selon le compte OAuth et ses permissions.
- **Coût :** usage MCP indiqué gratuit pendant la beta au 2026-09-12; Figma annonce une évolution future vers usage payant. Les écritures canvas remote sont limitées aux seats Dev/Full des plans payants; ne pas figer ce prix comme contrat durable.
- **Health/dernier test :** aucune connexion/session Figma ni tool exécuté le 2026-09-12; doc-only check.
- **Risque/décision :** moyen en lecture, élevé pour write-to-canvas/design; `WRAP`, opt-in et liste de fichiers/workspaces précise.
- **Politique d’approbation :** lecture selon OAuth et partage autorisés; création, édition, upload ou suppression dans Figma requiert confirmation humaine par action.

### MCP-017 — 21st MCP (ancien Magic MCP)

- **Source/version/licence :** wrapper officiel [21st-dev/magic-mcp@6b5299e8a83ceffa73d4fc4e148905bb3eeeeb55](https://github.com/21st-dev/magic-mcp/commit/6b5299e8a83ceffa73d4fc4e148905bb3eeeeb55), paquet `@21st-dev/magic@0.2.3`, ISC. Depuis `0.2.0` il relaie vers le service distant; cette licence ne couvre pas l’implémentation SaaS non publiée. Endpoint `https://21st.dev/api/mcp`; [docs MCP/CLI officielles](https://docs.21st.dev/mcp).
- **Transport/auth :** remote Streamable HTTP; API key `x-api-key`, token CLI ou OAuth selon client.
- **Outils/scope :** `search`, `get_component`, `get_inspiration`, `generate`, `search_logo`; outils additionnels de génération, retrieval, publication/édition/suppression et profil selon catalogue/compte. La liste réelle est dynamique.
- **Filesystem :** service MCP distant sans accès local; le CLI de compatibilité/setup peut écrire une config client; l’installation du code dans le repo est une action distincte de l’agent.
- **Réseau/secrets :** prompts, requêtes de catalogue, code/contenu publié envoyés au service 21st; API key/session requise.
- **Coût :** docs indiquent recherche/publication/gestion gratuites, installs limitées à deux/jour, génération IA consommant des crédits; aucun prix monétaire ni balance vérifiés le 2026-09-12.
- **Health/dernier test :** endpoint non sondé et aucun tool/compte exécuté le 2026-09-12; lecture docs + wrapper source seulement.
- **Risque/décision :** moyen pour search/read, élevé pour génération, publication ou suppression; `WRAP` opt-in, catalogue read-only par défaut.
- **Politique d’approbation :** installer/écrire du code dans le dépôt, consommer des crédits, publier, éditer ou supprimer du contenu exigent approbation humaine explicite.

### MCP-018 — Perplexity API Platform MCP

- **Source/version/licence :** [perplexityai/modelcontextprotocol@c73c8561bbc2d9eb666334a53c311b50f4f4cf76](https://github.com/perplexityai/modelcontextprotocol/commit/c73c8561bbc2d9eb666334a53c311b50f4f4cf76), paquet `@perplexity-ai/mcp-server@1.2.1`, MIT; service API distant reste soumis aux conditions Perplexity. [Docs API Platform et crédits](https://www.perplexity.ai/help-center/en/articles/10354842-what-is-the-perplexity-api-platform).
- **Transport/auth :** endpoint remote Streamable HTTP `https://api.perplexity.ai/mcp` avec Bearer API key; package local stdio/HTTP également fourni.
- **Outils/scope :** `perplexity_search`, `perplexity_ask`, `perplexity_research`, `perplexity_reason`; recherches web, réponses/reasoning et tâches de recherche distantes.
- **Filesystem :** aucun accès au dépôt local par les tools documentés; le client/package local lit uniquement config/env et n’a pas besoin d’ouvrir le code source.
- **Réseau/secrets :** requêtes, prompts, filtres de recherche et URLs envoyés à l’API Perplexity; API key obligatoire.
- **Coût :** API Platform utilise des crédits payants; le montant par tool/requête n’a pas été vérifié; aucune requête exécutée.
- **Health/dernier test :** endpoint/clé non testés le 2026-09-12; docs et source officielle uniquement.
- **Risque/décision :** moyen/élevé (transfert de requêtes et dépendance à modèle/recherche distante); `WRAP` opt-in, prompts non confidentiels, citation des sources et budget borné.
- **Politique d’approbation :** toute activation exige clé fournie par l’hôte et budget autorisé; research/reason coûteux soumis à confirmation humaine ou quota strict.

### MCP-019 — WordPress MCP Adapter

- **Source/version/licence :** [WordPress/mcp-adapter@23cb53e0b82f39238eec1c38cb055e28aa30fa7c](https://github.com/WordPress/mcp-adapter/commit/23cb53e0b82f39238eec1c38cb055e28aa30fa7c), release `v0.6.1` (2026-08-13), GPL-2.0-or-later; [guide officiel d’intégration](https://developer.wordpress.org/news/2026/02/from-abilities-to-ai-agents-introducing-the-wordpress-mcp-adapter/).
- **Transport/auth :** WP-CLI stdio pour site local; HTTP site endpoint via remote proxy; WordPress Application Password ou OAuth custom selon topologie.
- **Outils/scope :** outils par défaut `mcp-adapter-discover-abilities`, `mcp-adapter-get-ability-info`, `mcp-adapter-execute-ability`; seules les abilities explicitement exposées (`meta.mcp.public`) sont listées; plugins peuvent étendre le périmètre.
- **Filesystem :** WP-CLI local reçoit le chemin de l’installation WordPress et agit avec droits OS/PHP; le proxy hébergé n’a pas besoin du workspace FuryPipe.
- **Réseau/secrets :** mode HTTP transmet les arguments/résultats au site WordPress via `/wp-json/mcp/...`; compte WordPress et Application Password/OAuth à moindre privilège.
- **Coût :** aucun frais MCP par appel annoncé dans les docs consultées; hébergement, plugin et services WordPress tiers peuvent être payants, non vérifiés.
- **Health/dernier test :** aucune installation, connexion ou ability exécutée le 2026-09-12; doc/source review uniquement.
- **Risque/décision :** élevé car `execute-ability` appelle des fonctions WordPress/plugins arbitraires exposées; `WRAP` opt-in par site et allowlist d’abilities.
- **Politique d’approbation :** n’exposer que capabilities minimales; publication, suppression, utilisateurs, réglages et mutation de contenu exigent consentement humain par action; ne jamais employer un compte admin par défaut.

## Décisions transversales

| Domaine | Décision FuryPipe | Garde-fou principal |
|---|---|---|
| Filesystem / Git local | `REFERENCE_ONLY` par défaut | droits OS, racines isolées, aucune mutation d’index/reset implicite |
| GitHub / Supabase / Grafana | `WRAP` opt-in | read-only, scope ressource précis, OAuth/token minimum, approbation pour writes |
| PostgreSQL générique audité | `REJECT` dans son défaut actuel | valeur par défaut unrestricted confirmée dans le code source épinglé |
| Playwright / scraping | `WRAP` opt-in | navigateur isolé, allowlist egress, budget, host consent, contenus hostiles traités comme données |
| Documentation / recherche | `WRAP` opt-in | sources citées, résultats non fiables, secrets et code privé exclus des requêtes |
| Figma / 21st / Perplexity / WordPress | `WRAP` opt-in | allowlist compte/projet; confirmer écriture, publication, crédits et capacités de contenu |
| Codebase memory | candidate `WRAP` locale | binaire/signature/checksum, dépôt borné, installateur/config, comportement réseau explicite |
| MCP Registry / npm | `ADOPT` pour découverte et résolution d’artefacts seulement | metadata ≠ code; pinning, licence, checksum/provenance et revue avant exécution |

## État des preuves

- **STATIQUE_OK :** métadonnées de dépôts/licences/commits relevées par GitHub; docs officielles MCP/auth/Registry, GitHub, Filesystem/Git, PostgreSQL, Supabase, Playwright, Context7, Figma, 21st, Perplexity, WordPress, Grafana, Firecrawl et Snyk consultées; défaut PostgreSQL `UNRESTRICTED` confirmé au commit épinglé.
- **NOT_EXECUTED :** aucun connecteur externe installé, aucun compte/token fourni, aucun démarrage/tool/transport/conformance/OAuth/health probe réel, aucun test de permissions sur tenant, aucune requête facturable.
- **BLOCKED_EXTERNAL_ENV :** validation connectée nécessitant compte/token, instance DB/Grafana/Supabase/WordPress/Figma ou autorisation réseau réelle. Aucune de ces valeurs n’a été demandée ni créée.
