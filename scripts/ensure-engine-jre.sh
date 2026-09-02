#!/usr/bin/env bash
# Place Temurin 17 JRE into <engine-dir>/jre for one --os id.
# Cache: modules/engine/.jre-cache/17-<os>.{tar.gz,zip}
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="${1:-}"
os="${2:-}"
jre_ver=17

usage() {
	echo "usage: $0 <engine-dir> <darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64>" >&2
	exit 1
}

[[ -n "$dest" && -d "$dest" && -n "$os" ]] || usage
case "$os" in
	darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64) ;;
	*) usage ;;
esac

java_bin="$dest/jre/bin/java"
if [[ "$os" == win32-x64 ]]; then
	java_bin="$dest/jre/bin/java.exe"
fi
have=""
if [[ -f "$dest/.fast-jre" ]]; then
	have="$(tr -d '[:space:]' <"$dest/.fast-jre")"
fi
want="temurin-${jre_ver}-${os}"
if [[ -e "$java_bin" && "$have" == "$want" ]]; then
	echo "jre already at $dest/jre ($want)"
	exit 0
fi

adoptium_os() {
	case "$1" in
		darwin-*) echo mac ;;
		linux-*) echo linux ;;
		win32-*) echo windows ;;
	esac
}

adoptium_arch() {
	case "$1" in
		*-arm64) echo aarch64 ;;
		*) echo x64 ;;
	esac
}

aos="$(adoptium_os "$os")"
aarch="$(adoptium_arch "$os")"
ext=tar.gz
[[ "$os" == win32-x64 ]] && ext=zip
cache_dir="$root/modules/engine/.jre-cache"
mkdir -p "$cache_dir"
cache="$cache_dir/${jre_ver}-${os}.${ext}"
url="https://api.adoptium.net/v3/binary/latest/${jre_ver}/ga/${aos}/${aarch}/jre/hotspot/normal/eclipse?project=jdk"

if [[ ! -s "$cache" ]]; then
	echo "jre ${jre_ver} ${os} <- Adoptium"
	curl -fL --retry 3 --retry-delay 2 -o "$cache.part" "$url"
	mv "$cache.part" "$cache"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
if [[ "$ext" == zip ]]; then
	unzip -q "$cache" -d "$work"
else
	tar -xzf "$cache" -C "$work"
fi

home=""
if [[ -x "$work"/Contents/Home/bin/java || -f "$work"/Contents/Home/bin/java ]]; then
	home="$work/Contents/Home"
else
	local_java="$(find "$work" \( -path '*/Contents/Home/bin/java' -o -path '*/bin/java' -o -path '*/bin/java.exe' \) -print | sort | head -1 || true)"
	[[ -n "$local_java" ]] || {
		echo "jre archive has no bin/java: $cache" >&2
		exit 1
	}
	home="$(cd "$(dirname "$local_java")/.." && pwd)"
	if [[ -d "$home/Contents/Home/bin" ]]; then
		home="$home/Contents/Home"
	fi
fi
[[ -e "$home/bin/java" || -e "$home/bin/java.exe" ]] || {
	echo "cannot normalize JRE home from $cache" >&2
	exit 1
}

rm -rf "$dest/jre"
mkdir -p "$dest/jre"
cp -R "$home/." "$dest/jre/"
chmod +x "$dest/jre/bin/"* 2>/dev/null || true
if [[ "$(uname -s)" == Darwin ]]; then
	xattr -dr com.apple.quarantine "$dest/jre" 2>/dev/null || true
fi
# shellcheck source=engine-bin.sh
source "$root/scripts/engine-bin.sh"
engine_jre_arch_ok "$dest" "$os" || {
	echo "jre arch mismatch at $dest/jre (wanted $os): $(file "$java_bin" 2>/dev/null || true)" >&2
	exit 1
}
printf '%s\n' "$want" >"$dest/.fast-jre"
echo "jre at $dest/jre ($want)"
