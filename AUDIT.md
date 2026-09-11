# FuryPipe V5 — audit de hardening

## P0 traités sur cette branche

| Point | Correction | Preuve |
|---|---|---|
| IDs Context IR répétitifs | portée de requête, provenance, range, ordinal et hash dans l’ID déterministe | `tests/context-fabric.test.ts` |
| Compilation Unicode | segmentation grapheme, ranges UTF-8 exacts, CRLF non séparé | `tests/document-compiler.test.ts` |
| Instruction Ledger | une dernière requête utilisateur active par scope, historique conservé, supersedes et validation de hash | `tests/context-fabric.test.ts` |
| ExactGuard runtime | gate réel avant les chemins lossy, pass-through natif conservateur | `tests/keep-sharp.test.ts` |
| Recovery/MCP | quota, sérialisation d’écriture, TTL/GC et outils bytes/range/manifest/delete | `tests/recovery-store.test.ts`, `tests/mcp.test.ts` |

## Limites vérifiées

- ExactGuard est activé explicitement par `TransformOptions.exactGuard`. Quand
  il détecte une valeur protégée, la représentation reversible externalize/redact
  n’est pas encore sélectionnée : le choix sûr est le pass-through natif.
- La portée de la segmentation est celle des graphemes Unicode via
  `Intl.Segmenter` ; une validation visuelle client ou provider n’est pas
  déduite des tests locaux.
- Le Recovery Store n’a pas encore de chiffrement-at-rest, backup/restore,
  backend SQLite, ACL Windows explicites ou GC des objets sans manifest.
- Le MCP livré est stdio local. Aucun serveur HTTP sécurisé, OAuth ou test de
  conformance externe n’est déclaré.

Les limites sont des statuts PARTIAL/BLOCKED, pas des validations silencieuses.
