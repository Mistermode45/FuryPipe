# Kimi K3 quality results

Model: `moonshotai/kimi-k3` through pxpipe's Anthropic Messages to Cloudflare
Chat Completions bridge. The run used the generic GPT production profile:
Spleen 5x8, 152 columns, max height 1932, and the adjacent text factsheet.

| test | production image | notes |
|---|---:|---|
| novel arithmetic, N=100 | 79/100 | all calls completed |
| gist recall | 84/98 | all sessions completed |
| state tracking | 15/18 | subset of the gist corpus |
| never-stated guards | 1/16 confabulated | lower is better |
| dense 12-char hex | 0/15 | all calls completed after transient retries |

The semantic and exact-recall runs executed on the remote K3-configured proxy;
the existing process was not restarted or modified. Dense hex used a 16,000
token output cap because K3 performs mandatory reasoning.

Receipts:

- `model-moonshotai_kimi-k3-novel-arithmetic-results.json`
- `gist-recall-moonshotai_kimi-k3-results.json`
- `verbatim-hex-moonshotai_kimi-k3-results.json`
