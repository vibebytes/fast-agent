#!/usr/bin/env bash
# Launch desktop against modules/engine/current (unix Bridge).
# Engine is Maven Central — no agent/ source tree.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
desktop="$root/apps/desktop"
placed="$root/modules/engine/current/bin/fast-cli"

fetch=0
mock=0
pass=()

usage() {
	cat <<'EOF'
usage: ./dev/desktop.sh [--mock] [--engine] [-h|--help] [--] [electron-vite args...]

  Launch desktop against modules/engine/current (unix Bridge).
  No agent/ checkout — engine is Maven Central ai.fastllm 0.3.0.

  --mock      UI only (apps/desktop/scripts/dev/mock-engine.mjs)
  --engine    fetch current/ if missing (incremental), then start
  -h, --help  print this help
  --          pass the rest to electron-vite

  Other args are forwarded to electron-vite.
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--engine) fetch=1; shift ;;
		--mock) mock=1; shift ;;
		-h|--help) usage; exit 0 ;;
		--) shift; pass+=("$@"); break ;;
		*) pass+=("$1"); shift ;;
	esac
done

if [[ "$mock" -eq 1 ]]; then
	export FAST_ENGINE_COMMAND=node
	export FAST_ENGINE_ARGS="$desktop/scripts/dev/mock-engine.mjs"
	echo "Fast -> mock-engine"
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
