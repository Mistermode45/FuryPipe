# Skills — matrice licence et confiance

Aucune Skill tierce n'est vendored ou activée par ce checkpoint.

| Source / skill | SHA/version | Licence vérifiée | État | Justification |
|---|---|---|---|---|
| Skills locales Codex/Caveman | versions locales de l’environnement | non applicable au code FuryPipe | référence interne uniquement | utilisées pour le workflow, pas vendored |

Toute future source externe doit être résolue vers un SHA, lue, scannée et classée avant copie ou exécution.


## Runtime registry rule

`src/skill-registry.ts` is now the executable trust gate for host-provided skills.

- `REFERENCE_ONLY` and `REJECT` sources cannot become executable.
- External executable sources require a credential-free HTTPS repository, an exact 40-character commit SHA and `VERIFIED` license status.
- The registry does not fetch source code.
- The registry currently contains no bundled third-party registration.
- Local callbacks still pass through Agent Runtime permission/network/health/budget enforcement.

The existence of a source in `SOURCE_LEDGER.md` or in this matrix is not authorization to execute it.


## Sources requested 2026-09-12

| Source | Pinned SHA / version | Licence status | Runtime decision |
|---|---|---|---|
| Ponytail | `356918eba965ee1eac64bd3a7f0dd02108350de5` | MIT verified | reference only |
| Addy Osmani Agent Skills | `be4e44a9fbc5e8df0beaefadbb28bd22ee61cc39` | MIT verified | reference only until per-skill review |
| Agency Agents | `6d29a9b08785a0e49ffc9818bbdd381164c2df5f` | MIT verified | reference only |
| OneWave Claude Skills | `82859c0ebaff803889be6ca2efa0834ba8787773` | MIT verified | reference only until per-skill review |
| Tons of Skills Marketplace | `a58233ed4b9a9fda3ff0d37a304a570f4cc98083` | MIT verified | reference only; marketplace entries do not inherit trust |
| UI Skills | live catalogue | mixed/unknown by individual skill | reference only |
| Supabase AI plugin | official docs | external service/plugin | explicit opt-in only |
| Context7 | official docs | external service/plugin | explicit opt-in only |
| HorizonX | commercial | commercial | reference only |
| OpenMontage | `08e2151fa02de28a5d6a312b3d575692bf147ad7` | AGPL-3.0 verified | reference only |
| Claude Squad | `ce1ffb4392b01f38e2c4599c7c84d2a93973b138` | AGPL-3.0 verified | reference only |

No entry above is automatically registered as executable. The runtime registry still requires a separate host-provided definition plus provenance, permission, network and health gates.
