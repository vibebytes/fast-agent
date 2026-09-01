#!/usr/bin/env bash
# Agent-source helper (not a product entry). Fast-only: pnpm fetch-engine
#
#   FAST_AGENT_SRC defaults to $root/../agent
#   --zip [os]   sbt dist, then place-engine.sh <that zip>
#   --publish    sbt publishEngineM2
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
agent="${FAST_AGENT_SRC:-$root/../agent}"
use_zip=0
do_publish=0
os=""

usage() {
	cat <<'EOF'
usage: ./scripts/from-agent.sh [--zip] [--publish] [os] [-h|--help]

  Internal. Product developers: pnpm fetch-engine
  Needs an agent checkout (FAST_AGENT_SRC, default ../agent).

  --zip       sbt dist, then ./scripts/place-engine.sh <zip>
  --publish   sbt publishEngineM2
  os          darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64 | win32-x64 | all
  -h, --help  print this help
EOF
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

pick_zip() {
	local dist="$1"
	local want="${FAST_DIST_OS:-$(host_os)}"
	shopt -s nullglob
	local os_zips=("$dist"/fast-agent-*-"${want}".zip)
	local all_zips=("$dist"/fast-agent-*.zip)
	shopt -u nullglob
	if [[ ${#os_zips[@]} -gt 0 ]]; then
		ls -t "${os_zips[@]}" | head -n1
		return
	fi
	if [[ ${#all_zips[@]} -eq 0 ]]; then
		return
	fi
	local f base
	while IFS= read -r f; do
		base="$(basename "$f" .zip)"
		if [[ "$base" =~ ^fast-agent-.+-(darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64)$ ]]; then
			continue
		fi
		echo "$f"
		return
	done < <(ls -t "${all_zips[@]}")
	ls -t "${all_zips[@]}" | head -n1
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--zip) use_zip=1; shift ;;
		--publish) do_publish=1; shift ;;
		darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64|all)
			os="$1"; shift ;;
		-h|--help) usage; exit 0 ;;
		*) usage >&2; exit 1 ;;
	esac
done

if [[ "$use_zip" -eq 0 && "$do_publish" -eq 0 ]]; then
	echo "from-agent is internal. Product path: pnpm fetch-engine" >&2
	usage >&2
	exit 1
fi

if [[ ! -f "$agent/build.sbt" ]]; then
	echo "needs agent checkout at $agent (set FAST_AGENT_SRC)" >&2
	echo "  without agent/: pnpm fetch-engine" >&2
	exit 1
fi

if [[ -n "$os" ]]; then
	export FAST_DIST_OS="$os"
fi

if [[ "$do_publish" -eq 1 ]]; then
	echo "sbt publishEngineM2 -> $agent"
	(cd "$agent" && sbt -J-Xmx8G publishEngineM2)
fi

if [[ "$use_zip" -eq 0 ]]; then
	exit 0
fi

if [[ -z "${PNPM:-}" || ! -x "${PNPM:-}" ]]; then
	if command -v pnpm >/dev/null 2>&1; then
		PNPM="$(command -v pnpm)"
	else
		PNPM=""
		local_d=""
		while IFS= read -r local_d; do
			if [[ -x "$local_d/pnpm" && -x "$local_d/node" ]]; then
				PNPM="$local_d/pnpm"
			fi
		done < <(ls -1d "$HOME/.nvm/versions/node"/v*/bin 2>/dev/null | sort -V || true)
	fi
fi
if [[ -z "${PNPM:-}" || ! -x "$PNPM" ]]; then
	echo "pnpm not found (needed for admin UI). install pnpm or set PNPM=/path/to/pnpm" >&2
	exit 1
fi
export PNPM
export PATH="$(dirname "$PNPM"):$PATH"

echo "sbt dist${os:+ os=$os} -> $agent (pnpm=$PNPM)"
(
	cd "$agent"
	if [[ -n "$os" ]]; then
		sbt -Dfast.dist.os="$os" -J-Xmx8G dist
	else
		sbt -J-Xmx8G dist
	fi
)

zip="$(pick_zip "$agent/target/dist")"
if [[ -z "$zip" || ! -f "$zip" ]]; then
	echo "sbt dist produced no fast-agent-*.zip under $agent/target/dist" >&2
	exit 1
fi
echo "place $zip"
exec "$root/scripts/place-engine.sh" "$zip"
