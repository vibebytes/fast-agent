#!/usr/bin/env bash
# Pack relocatable CLI (engine + tui) into release/cli.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../scripts/pack-common.sh
source "$root/scripts/pack-common.sh"

FAST_BUILD_MODE=incremental
FAST_BUILD_OS=""

usage() {
	cat <<'EOF'
usage: ./build/cli.sh [--incremental] [--clean] [--os <id>] [--] [-h|--help]

  Stage engine+tui once, copy to release/cli-<os> (release/cli → last pack).

  --incremental   default. Reuse current/ if .fast-os matches
  --clean         fetch-engine --clean and restage
  --os <id>       darwin-arm64 | darwin-x64 | darwin-both | linux-x64 |
                  linux-arm64 | win32-x64 | darwin | linux | windows
                  Mismatch with current/.fast-os fails; use --clean
  --              ignore (pnpm pack:cli -- --incremental)
  -h, --help      print this help
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--incremental) FAST_BUILD_MODE=incremental; shift ;;
		--clean) FAST_BUILD_MODE=clean; shift ;;
		--os)
			[[ $# -ge 2 ]] || { usage >&2; exit 1; }
			FAST_BUILD_OS="$2"
			shift 2
			;;
		--) shift ;;
		-h|--help) usage; exit 0 ;;
		*) usage >&2; exit 1 ;;
	esac
done

pack_cli_once() {
	prepare_pack
	pack_cli
	smoke_cli
}

for_each_pack_os pack_cli_once
