#!/usr/bin/env bash
# Launch desktop against modules/engine/current (unix Bridge).
# Engine is Maven Central — no agent/ source tree.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
desktop="$root/apps/desktop"
placed="$root/modules/engine/current/bin/fast-cli"

fetch=0
mock=0
stage=0
pass=()

usage() {
	cat <<'EOF'
usage: ./dev/desktop.sh [--mock] [--engine] [--stage] [-h|--help] [--] [electron-vite args...]

  Launch desktop against modules/engine/current (unix Bridge).
  No agent/ checkout — engine is Maven Central ai.fastllm 0.3.0.

  --mock      UI only (apps/desktop/scripts/dev/mock-engine.mjs)
  --engine    fetch current/ if missing (incremental), then start
  --stage     use agent/modules/cli/.../stage/bin/fast-cli (local source)
  -h, --help  print this help
  --          pass the rest to electron-vite

  Other args are forwarded to electron-vite.
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--engine) fetch=1; shift ;;
		--mock) mock=1; shift ;;
		--stage) stage=1; shift ;;
		-h|--help) usage; exit 0 ;;
		--) shift; pass+=("$@"); break ;;
		*) pass+=("$1"); shift ;;
	esac
done

if [[ "$mock" -eq 1 ]]; then
	export FAST_ENGINE_COMMAND=node
	export FAST_ENGINE_ARGS="$desktop/scripts/dev/mock-engine.mjs"
	echo "Fast -> mock-engine"
elif [[ "$stage" -eq 1 ]]; then
	wrapper="$root/dev/fast-cli-stage.sh"
	staged="$(cd "$root/../agent" && pwd)/modules/cli/cli/target/universal/stage/lib"
	if [[ ! -d "$staged" ]]; then
		echo "error: staged lib missing at $staged" >&2
		echo "  (cd agent && sbt cli/Universal/stage)" >&2
		exit 1
	fi
	chmod +x "$wrapper"
	export FAST_ENGINE_COMMAND="$wrapper"
	unset FAST_ENGINE_ARGS
	echo "Fast -> $wrapper"
else
	unset FAST_ENGINE_COMMAND FAST_ENGINE_ARGS
	if [[ "$fetch" -eq 1 || ! -e "$placed" ]]; then
		"$root/scripts/fetch-engine.sh" --incremental
	fi
	if [[ ! -e "$placed" ]]; then
		echo "error: no engine at $placed" >&2
		echo "  pnpm fetch-engine" >&2
		echo "  or: $0 --engine" >&2
		exit 1
	fi
	chmod +x "$placed" 2>/dev/null || true
	echo "Fast -> $placed"
fi

cd "$desktop"
exec pnpm --dir "$root" --filter @fast-ide/desktop dev "${pass[@]+"${pass[@]}"}"
