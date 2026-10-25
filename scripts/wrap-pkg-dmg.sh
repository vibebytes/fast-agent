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
if ! hdiutil create \
	-volname "Fast" \
	-srcfolder "$work" \
	-ov \
	-format UDZO \
	-imagekey zlib-level=9 \
	"$out"; then
	# -srcfolder mounts a scratch volume under /Volumes; sandboxed/headless runs
	# cannot mount, so build the filesystem in place and compress afterwards.
	echo "hdiutil create failed; falling back to makehybrid" >&2
	rm -f "$out"
	stage="${out%.dmg}.stage.dmg"
	hdiutil makehybrid -hfs -hfs-volume-name "Fast" -o "$stage" "$work" >/dev/null
	hdiutil convert "$stage" -format UDZO -imagekey zlib-level=9 -o "$out" >/dev/null
	rm -f "$stage"
fi
echo "dmg -> $out"
