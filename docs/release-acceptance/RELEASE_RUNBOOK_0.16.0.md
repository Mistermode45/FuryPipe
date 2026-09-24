# FuryPipe 0.16.0 — authorized release runbook

Ce runbook est préparé uniquement. Les commandes ci-dessous ne doivent pas
être exécutées depuis le RC tant que Mathis n’a pas donné l’autorisation
explicite correspondant à l’étape.

## Variables et préconditions

~~~powershell
$Repo = 'Mistermode45/FuryPipe'
$Pr = '226'
$Version = '0.16.0'
$Tag = "v$Version"
~~~

Avant toute mutation :

~~~powershell
gh pr view $Pr -R $Repo --json state,isDraft,headRefOid,baseRefName,baseRefOid,mergeStateStatus
gh pr checks $Pr -R $Repo
~~~

Conditions obligatoires :

- PR non obsolète et head vérifié;
- tous les checks requis verts sur le head final;
- acceptance visuelle et screen reader traitées selon le périmètre déclaré;
- collision npm absente;
- provenance planifiée sur l’événement autorisé;
- autorisation explicite de Mathis pour l’étape en cours.

## A. Merge

Le PR est actuellement Draft. Après acceptance humaine et autorisation :

~~~powershell
gh pr ready $Pr -R $Repo
gh pr checks $Pr -R $Repo --watch
gh pr merge $Pr -R $Repo --merge --delete-branch=false
~~~

Le choix de méthode doit être remplacé si la policy du dépôt impose une autre
méthode. Ne pas forcer le merge et ne pas contourner les checks requis.

Après le merge :

~~~powershell
gh pr view $Pr -R $Repo --json state,mergedAt,mergeCommit,baseRefName
~~~

Si un check devient rouge ou si le head change, arrêter le runbook, conserver
les artefacts et ouvrir une nouvelle préparation sur le SHA réellement
mergé. Ne pas réutiliser les preuves du RC précédent.

## B. Tag

Récupérer le SHA de la branche de release après merge et vérifier son
ancêtre avant de créer le tag :

~~~powershell
git fetch origin --tags --prune
$ReleaseBranch = (gh repo view $Repo --json defaultBranchRef --jq '.defaultBranchRef.name')
$ReleaseSha = (git rev-parse "origin/$ReleaseBranch").Trim()
git merge-base --is-ancestor $ReleaseSha "origin/$ReleaseBranch"
git show "$ReleaseSha:package.json" | Select-String '"version": "0.16.0"'
~~~

Après autorisation tag explicite seulement :

~~~powershell
git tag -a $Tag $ReleaseSha -m "release: FuryPipe $Version"
git push origin $Tag
~~~

Ne jamais déplacer un tag publié. Si le SHA est mauvais, arrêter et préparer
une correction; ne pas utiliser git push --force.

## C. GitHub Release

Le tag déclenche .github/workflows/release.yml, qui vérifie la version,
l’ancêtre du tag et crée la GitHub Release après le job de publication.

Suivre le run sans relancer aveuglément :

~~~powershell
gh run list -R $Repo --workflow release.yml --limit 5
gh run view <RELEASE_RUN_ID> -R $Repo --log-failed
gh release view $Tag -R $Repo --json tagName,isDraft,isPrerelease,url,assets
~~~

Le workflow doit créer la release avec --verify-tag --generate-notes. Une
création manuelle n’est qu’un fallback autorisé si le workflow de release a
réussi la publication mais n’a pas créé la release :

~~~powershell
gh release create $Tag -R $Repo --verify-tag --generate-notes
~~~

## D. Provenance

Le job de publication utilise npm Trusted Publishing/OIDC et
npm publish --provenance. Pour l’attestation d’artefact GitHub séparée, sur
un événement non-PR et une branche éligible selon
.github/workflows/provenance.yml :

~~~powershell
gh workflow run provenance.yml -R $Repo --ref $ReleaseBranch
gh run list -R $Repo --workflow provenance.yml --limit 5
gh run view <PROVENANCE_RUN_ID> -R $Repo --log-failed
~~~

L’attestation doit référencer le tarball exact, son SHA-256, le source SHA et
le run ID. Une préparation locale ou une preuve PR ne remplace pas cette
attestation non-PR.

## E. npm publish

La publication normale est exécutée par GitHub Actions, pas depuis le poste
local :

~~~text
npm install --global --ignore-scripts npm@12.0.2
npm publish --access public --provenance
~~~

Ces commandes sont la séquence du job publish et ne doivent pas être
copiées dans un terminal local comme contournement. Le job vérifie d’abord la
collision de version et ignore une publication déjà présente.

Si le job échoue :

1. consulter le log et l’état npm;
2. vérifier si furypipe@0.16.0 existe déjà;
3. ne pas relancer à l’aveugle;
4. ne relancer le workflow qu’après décision explicite et compréhension de la
   cause.

## F. Vérification post-publication

Exécuter uniquement lorsque la publication et la GitHub Release sont
confirmées. Utiliser le document
[POST_PUBLISH_VERIFICATION_0.16.0.md](POST_PUBLISH_VERIFICATION_0.16.0.md).

## Rollback et arrêt sûr

- Avant le tag : arrêter; aucune mutation registry n’est attendue.
- Après tag mais avant publication : ne pas déplacer le tag; documenter le
  problème et préparer un correctif sur une nouvelle version/branche.
- Après publication npm : traiter les versions comme immuables; publier une
  version corrective après les mêmes gates plutôt que remplacer les octets.
- Après une GitHub Release défectueuse : documenter, préparer une correction,
  refaire les preuves, puis décider séparément d’une nouvelle publication.
- Pour toute étape ambiguë : STOP, inspection read-only, puis décision
  humaine. Aucun force push, reset destructif ou deploy automatique.
