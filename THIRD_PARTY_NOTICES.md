# Third-party notices — état local

Inventaire généré depuis le lockfile installé avec `pnpm licenses list --json` le 2026-09-14. Il décrit les packages présents dans l’environnement de build ; il ne remplace pas une revue juridique ni un SBOM de release.

## Comptage par licence

| Licence déclarée | Packages |
|---|---:|
| MIT | 61 |
| Apache-2.0 | 9 |
| MIT OR Apache-2.0 | 4 |
| ISC | 3 |
| MPL-2.0 | 2 |
| Apache-2.0 AND LGPL-3.0-or-later | 1 |
| CC0-1.0 | 1 |
| BSD-3-Clause | 1 |

## Notices à conserver

- Le package racine upstream déclare MIT. Son fichier `LICENSE` contient toutefois le copyright `claude-image-proxy contributors`; l’attribution doit être clarifiée avant une publication FuryPipe.
- Les assets présents doivent conserver leurs notices : `assets/JETBRAINS_MONO_LICENSE.txt`, `assets/SPLEEN_LICENSE.txt` et `assets/UNIFONT_LICENSE.txt`.
- La dépendance `@img/sharp-win32-x64` déclare `Apache-2.0 AND LGPL-3.0-or-later`; cette obligation combinée doit rester visible dans tout bundle qui l’embarque.
- `lightningcss` et son binding Windows déclarent MPL-2.0 ; `source-map-js` déclare BSD-3-Clause ; `@speed-highlight/core` déclare CC0-1.0.
- `blake3-wasm` est présent transitivement et déclare MIT, mais n’est pas ajouté comme dépendance directe dans cette tranche.
- `json5@2.2.3` déclare MIT et est la dépendance directe utilisée pour lire les configurations JSON5 OpenClaw ; son avis reste inclus dans l’inventaire du lockfile.
- `playwright@1.63.0` et `playwright-core@1.63.0` déclarent Apache-2.0 ; Playwright est une dépendance directe de développement épinglée pour la QA navigateur multi-moteur. Les navigateurs Playwright sont des binaires de test téléchargés par cette version épinglée et ne sont pas inclus dans le package FuryPipe publié.

## État release

`pnpm audit --prod --audit-level high` était vert lors de l’inventaire local du 2026-09-14. Cet inventaire de licences n’est pas lui-même un SBOM source-bound ni une attestation signée. `npm view furypipe` retournait HTTP 404 lors du contrôle du 2026-09-14, ce qui n’est pas une réservation de nom. La publication reste interdite sans autorisation explicite du maintainer.
