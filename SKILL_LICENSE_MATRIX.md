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
