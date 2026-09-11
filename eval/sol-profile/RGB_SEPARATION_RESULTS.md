# Sol RGB channel-separation diagnostic

Model: `gpt-5.6-sol`, direct Responses upstream, eval-only JetBrains Mono 12
RGB renderer. The same combined PNG was used for every arm.

## Result

| arm | exact lines |
|---|---:|
| extracted red channel, red | 12/12 |
| extracted green channel, green | 11/12 |
| extracted blue channel, blue | 11/12 |
| extracted red channel, white | 11/12 |
| extracted green channel, white | 11/12 |
| extracted blue channel, white | 10/12 |
| combined RGB, return all streams | red 0/12; green 1/12; blue 0/12 |
| combined RGB, focus only red | 0/12 |
| combined RGB, focus only green | 1/12 |
| combined RGB, focus only blue | 0/12 |

## Conclusion

The PNG encoder and each color channel are healthy. No channel is materially
worse: extracted color channels score 12/12 red and 11/12 green/blue.
Converting extracted channels to white does not improve them.

The failure happens when the three glyph masks are overlaid. Sol does not
reliably separate the combined RGB planes, even when explicitly asked to ignore
two colors and read only one. This is not a red/green/blue ordering or brightness
problem in the current renderer; overlapping glyph collisions are merged by the
model's visual processing before language-level instructions can recover them.

Renderer: `rgb-multiplex-renderer.mjs`. Receipt:
`rgb-separation-diagnostic-results.json`. Re-run the full seven-arm
diagnostic without `RGB_FOCUS_ONLY`; use `RGB_FOCUS_ONLY=1` for the three focused
combined-image probes.
