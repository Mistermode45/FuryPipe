#!/usr/bin/env bash
# bench/run.sh — headless multi-turn claude session through pxpipe, then score it.
#
#   bash bench/run.sh [--turns N] [--model M] [--label NAME] [--port P]
#                     [--no-build] [--prompts FILE]
#
# One events.jsonl + dumps dir per run under bench/runs/<ts>-<label>/.
# Score alone:        node bench/score.mjs bench/runs/<dir>
# A/B two runs:       node bench/score.mjs bench/runs/<A> bench/runs/<B>
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1   # -> repo root

TURNS=4
MODEL="claude-fable-5"
LABEL="bench"
PORT="${PORT:-}"
BUILD=1
PROMPTS_FILE=""
CLAUDE_BIN="${CLAUDE_BIN:-claude}"

while [ $# -gt 0 ]; do
  case "$1" in
    --turns)   TURNS="$2"; shift 2 ;;
    --model)   MODEL="$2"; shift 2 ;;
    --label)   LABEL="$2"; shift 2 ;;
    --port)    PORT="$2"; shift 2 ;;
    --prompts) PROMPTS_FILE="$2"; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

# Default prompts: dependency-free but tool-using, so history/env churn is real.
PROMPTS=(
  "List the files in this project and summarize what it does in two sentences."
  "Add a short comment header to the main source file describing its purpose."
  "Create NOTES.md with a 3-bullet summary of the project and one improvement idea."
  "Delete NOTES.md, then state the final git status in one line."
  "Rename the comment header you added to start with 'Purpose:' and confirm the diff."
  "Revert every change you made this session and confirm the tree is clean."
)
if [ -n "$PROMPTS_FILE" ]; then
  PROMPTS=()
  while IFS= read -r line; do [ -n "$line" ] && PROMPTS+=("$line"); done < "$PROMPTS_FILE"
fi
if [ "$TURNS" -gt "${#PROMPTS[@]}" ]; then
  echo "only ${#PROMPTS[@]} prompts available; capping turns" >&2
  TURNS="${#PROMPTS[@]}"
fi

# Port: pin via --port/PORT (fail if busy), else auto-pick a free one.
if [ -z "$PORT" ]; then
  PORT=47901
  while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT + 1)); done
elif lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT already in use (stale proxy?); pick another or kill it" >&2; exit 1
fi

[ "$BUILD" = 1 ] && { pnpm run build >/dev/null || exit 1; }

RUN_DIR="bench/runs/$(date +%Y%m%d-%H%M%S)-$LABEL"
mkdir -p "$RUN_DIR/dumps" "$RUN_DIR/turns"
RUN_DIR_ABS="$(cd "$RUN_DIR" && pwd)"

# --- proxy ------------------------------------------------------------------
PORT="$PORT" PXPIPE_LOG="$RUN_DIR_ABS/events.jsonl" PXPIPE_DUMP_DIR="$RUN_DIR_ABS/dumps" \
  node bin/cli.js > "$RUN_DIR_ABS/proxy.log" 2>&1 &
PROXY_PID=$!
cleanup() { kill "$PROXY_PID" 2>/dev/null; wait "$PROXY_PID" 2>/dev/null; }
trap cleanup EXIT

# Readiness = OUR process printed its listen line (a stale listener on the same
# port would satisfy a curl probe and silently absorb the whole run).
for _ in $(seq 1 100); do
  grep -q 'listening on' "$RUN_DIR_ABS/proxy.log" 2>/dev/null && break
  kill -0 "$PROXY_PID" 2>/dev/null || { echo "proxy died; see $RUN_DIR/proxy.log" >&2; exit 1; }
  sleep 0.1
done
grep -q 'listening on' "$RUN_DIR_ABS/proxy.log" || { echo "proxy never came up; see $RUN_DIR/proxy.log" >&2; exit 1; }
echo "[bench] proxy pid=$PROXY_PID port=$PORT"

# --- workspace ---------------------------------------------------------------
WS="$RUN_DIR_ABS/ws"
cp -R demo/cost-ab/template "$WS"
git -C "$WS" init -q && git -C "$WS" add -A && \
  git -C "$WS" -c user.email=bench@pxpipe -c user.name=bench commit -qm seed

# --- turns --------------------------------------------------------------------
SID=""
for i in $(seq 1 "$TURNS"); do
  PROMPT="${PROMPTS[$((i - 1))]}"
  # Churn the volatile <env> surface between turns (untracked files + mtimes),
  # exactly the git-status noise that used to flip the cache prefix.
  echo "turn $i $(date +%s)" >> "$WS/scratch.log"
  touch "$WS/tmp-$i.tmp"

  echo "[bench] turn $i/$TURNS: $PROMPT"
  ( cd "$WS" && env ANTHROPIC_BASE_URL="http://127.0.0.1:$PORT" \
      "$CLAUDE_BIN" -p "$PROMPT" --model "$MODEL" --output-format json \
      --setting-sources project --strict-mcp-config --no-chrome \
      --dangerously-skip-permissions ${SID:+--resume "$SID"} \
  ) > "$RUN_DIR_ABS/turns/turn-$i.json" 2> "$RUN_DIR_ABS/turns/turn-$i.err" || {
    echo "[bench] turn $i failed; see $RUN_DIR/turns/turn-$i.err" >&2; break;
  }
  SID="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.session_id??"")' "$RUN_DIR_ABS/turns/turn-$i.json")"
done

# --- score --------------------------------------------------------------------
cleanup; trap - EXIT              # SIGTERM proxy so the tracker flushes
echo "[bench] run dir: $RUN_DIR"
[ -s "$RUN_DIR_ABS/events.jsonl" ] || { echo "[bench] no events captured — traffic did not reach this proxy" >&2; exit 1; }
node bench/score.mjs "$RUN_DIR_ABS"
