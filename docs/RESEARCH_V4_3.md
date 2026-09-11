# Recherche delta V4.3 — 2026-09-11

## Réponses actuelles

1. **Évolution pxpipe depuis le SHA de travail :** non comparée à un SHA V4.2 distinct ; le point de départ local est `8ba82b713a1e823bc1c09b7a68e47f63caa7b426`. Les PR/issues publiques visibles ont été inventoriées, mais aucune PR n’a été cherry-pickée.
2. **OpenClaw :** la documentation actuelle exige `openclaw.plugin.json` pour un plugin natif et distingue les bundles compatibles. Le runtime OpenClaw n’est pas installé localement.
3. **npm dist-tags :** `npm view furypipe name version --json` retourne actuellement HTTP 404 (`NPM_VIEW_EXIT=1`) ; aucun package FuryPipe n’existe dans le registry sous cette mission. Le plan stable/prerelease reste à tester sur registre local ou tarball.
4. **Node supporté :** package upstream exige `node >=20.19`; l’environnement local est Node `26.8.2`. La matrice de support FuryPipe n’est pas encore élargie.
5. **Trail of Bits Skills :** non activées ni vendored ; aucun SHA n’est approuvé.
6. **Licences :** inventaire local dans `THIRD_PARTY_NOTICES.md`; la licence MIT upstream et l’attribution du fichier `LICENSE` nécessitent une clarification avant publication.
7. **Snyk Agent Scan :** non exécuté ; aucune conclusion de couverture n’est permise.
8. **OWASP :** sources OWASP/scanners non encore intégrés à la CI ; aucune conformité revendiquée.
9. **OS/agents :** Windows local validé pour le build et les tests Node ; macOS/Linux, Docker, OpenClaw et agents externes restent `NOT_TESTED`.
10. **Nouveaux risques Skills/MCP :** la spec MCP consultée rappelle consentement, contrôle des tools et protection des ressources ; l’autorisation HTTP doit suivre OAuth/resource indicators si elle est implémentée.

## Sources primaires consultées

- Node : https://nodejs.org/en/about/previous-releases
- npm trusted publishing : https://docs.npmjs.com/trusted-publishers/
- OpenClaw manifest : https://docs.openclaw.ai/plugins/manifest
- OpenClaw SDK subpaths : https://docs.openclaw.ai/plugins/sdk-subpaths
- MCP authorization : https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP base specification : https://modelcontextprotocol.io/specification/2025-03-26/index

Les sources de découverte ne sont pas traitées comme preuve normative. Les intégrations externes restent désactivées tant que version, licence, SHA, tests et politique d’échec ne sont pas documentés.
