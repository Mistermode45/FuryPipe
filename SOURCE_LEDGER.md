# Source ledger — FuryPipe

| ID | Source | Type | Référence | Accès | Licence / provenance | Décision | Confiance |
|---|---|---|---|---|---|---|---|
| SRC-001 | https://github.com/teamchong/pxpipe | dépôt upstream | `8ba82b713a1e823bc1c09b7a68e47f63caa7b426` | 2026-09-11 | MIT déclaré ; copyright du fichier `LICENSE` = `claude-image-proxy contributors` ; attribution à clarifier avant publication | Base locale FuryPipe, non publiée | vérifiée statiquement |
| SRC-002 | https://github.com/Mistermode45/FuryPipe | dépôt cible | dépôt vide au clone | 2026-09-11 | Propriété du dépôt cible, aucun code présent avant import upstream | Destination locale, pas une preuve de publication | vérifiée |
| SRC-003 | https://nodejs.org/en/about/previous-releases | documentation officielle | Node.js 26.8.2 | 2026-09-11 | Release actuelle vérifiée ; MSI officiel SHA-256 vérifié localement | Toolchain locale | vérifiée |
| SRC-004 | https://docs.npmjs.com/trusted-publishers/ | publication/provenance npm | documentation consultée | 2026-09-11 | OIDC trusted publishing ; npm >=11.5.1 et Node >=22.14.0 ; provenance automatique sous conditions | Release future seulement, aucune publication faite | vérifiée documentaire |
| SRC-005 | https://docs.openclaw.ai/plugins/manifest | OpenClaw plugin manifest | documentation consultée | 2026-09-11 | Plugin natif = `openclaw.plugin.json` ; bundles compatibles ont leurs manifests propres | Adapter non activé/testé | vérifiée documentaire |
| SRC-006 | https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization | MCP authorization | spec consultée | 2026-09-11 | HTTP auth OAuth/resource indicators ; stdio traite les credentials via environnement | MCP non implémenté | vérifiée documentaire |
| SRC-007 | https://registry.npmjs.org/furypipe | disponibilité npm | `npm view` HTTP 404 | 2026-09-11 | Aucun package public `furypipe` trouvé au moment du contrôle | Identité npm libre à revérifier avant publication | vérifiée ponctuellement |
| SRC-008 | https://github.com/teamchong/pxpipe | dépôt étudié pour comparaison | `8ba82b713a1e823bc1c09b7a68e47f63caa7b426` | 2026-09-11 | MIT upstream | Conserver les chemins provider/proxy éprouvés ; ne pas copier sans licence/portée | vérifiée par remote |
| SRC-009 | https://github.com/affaan-m/ECC | dépôt étudié pour workflow | `c9148d0bb239ed01a95724a5928b98cdf9c30658` | 2026-09-11 | provenance GitHub vérifiée ; licence détaillée à revoir avant intégration de code | Retenir les principes de gates/review, aucune copie de code dans ce checkpoint | vérifiée par remote |
| SRC-010 | https://github.com/mattpocock/skills | dépôt étudié pour skills | `3cca18b368ae95cdbdebbff572ccafa662551015` | 2026-09-11 | provenance GitHub vérifiée ; licence détaillée à revoir avant vendoring | Retenir les workflows réutilisables, aucune copie de code dans ce checkpoint | vérifiée par remote |

Ce ledger sera enrichi avec les sources réellement consultées. Une URL listée dans le master prompt n'est pas une preuve de lecture.
