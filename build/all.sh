#!/usr/bin/env bash
# Pack cli + desktop from one stage; then mobile (no engine).
# Do not exec build/desktop.sh then build/cli.sh (that would double-build).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

FAST_BUILD_MODE=incremental
skip_desktop=0
skip_cli=0
skip_mobile=0

usage() {
	cat <<'EOF'
usage: ./build/all.sh [--incremental] [--clean] [--skip desktop|cli|mobile] [--] [-h|--help]

  Source pack-common once (engine + JS + stage), pack cli and desktop,
  then call build/mobile.sh with the same incremental/clean flag.
  If both desktop and cli are skipped, pack-common is not sourced.

  --incremental              default. Reuse current/; mvn package only if missing
  --clean                    fetch-engine --clean, restage, mobile --clean
  --skip desktop|cli|mobile  may be repeated
  --                         ignore (pnpm pack -- --incremental)
  -h, --help                 print this help
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--incremental) FAST_BUILD_MODE=incremental; shift ;;
		--clean) FAST_BUILD_MODE=clean; shift ;;
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
	prepare_pack
	if [[ "$skip_cli" -eq 0 ]]; then
		pack_cli
		smoke_cli
	fi
	if [[ "$skip_desktop" -eq 0 ]]; then
		pack_desktop
		smoke_desktop
	fi
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
