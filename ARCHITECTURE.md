# FuryPipe V5 — architecture

## Flux de référence

Une requête suit le flux suivant :

`provider request → parseur de protocole → Context IR → classifier → Instruction Ledger → ExactGuard → cache planner/policy → transformer → Recovery → vérification → provider adapter`.

Le code historique de transformation reste dans `src/core/transform.ts`, tandis que les primitives V5 sont isolées dans :

- `context-ir.ts` : blocs typés, hashes et identité structurelle ;
- `document-compiler.ts` : découpage grapheme-safe et ranges UTF-8 ;
- `instruction-ledger.ts` : portée, précédence, supersession et état actif/historique ;
- `exact-guard.ts` : détection déterministe et manifestes sans plaintext ;
- `recovery-store.ts` : objets CAS SHA-256, namespace, quota, TTL/GC et intégrité ;
- `mcp.ts` : transport JSON-RPC stdio et outils de récupération bornés.

## Propriété des données

Le texte source appartient à l’appelant. Le Context IR et le Recovery Store ne
retiennent respectivement qu’un hash/range et, lorsque demandé, les bytes
persistés. Les receipts et diagnostics n’exposent pas le plaintext.

Le Recovery Store utilise le filesystem comme backend actuel. Les handles sont
immuables et namespacés ; les écritures de même store sont sérialisées et
installées par fichier temporaire puis rename.

## Frontières non encore câblées

Le router provider, les adapters OpenClaw/HTTP MCP, le dashboard V5, le
registry agents/skills/MCP, les fallbacks multi-provider, SQLite/object-store,
les backups/restores et la validation Paper/serveur restent des travaux
distincts. Ils ne sont pas déclarés implémentés par la présence des primitives.
