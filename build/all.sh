#!/usr/bin/env bash
# Pack cli + desktop from one stage; then mobile (no engine).
# Do not exec build/desktop.sh then build/cli.sh (that would double-build).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

FAST_BUILD_MODE=incremental
FAST_BUILD_OS=""
skip_desktop=0
skip_cli=0
skip_mobile=0

usage() {
	cat <<'EOF'
usage: ./build/all.sh [--incremental] [--clean] [--os <id>] [--skip desktop|cli|mobile] [--] [-h|--help]

  Source pack-common (engine + JS + stage), pack cli and desktop,
  then call build/mobile.sh with the same incremental/clean flag.
  If both desktop and cli are skipped, pack-common is not sourced.
  Engine natives and the Electron binary use the same --os. Not universal.

  --incremental              default. Reuse current/ if .fast-os matches
  --clean                    fetch-engine --clean, restage, mobile --clean
  --os <id>                  darwin-arm64 | darwin-x64 | darwin-both |
                             linux-x64 | linux-arm64 | win32-x64 |
                             darwin | linux | windows
                             darwin-both = both mac packs (each pass --clean)
                             Mismatch with current/.fast-os fails; use --clean
  --skip desktop|cli|mobile  may be repeated
  --                         ignore (pnpm pack -- --incremental)
  -h, --help                 print this help
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
		--skip)
			[[ $# -ge 2 ]] || { usage >&2; exit 1; }
			case "$2" in
				desktop) skip_desktop=1 ;;
				cli) skip_cli=1 ;;
				mobile) skip_mobile=1 ;;
				*) usage >&2; exit 1 ;;
			esac
			shift 2
			;;
		--) shift ;;
		-h|--help) usage; exit 0 ;;
		*) usage >&2; exit 1 ;;
	esac
done

need_pack=0
if [[ "$skip_desktop" -eq 0 || "$skip_cli" -eq 0 ]]; then
	need_pack=1
fi

if [[ "$need_pack" -eq 1 ]]; then
	# shellcheck source=../scripts/pack-common.sh
	source "$root/scripts/pack-common.sh"
	pack_once() {
		prepare_pack
		if [[ "$skip_cli" -eq 0 ]]; then
			pack_cli
			smoke_cli
		fi
		if [[ "$skip_desktop" -eq 0 ]]; then
			pack_desktop
			smoke_desktop
		fi
	}
	for_each_pack_os pack_once
fi

if [[ "$skip_mobile" -eq 0 ]]; then
	mobile_args=()
	if [[ "$FAST_BUILD_MODE" == clean ]]; then
		mobile_args+=(--clean)
	else
		mobile_args+=(--incremental)
	fi
	"$root/build/mobile.sh" "${mobile_args[@]}"
fi
