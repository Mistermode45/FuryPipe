# FuryPipe 0.16.0 — post-publish verification plan

Ce plan est à exécuter seulement après un merge, un tag et une publication
explicitement autorisés. Il n’a pas été exécuté pendant le gel RC.

## 1. Registry identity and provenance

~~~powershell
$Repo = 'Mistermode45/FuryPipe'
$Version = '0.16.0'
$Tag = "v$Version"

npm view "furypipe@$Version" version --json
npm view "furypipe@$Version" dist.integrity --json
npm view "furypipe@$Version" gitHead --json
npm view "furypipe@$Version" dist.attestations.provenance --json
~~~

Expected:

~~~text
version = 0.16.0
dist.integrity = non-empty sha512 integrity
gitHead = the authorized release commit
dist.attestations.provenance = present/verified
~~~

The gitHead must be compared with the authorized release SHA, not with the
old RC baseline. A missing provenance field is a failed post-publish check,
not an implicit PASS.

## 2. Fresh npm installation

Use a new temporary directory and do not reuse the RC acceptance directory:

~~~powershell
$Fresh = Join-Path $env:TEMP 'furypipe-0.16.0-post-publish'
New-Item -ItemType Directory -Force -Path $Fresh | Out-Null
Set-Location $Fresh
npm init -y
npm install --ignore-scripts furypipe@0.16.0
npx --no-install furypipe --version
npx --no-install furypipe setup --lang=fr --yes --no-color
npx --no-install furypipe doctor --json
~~~

Expected:

~~~text
0.16.0
doctor exits with a truthful runtime/readiness report
no provider credential is printed
~~~

## 3. Minimal package smoke

From the same fresh directory:

~~~powershell
node -e "import('furypipe').then(m => { if (!m) process.exit(1); console.log('core export loaded') })"
npx --no-install furypipe --help
npx --no-install furypipe task --plan "inspect installed package" --json
~~~

The task plan must remain a plan: it must not execute a provider, MCP tool or
external capability. Any live provider test is outside this post-publish core
smoke.

## 4. GitHub release and artifact digest

~~~powershell
gh release view $Tag -R $Repo --json tagName,isDraft,isPrerelease,url,assets
~~~

For each attached release asset, record its displayed digest and compare it
with the expected artifact. The current release workflow creates the GitHub
Release and generated notes but does not promise a binary release asset; if
assets is empty, record NO_ASSET_ATTACHED rather than inventing a digest.
The npm tarball remains verified through the registry package digest and npm
provenance fields.

If an attested tarball was uploaded by the provenance workflow, verify it with
the GitHub CLI from the downloaded file:

~~~powershell
gh attestation verify .\furypipe-0.16.0.tgz -R $Repo
~~~

## 5. Final record

Store only redacted, non-secret evidence:

~~~text
PUBLISHED_VERSION = 0.16.0
PUBLISHED_GIT_HEAD = <authorized release SHA>
REGISTRY_INTEGRITY = <sha512 value>
NPM_PROVENANCE = PASS / FAIL
FRESH_INSTALL = PASS / FAIL
VERSION_COMMAND = PASS / FAIL
DOCTOR = PASS / FAIL
PACKAGE_SMOKE_MINIMAL = PASS / FAIL
GITHUB_RELEASE = PASS / FAIL
GITHUB_ASSET_DIGEST = VERIFIED / NO_ASSET_ATTACHED / FAIL
~~~

Do not include npm tokens, provider keys, bootstrap codes, raw provider
responses, user prompts or private screenshots in the record.
