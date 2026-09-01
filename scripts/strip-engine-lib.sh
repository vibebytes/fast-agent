#!/usr/bin/env bash
# Drop foreign-OS Netty JNI and leftover fat lance/arrow/rocks after Maven copy.
# DistNative.slimJni already thins the three JNI jars into agent-natives; this is the leftover pass.
set -euo pipefail

lib="${1:-}"
os="${2:-}"
if [[ -z "$lib" || -z "$os" || ! -d "$lib" ]]; then
	echo "usage: $0 <engine-lib-dir> <darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64>" >&2
	exit 1
fi

drop_netty() {
	local n lc
	n="$(basename "$1")"
	lc="$(printf '%s' "$n" | tr '[:upper:]' '[:lower:]')"
	[[ "$lc" == *netty* && "$lc" == *native* ]] || return 1
	case "$os" in
		darwin-arm64) [[ "$lc" == *osx-aarch_64* ]] && return 1 ;;
		darwin-x64) [[ "$lc" == *osx-x86_64* ]] && return 1 ;;
		linux-x64) [[ "$lc" == *linux-x86_64* ]] && return 1 ;;
		linux-arm64) [[ "$lc" == *linux-aarch_64* ]] && return 1 ;;
		win32-x64) [[ "$lc" == *windows-x86_64* ]] && return 1 ;;
	esac
	[[ "$lc" == *linux-aarch_64* || "$lc" == *linux-x86_64* || \
	   "$lc" == *osx-aarch_64* || "$lc" == *osx-x86_64* || \
	   "$lc" == *windows-x86_64* ]]
}

keep_lance() {
	case "$os" in
		darwin-arm64) [[ "$1" == nativelib/darwin-aarch64/* ]] ;;
		darwin-x64) [[ "$1" == nativelib/darwin-x86-64/* ]] ;;
		linux-x64) [[ "$1" == nativelib/linux-x86-64/* ]] ;;
		linux-arm64) [[ "$1" == nativelib/linux-aarch64/* ]] ;;
		*) return 1 ;;
	esac
}

keep_arrow() {
	case "$os" in
		darwin-arm64) [[ "$1" == arrow_dataset_jni/aarch_64/* && "$1" == *.dylib ]] ;;
		darwin-x64) [[ "$1" == arrow_dataset_jni/x86_64/* && "$1" == *.dylib ]] ;;
		linux-x64) [[ "$1" == arrow_dataset_jni/x86_64/* && "$1" == *.so ]] ;;
		linux-arm64) [[ "$1" == arrow_dataset_jni/aarch_64/* && "$1" == *.so ]] ;;
		win32-x64) [[ "$1" == arrow_dataset_jni/x86_64/* && "$1" == *.dll ]] ;;
		*) return 1 ;;
	esac
}

keep_rocks() {
	local base="${1##*/}"
	case "$base" in
		*.so|*.jnilib|*.dll|*.dylib) ;;
		*) return 0 ;;
	esac
	case "$os" in
		darwin-arm64|darwin-x64)
			[[ "$base" == librocksdbjni-osx.jnilib || "$base" == *osx-arm64* || \
			   "$base" == *osx-x64* || ( "$base" == *osx* && "$base" != *linux* ) ]]
			;;
		linux-x64) [[ "$base" == librocksdbjni-linux64.so ]] ;;
		linux-arm64) [[ "$base" == librocksdbjni-linux-aarch64.so ]] ;;
		win32-x64) [[ "$base" == librocksdbjni-win64.dll ]] ;;
		*) return 1 ;;
	esac
}

strip_zip() {
	local jar="$1" kind="$2"
	local -a drop=()
	local e
	while IFS= read -r e; do
		[[ "$e" == */ ]] && continue
		case "$kind" in
			lance)
				[[ "$e" != nativelib/* ]] && continue
				keep_lance "$e" && continue
				;;
			arrow)
				[[ "$e" != arrow_dataset_jni/* ]] && continue
				keep_arrow "$e" && continue
				;;
			rocks) keep_rocks "$e" && continue ;;
		esac
		drop+=("$e")
	done < <(zipinfo -1 "$jar")
	(( ${#drop[@]} == 0 )) && return 0
	local i
	for ((i = 0; i < ${#drop[@]}; i += 40)); do
		zip -d "$jar" "${drop[@]:i:40}" >/dev/null || {
			local c=$?
			[[ "$c" -eq 12 ]] || { echo "zip -d failed: $jar ($c)" >&2; exit 1; }
		}
	done
	echo "stripped $kind $(basename "$jar") dropped ${#drop[@]}"
}

lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

for jar in "$lib"/*.jar; do
	[[ -f "$jar" ]] || continue
	n="$(basename "$jar")"
	nlc="$(lc "$n")"
	if drop_netty "$jar"; then
		echo "drop $n"
		rm -f "$jar"
		continue
	fi
	if [[ "$nlc" == *assertj-core* || "$nlc" == *json-unit* || "$nlc" == *opentest4j* || \
	      "$nlc" == *scala3-compiler* || "$nlc" == *scala-compiler* || "$nlc" == *scalap-* || \
	      "$nlc" == *scalameta* || "$nlc" == *scalafmt* ]]; then
		echo "drop $n"
		rm -f "$jar"
		continue
	fi
	if [[ "$n" == org.lance.lance-core*.jar || "$n" == lance-core*.jar ]]; then
		strip_zip "$jar" lance
	elif [[ "$n" == org.apache.arrow.arrow-dataset*.jar || "$n" == arrow-dataset*.jar ]]; then
		strip_zip "$jar" arrow
	elif [[ "$n" == org.rocksdb.rocksdbjni*.jar || "$n" == rocksdbjni*.jar ]]; then
		strip_zip "$jar" rocks
	fi
done
