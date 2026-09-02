#!/usr/bin/env bash
# Pack desktop (engine + tui staged once via pack-common).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../scripts/pack-common.sh
source "$root/scripts/pack-common.sh"

FAST_BUILD_MODE=incremental
FAST_BUILD_OS=""

usage() {
	cat <<'EOF'
usage: ./build/desktop.sh [--incremental] [--clean] [--os <id>] [--] [-h|--help]

  Stage engine+tui once, then electron-builder for this host (or --os).
  Incremental skips a present current/; desktop .app/.dmg is always rebuilt.
  Engine natives and the Electron binary use the same --os. Not universal.
  Cross-arch: smoke checks file(1) and .fast-os; do not launch the .app.

  --incremental   default. Reuse current/ if .fast-os matches
  --clean         fetch-engine --clean and restage
  --os <id>       darwin | linux | windows | darwin-arm64 | darwin-x64 |
                  darwin-both | linux-x64 | linux-arm64 | win32-x64
                  darwin-arm64 = Apple Silicon; darwin-x64 = Intel
                  darwin-both  = both mac packs (each pass --clean)
                  Mismatch with current/.fast-os fails; use --clean
  --              ignore (pnpm pack:desktop -- --incremental)
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

pack_desktop_once() {
	prepare_pack
	pack_desktop
	smoke_desktop
}

for_each_pack_os pack_desktop_once
