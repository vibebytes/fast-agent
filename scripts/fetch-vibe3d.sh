#!/usr/bin/env bash
# Build vibe3d daemon/mcp bundles (self-contained ESM) and stage them into
# modules/engine/current/extensions/vibe3d + the Maven dist source tree, so
# pnpm pack* ships vibe3d inside the fast installer. Run after fetch-engine.sh.
#
# Env:
#   FAST_VIBE3D_SRC     vibe3d checkout (default ../vibe3d)
#   FAST_SKIP_VIBE3D=1  skip entirely
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${FAST_SKIP_VIBE3D:-}" == "1" ]]; then
	echo "fetch-vibe3d: skipped (FAST_SKIP_VIBE3D=1)"
	exit 0
fi

vibe="${FAST_VIBE3D_SRC:-$root/../vibe3d}"
vibe="$(cd "$vibe" 2>/dev/null && pwd)" || {
	echo "fetch-vibe3d: vibe3d source not found (set FAST_VIBE3D_SRC)" >&2
	exit 1
}
cur="$root/modules/engine/current"
stage="$root/extensions/dist/src/dist/extensions/vibe3d"
marker="$cur/extensions/vibe3d/.fast-vibe3d-stamp"

[[ -x "$cur/bin/fast-cli" ]] || {
	echo "fetch-vibe3d: engine missing at $cur; run fetch-engine.sh first" >&2
	exit 1
}

stamp="$(git -C "$vibe" status --porcelain 2>/dev/null | shasum | cut -d' ' -f1)_$(git -C "$vibe" rev-parse HEAD 2>/dev/null || echo nogit)"
if [[ -f "$marker" && "$(cat "$marker")" == "$stamp" && -f "$cur/extensions/vibe3d/packages/daemon/dist/index.js" ]]; then
	echo "fetch-vibe3d: up to date ($stamp)"
	exit 0
fi

if ! command -v pnpm >/dev/null 2>&1; then
	shims="$(mktemp -d "${TMPDIR:-/tmp}/fast-vibe-shims.XXXXXX")"
	corepack enable --install-directory "$shims" pnpm
	export PATH="$shims:$PATH"
fi

if [[ ! -d "$vibe/node_modules" ]]; then
	echo "fetch-vibe3d: installing vibe3d deps"
	( cd "$vibe" && pnpm install --frozen-lockfile )
fi

echo "fetch-vibe3d: building daemon/mcp bundles in $vibe"
( cd "$vibe" && pnpm exec turbo run build --filter=...@vibebyte/vibe3d-daemon --filter=...@vibebyte/vibe3d-mcp --force )
( cd "$vibe" && node scripts/check-bundle.mjs packages/daemon/dist packages/mcp/dist )

place() {
	local dest="$1" pkg
	for pkg in daemon mcp; do
		rm -rf "$dest/packages/$pkg/dist"
		mkdir -p "$dest/packages/$pkg"
		cp -R "$vibe/packages/$pkg/dist" "$dest/packages/$pkg/dist"
		printf '{"type":"module"}\n' > "$dest/packages/$pkg/dist/package.json"
		find "$dest/packages/$pkg/dist" \( -name '*.d.ts' -o -name '*.map' \) -delete
	done
}

place "$cur/extensions/vibe3d"
place "$stage"
cp "$stage/extension.yaml" "$cur/extensions/vibe3d/extension.yaml"

printf '%s\n' "$stamp" > "$marker"
echo "fetch-vibe3d: staged $(du -sh "$cur/extensions/vibe3d/packages" 2>/dev/null | cut -d' ' -f1) -> modules/engine/current + extensions/dist source tree"
