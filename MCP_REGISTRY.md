# MCP registry — état local 2026-09-11

Aucun serveur MCP externe n'est installé, activé ou autorisé. FuryPipe possède toutefois un serveur local stdio implémenté dans `src/mcp.ts`; il n'est pas démarré par défaut. Les intégrations MCP restent soumises à provenance, classification des tools, auth, limites, conformance et rollback.

| Identifiant | Source | Version/SHA | Transport | État | Preuve |
|---|---|---|---|---|---|
| `furypipe-mcp` local | `0.13.2` local | stdio JSON-RPC | environnement local / pas d’HTTP | IMPLEMENTED_NOT_ACTIVE | index/fetch/verify bornés ; pas de credentials provider |
| MCP HTTP externe | — | HTTP | OAuth/resource indicators requis si activé | BLOCKED | aucun serveur ni test de conformance |
