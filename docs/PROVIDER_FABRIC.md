# Provider / Model Fabric — état local

`src/core/provider-fabric.ts` ajoute une registry locale, pure et metadata-only
autour du routeur historique. Elle ne remplace pas `src/core/provider-router.ts`
et ne contacte aucun provider.

## Résolution

La priorité de routage est :

1. route provider explicite déjà déterminée par l’appelant ;
2. famille déduite de l’identifiant modèle (`claude`, `gemini`, `gpt`/`o`) ;
3. protocole fourni ;
4. valeur par défaut du registre.

Chaque résultat porte une raison explicite, le protocole, les alias, le préfixe
de route et l’évidence locale. Une route inconnue ne peut pas être transformée
en provider sain par simple présence dans une chaîne.

## Capacités et coût

Anthropic dispose d’un contrat local de cache préfixe (minimum 1 024 tokens,
marqueurs explicites, TTL déclarés) parce que le planner interne l’exige déjà.
Les contrats cache OpenAI et Google restent `unknown` tant qu’un contrat
provider/modèle vérifié n’est pas enregistré.

Les prix absolus sont toujours exposés comme `COST_UNKNOWN`. Les ratios de
profils de rendu existants ne sont pas transformés en prix USD et aucune
absence de prix n’est interprétée comme zéro.

## Modèles inconnus

Un modèle sans famille ou profil reconnu reste `unknown`, n’autorise pas à lui
seul une transformation lossy et choisit le repli sûr `native`. Un modèle connu
mais non mesuré reste distingué de `supported`; les aliases vendor-qualified
sont conservés dans les métadonnées.

## Limites de preuve

`availability: unknown` est volontaire dans le runtime local. Aucun health
probe, credential, appel payant, fallback live, canary ou coût provider réel
n’est simulé. M7 est donc `PARTIAL` : le registre et son raccordement au
Context Fabric sont testés localement, tandis que les adapters provider et la
disponibilité hébergée restent à implémenter/valider.


## Runtime health et cost oracle

`src/core/provider-runtime.ts` fournit maintenant une frontière d'injection explicite pour les preuves détenues par l'hôte :

- observation de santé `available` / `unavailable` avec `observedAt` et `expiresAt` ;
- expiration fail-closed : une observation périmée redevient `unknown` ;
- provenance bornée `live-probe` ou `operator-config` ;
- latence optionnelle metadata-only ;
- registre dérivé qui peut être fourni à `transformRequest({ providerRegistry })` ;
- catalogue de prix exact provider/modèle ;
- estimation USD uniquement quand chaque tarif requis par l'usage est explicitement présent.

Le runtime ne contacte aucun endpoint tout seul et ne lit aucun credential. Une disponibilité fraîche ne peut donc venir que d'une observation fournie par l'application hôte. Le Context Fabric consomme ce registre et force la policy locale en `raw` lorsque le provider est explicitement observé `unavailable`.

Les identifiants de modèles utilisés par le cost oracle sont exacts : aucun alias ou suffixe `latest` n'est transformé en tarif connu. Si des tokens cache sont déclarés sans tarif cache correspondant, le résultat reste `COST_UNKNOWN`.

M7 reste `PARTIAL` : la frontière runtime et le cost oracle sont réels, mais aucun probe hébergé, fallback provider live, credentialed adapter ou validation externe n'est déclaré exécuté.


## Deterministic fallback planner

`ProviderRuntimeState.selectFallback()` plans a provider fallback without performing a network call.

The host supplies an explicit ordered candidate list. FuryPipe keeps that order and selects the first candidate that satisfies every local proof requirement:

- provider is registered;
- health observation is fresh;
- provider availability is explicitly `available`;
- requested model family matches the provider;
- local model capability is `supported` and transform-compatible.

A stale health observation is treated as `unknown`, not as healthy. Unknown providers, family mismatches and unsupported models remain visible as rejected assessments. Duplicate canonical provider/model candidates are rejected.

The decision returns `networkCallExecuted: false`. This closes the local planning gap only; actual failover requests, credential handling, retries and hosted provider validation remain responsibilities of the host/provider adapter.


## OmniRoute gateway adapter

FuryPipe can route its Anthropic, OpenAI and Gemini-compatible proxy surfaces through an explicitly configured OmniRoute gateway.

The adapter is intentionally separate from Provider Runtime health/cost evidence:

- `PXPIPE_PROVIDER=omniroute` enables the gateway mode;
- `OMNIROUTE_BASE_URL` selects the actual instance;
- `OMNIROUTE_API_KEY` is optional and host-owned;
- remote plaintext HTTP is rejected; loopback HTTP is allowed for local development;
- caller provider credentials and credential-like query parameters are removed before the OmniRoute credential is applied;
- generic gateway headers cannot carry Authorization/cookie credentials;
- the adapter never infers provider health, quota, pricing or benchmark state.

One configured OmniRoute origin is used for the existing protocol-specific Anthropic/OpenAI/Gemini request paths; FuryPipe does not invent a new prompt protocol.

See `docs/OMNIROUTE.md`.
