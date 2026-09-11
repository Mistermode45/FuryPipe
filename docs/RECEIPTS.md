# Receipts de transformation

FuryPipe peut produire un receipt JSON opt-in pour un appel à
`transformAnthropicMessages`, `transformOpenAIChatCompletions` ou
`transformOpenAIResponses` :

```ts
const result = await transformAnthropicMessages({
  body,
  model,
  requestId,
  options: { emitReceipt: true },
});
```

Le receipt `furypipe-compression-receipt/v1` contient les hashes SHA-256 et les
tailles des corps original et transformé, la stratégie appliquée, les spans
protégés sous forme d'offsets + hashes, les handles de récupération éventuels,
et les effets cache observés par la couche locale. Le plaintext n'est pas
recopié dans le receipt.

La génération est désactivée par défaut. Elle ajoute un scan ExactGuard sur le
corps UTF-8 et doit donc rester une décision explicite de l'appelant. Les
wrappers OpenAI ajoutent en plus le protocole dans `cacheEffects.protocol`.

## Niveau de preuve

Un receipt local vérifié prouve l'intégrité des octets que FuryPipe a reçus et
produits. Il ne prouve pas que le rendu image est sémantiquement lossless, ni
que le fournisseur distant a accepté, caché ou interprété la requête. La
validation provider/client reste nécessaire pour ces propriétés.

Le format utilise SHA-256 pour rester portable. Il ne prétend pas remplacer un
futur format de récupération BLAKE3/zstd ou un registre distant authentifié.
