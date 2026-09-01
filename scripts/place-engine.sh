#!/usr/bin/env bash
# Copy an explicit fast-agent zip into modules/engine/current, then overlay
# Maven extensions dist (conf/ + extension JARs) when present.
# Product path: pnpm fetch-engine (no zip). Internal: from-agent.sh --zip.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=engine-bin.sh
source "$root/scripts/engine-bin.sh"
dest="$root/modules/engine/current"
ext_dist="$root/extensions/dist/target/dist"

usage() {
	cat <<'EOF'
usage: ./scripts/place-engine.sh --overlay-only
       ./scripts/place-engine.sh <fast-agent.zip>
       ./scripts/place-engine.sh -h|--help

  Product developers: pnpm fetch-engine
  --overlay-only   copy extensions/dist conf + JARs onto existing current/
  <zip>            unpack engine/ from that zip into current/
EOF
}

overlay_dist() {
	if [[ ! -d "$ext_dist/conf" && ! -d "$ext_dist/extensions" ]]; then
		return 0
	fi
	mkdir -p "$dest/conf" "$dest/extensions"
	[[ -d "$ext_dist/conf" ]] && cp -R "$ext_dist/conf/." "$dest/conf/"
	[[ -d "$ext_dist/extensions" ]] && cp -R "$ext_dist/extensions/." "$dest/extensions/"
	echo "overlaid $ext_dist (conf/ + extensions/)"
}

host_os() {
	local sys arch
	sys="$(uname -s 2>/dev/null || echo unknown)"
	arch="$(uname -m 2>/dev/null || echo unknown)"
	case "$sys" in
		Darwin)
			if [[ "$arch" == arm64 || "$arch" == aarch64 ]]; then echo darwin-arm64
			else echo darwin-x64
			fi
			;;
		Linux)
			if [[ "$arch" == aarch64 || "$arch" == arm64 ]]; then echo linux-arm64
			else echo linux-x64
			fi
			;;
		MINGW*|MSYS*|CYGWIN*) echo win32-x64 ;;
		*) echo darwin-arm64 ;;
	esac
}

if [[ $# -eq 0 ]]; then
	echo "missing zip. Product path: pnpm fetch-engine" >&2
	usage >&2
	exit 1
fi

case "$1" in
	-h|--help) usage; exit 0 ;;
	--overlay-only) overlay_dist; exit 0 ;;
	-*)
		usage >&2
		exit 1
		;;
esac

zip="$1"
if [[ ! -f "$zip" ]]; then
	echo "not a file: $zip" >&2
	exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
unzip -q "$zip" '*/engine/*' -d "$tmp"

engine_dir="$(find "$tmp" -type d -path '*/engine/bin' -print -quit | sed 's|/bin$||')"
if [[ -z "$engine_dir" ]] || ! engine_cli_path "$engine_dir" >/dev/null; then
	echo "zip has no engine/bin/fast-cli: $zip" >&2
	exit 1
fi

rm -rf "$dest"
mkdir -p "$dest"
cp -R "$engine_dir/." "$dest/"
normalize_engine_bin "$dest"
printf '%s\n' "${FAST_DIST_OS:-$(host_os)}" >"$dest/.fast-os"

echo "placed $zip"
echo "  -> $dest/bin/fast-cli"
overlay_dist
