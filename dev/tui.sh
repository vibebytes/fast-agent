#!/usr/bin/env bash
# Launch fast-ink (TUI) against modules/engine/current (unix Bridge).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
placed="$root/modules/engine/current/bin/fast-cli"
fetch=0
pass=()

usage() {
	cat <<'EOF'
usage: ./dev/tui.sh [--engine] [-h|--help] [--] [tui args...]

  Launch TUI against modules/engine/current (unix Bridge).
  No agent/ checkout — engine is Maven Central ai.fastllm 0.3.0.

  --engine    fetch current/ if missing (incremental), then start
  -h, --help  print this help
  --          pass the rest to apps/tui

  Other args are forwarded to the TUI.
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--engine) fetch=1; shift ;;
		-h|--help) usage; exit 0 ;;
		--) shift; pass+=("$@"); break ;;
		*) pass+=("$1"); shift ;;
	esac
done

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
echo "fast-ink -> $placed"

cd "$root/apps/tui"
exec pnpm --dir "$root" --filter fast-ink dev "${pass[@]+"${pass[@]}"}"
