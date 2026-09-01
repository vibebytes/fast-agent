#!/usr/bin/env bash
# Pack relocatable CLI (engine + tui) into release/cli.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../scripts/pack-common.sh
source "$root/scripts/pack-common.sh"

FAST_BUILD_MODE=incremental

usage() {
	cat <<'EOF'
usage: ./build/cli.sh [--incremental] [--clean] [--] [-h|--help]

  Stage engine+tui once, copy to release/cli.

  --incremental   default. Reuse current/bin/fast-cli; mvn package only if missing
  --clean         fetch-engine --clean and restage
  --              ignore (pnpm pack:cli -- --incremental)
  -h, --help      print this help
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--incremental) FAST_BUILD_MODE=incremental; shift ;;
		--clean) FAST_BUILD_MODE=clean; shift ;;
		--) shift ;;
		-h|--help) usage; exit 0 ;;
		*) usage >&2; exit 1 ;;
	esac
done

prepare_pack
pack_cli
smoke_cli
