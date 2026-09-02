#!/usr/bin/env bash
# Assemble modules/engine/current from Maven Central (versions in extensions/pom.xml).
# No agent/ source tree. Needs JDK + Maven only.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=engine-bin.sh
source "$root/scripts/engine-bin.sh"
pom="$root/extensions/pom.xml"
pom_prop() {
	local v
	v="$(sed -n "s/.*<$1>\\([^<]*\\)<\\/$1>.*/\\1/p" "$pom" | head -n1)"
	[[ -n "$v" ]] || { echo "missing <$1> in $pom" >&2; exit 1; }
	printf '%s' "$v"
}
agent_ver="$(pom_prop agent.version)"
natives_ver="$(pom_prop agent-natives.version)"
os=""
mode=incremental

usage() {
	cat <<EOF
usage: ./scripts/fetch-engine.sh [--incremental] [--clean] [os] [--] [-h|--help]

  Maven Central ai.fastllm ${agent_ver} (natives ${natives_ver}) → modules/engine/current
  No agent/ checkout.

  --incremental   default. If current/bin/fast-cli exists, skip (print a line).
                  Otherwise mvn package (no clean) and write current/
  --clean         mvn clean package, then rewrite current/
  os              darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64 | win32-x64 | all
  --              ignore (pnpm fetch-engine -- --clean)
  -h, --help      print this help

  Incremental does not check OS. Wrong-OS current/ needs --clean.
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--incremental) mode=incremental; shift ;;
		--clean) mode=clean; shift ;;
		darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64|all)
			os="$1"; shift ;;
		--) shift ;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			usage >&2
			exit 1
			;;
	esac
done

if [[ -n "$os" ]]; then
	export FAST_DIST_OS="$os"
fi

cur="$root/modules/engine/current"
if [[ "$mode" == incremental ]] && engine_cli_path "$cur" >/dev/null; then
	normalize_engine_bin "$cur"
	echo "modules/engine/current exists; --clean to refresh"
	chmod +x "$(engine_cli_path "$cur")" 2>/dev/null || true
	exit 0
fi

host_os() {
	local sys arch
	sys="$(uname -s 2>/dev/null || echo Darwin)"
	arch="$(uname -m 2>/dev/null || echo unknown)"
	case "$sys" in
		Darwin) [[ "$arch" == arm64 || "$arch" == aarch64 ]] && echo darwin-arm64 || echo darwin-x64 ;;
		Linux) [[ "$arch" == aarch64 || "$arch" == arm64 ]] && echo linux-arm64 || echo linux-x64 ;;
		MINGW*|MSYS*|CYGWIN*) echo win32-x64 ;;
		*) echo darwin-arm64 ;;
	esac
}

place_maven() {
	local dist="$root/extensions/dist/target/dist"
	local dest="$root/modules/engine/current"
	if ! engine_cli_path "$dist/agent" >/dev/null; then
		echo "maven dist missing $dist/agent/bin/fast-cli" >&2
		exit 1
	fi
	local want="${FAST_DIST_OS:-}"
	if [[ -z "$want" || "$want" == all ]]; then
		want="$(host_os)"
	fi
	"$root/scripts/strip-engine-lib.sh" "$dist/agent/lib" "$want"
	rm -rf "$dest"
	mkdir -p "$dest"
	cp -R "$dist/agent/." "$dest/"
	normalize_engine_bin "$dest"
	chmod +x "$dest/native/ripgrep"/rg-* 2>/dev/null || true
	printf '%s\n' "$want" >"$dest/.fast-os"
	"$root/scripts/place-engine.sh" --overlay-only
	echo "engine at $dest/bin/fast-cli (alias: fast)"
}

echo "Maven ai.fastllm ${agent_ver} (natives ${natives_ver}) from Central → modules/engine/current"
mvn_s=(-s "$root/extensions/.mvn/settings.xml" -U)
mvn_goal=(package)
if [[ "$mode" == clean ]]; then
	mvn_goal=(clean package)
fi
if [[ -n "$os" && "$os" != "all" ]]; then
	mvn "${mvn_s[@]}" -f "$root/extensions/pom.xml" -pl dist -am "${mvn_goal[@]}" -DskipTests -Dengine.os="$os"
else
	mvn "${mvn_s[@]}" -f "$root/extensions/pom.xml" -pl dist -am "${mvn_goal[@]}" -DskipTests
fi
place_maven
