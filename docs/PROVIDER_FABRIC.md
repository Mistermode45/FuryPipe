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
