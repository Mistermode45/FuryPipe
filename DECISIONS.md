# FuryPipe V5 — décisions

## ADR-0002 — identité structurelle des blocs

**Choix :** dériver l’ID d’un scope de requête, de l’ordinal stable, de la
provenance, du rôle, du tour, du range et du hash de contenu.

**Compromis :** un même contenu compilé à un autre emplacement reçoit un autre
ID ; c’est nécessaire pour éviter la collision entre chunks répétitifs.
L’ID reste déterministe et ne dépend pas d’un UUID aléatoire.

## ADR-0003 — conservation Unicode

**Choix :** considérer `chunkChars` comme un nombre maximal de graphemes et
déplacer la frontière vers un point grapheme-safe, avec protection CRLF.

**Compromis :** un grapheme exceptionnellement long peut dépasser la limite
pour préserver l’intégrité Unicode ; la priorité est l’absence de corruption.

## ADR-0004 — ExactGuard conservateur

**Choix :** quand `exactGuard` est configuré et trouve un span protégé, garder
la requête native entière tant qu’aucun adapter externalize/redact reversible
n’est fourni.

**Compromis :** cette stratégie peut réduire le gain de compression ; elle
évite de transformer silencieusement une donnée exacte.

## ADR-0005 — Recovery filesystem first

**Choix :** CAS SHA-256 brut, namespace explicite, quota optionnel, fichiers
temporaires + rename et vérification au read.

**Compromis :** pas de chiffrement, backup distribué ni backend SQLite dans cette
tranche ; ces capacités nécessitent une conception de clés et de durabilité
séparée.
