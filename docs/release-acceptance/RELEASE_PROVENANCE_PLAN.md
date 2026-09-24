# FuryPipe 0.16.0 — provenance et autorité de release

## Préparation réalisée dans ce track

Le candidat doit produire, sur son SHA exact :

- le tarball furypipe-0.16.0.tgz construit avec npm pack --ignore-scripts ;
- sa taille, son SHA-256 et son inventaire de fichiers ;
- un SBOM SPDX 2.3 issu du lockfile gelé et vérifié ;
- l’évidence d’installation fraîche et d’upgrade/rollback ;
- les digests des documents de migration, compatibilité, rollback et release ;
- les résultats CI hosted liés au même head SHA.

scripts/rc-preparation.mjs produit cette préparation sous
artifacts/rc-preparation/. Ce répertoire est local/CI-only et n’est pas
publié dans le dépôt ni dans le tarball.

## Frontières d’autorité

Le workflow .github/workflows/provenance.yml valide et, sur un événement
éligible non-PR, peut créer une attestation d’artifact GitHub. Il ne crée pas
de tag, de GitHub Release, de publication npm ou de déploiement.

Le workflow .github/workflows/release.yml reste le chemin de publication
autorisé par tag. Dans ce track :

    MERGE       = NO
    RELEASE     = NO
    TAG         = NO
    NPM PUBLISH = NO
    DEPLOY      = NO

Une attestation ou un tarball valide ne constitue pas une autorisation de
release. Le mainteneur doit encore confirmer le SHA, la version, le diff, la
provenance, les validations manuelles et le périmètre d’action.

## Conditions de promotion

La promotion vers une release publique exige au minimum :

1. tous les gates automatisables verts sur le head final ;
2. package, SBOM, upgrade, rollback et récupération liés au même SHA ;
3. E5/E6 complétés lorsque les surfaces concernées sont dans le scope ;
4. E7 attestée sur l’événement autorisé ;
5. E8 explicitement autorisée ;
6. aucune collision de version registry ;
7. aucune mutation de production ou de registry exécutée par ce track avant
   l’autorisation dédiée.
