#!/usr/bin/env bash
# Dev / repair / independent CLI only.
# macOS desktop: pkg postinstall writes /usr/local/bin.
# Windows NSIS installer writes user PATH; this is CLI / repair / dir-only.
set -euo pipefail

src="${1:-}"
if [[ -z "$src" || ! -d "$src" ]]; then
	echo "usage: $0 <shims-bin-dir> [dest-dir]" >&2
	echo "  e.g. $0 release/cli/bin" >&2
	echo "       $0 \"apps/desktop/release/mac-arm64/Fast.app/Contents/Resources/bin\"" >&2
	echo "  Windows: powershell -ExecutionPolicy Bypass -File scripts/install-path-shims.ps1 -Src <bin>" >&2
	exit 1
fi
src="$(cd "$src" && pwd)"

win=0
case "$(uname -s)" in
	MINGW*|MSYS*|CYGWIN*) win=1 ;;
esac
if [[ "$win" == 1 ]]; then
	ps1="$(cd "$(dirname "$0")" && pwd)/install-path-shims.ps1"
	if command -v cygpath >/dev/null 2>&1; then
		src="$(cygpath -w "$src")"
		ps1="$(cygpath -w "$ps1")"
		[[ -n "${2:-}" ]] && dest_win="$(cygpath -w "$2")"
	else
		dest_win="${2:-}"
	fi
	args=(-NoProfile -ExecutionPolicy Bypass -File "$ps1" -Src "$src")
	[[ -n "${dest_win:-}" ]] && args+=(-Dest "$dest_win")
	exec powershell.exe "${args[@]}"
fi

dest="${2:-/usr/local/bin}"
mkdir -p "$dest"
for name in fast-cli fast fast-ink; do
	if [[ ! -f "$src/$name" ]]; then
		echo "missing $src/$name" >&2
		exit 1
	fi
	ln -sf "$src/$name" "$dest/$name"
	echo "linked $dest/$name -> $src/$name"
done
