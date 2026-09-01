#!/usr/bin/env bash
# Put a .pkg in a compressed .dmg (user opens the dmg, then the pkg).
set -euo pipefail

pkg="${1:-}"
out="${2:-}"
if [[ -z "$pkg" || ! -f "$pkg" ]]; then
	echo "usage: $0 <pkg> [dmg]" >&2
	exit 1
fi
pkg="$(cd "$(dirname "$pkg")" && pwd)/$(basename "$pkg")"
if [[ -z "$out" ]]; then
	out="${pkg%.pkg}.dmg"
fi
mkdir -p "$(dirname "$out")"
out="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$pkg" "$work/Install Fast.pkg"
cat >"$work/README.txt" <<'EOF'
Open Install Fast.pkg to install.

After install, Fast is in Applications. Terminal commands: fast-ink, fast-cli (alias: fast).
EOF

rm -f "$out"
hdiutil create \
	-volname "Fast" \
	-srcfolder "$work" \
	-ov \
	-format UDZO \
	-imagekey zlib-level=9 \
	"$out"
echo "dmg -> $out"
