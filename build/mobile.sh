#!/usr/bin/env bash
# Build a standalone APK for apps/mobile (JS bundled, no Metro).
# Does not read modules/engine/current.
#
# Incremental: reuse android/ + Gradle daemon. Do not --prebuild / --clean
# unless the native project is missing or you changed native config.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mobile="$root/apps/mobile"
force_prebuild=0
do_clean=0
variant=release
arch="arm64-v8a"

usage() {
	cat <<'EOF'
usage: ./build/mobile.sh [--incremental] [--clean] [--prebuild] [--debug] [--arch <abi>] [--os android] [--] [-h|--help]

  Android APK only. Does not fetch or read the engine tree.
  Missing Android SDK / JDK: skip (exit 0) and print why.

  --incremental   default. No expo --clean, no gradlew clean
  --clean         gradle clean then assemble (same as yesterday's --clean)
  --prebuild      regenerate android/ (expo prebuild --clean)
  --debug         debug APK (needs Metro)
  --arch <abi>    armeabi-v7a | arm64-v8a | x86 | x86_64 | all
  --os android    only android is supported
  --              ignore (pnpm pack:mobile -- --incremental)
  -h, --help      print this help

  Output: release/fast-mobile-<version>.apk
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--incremental) do_clean=0; shift ;;
		--clean) do_clean=1; shift ;;
		--prebuild) force_prebuild=1; shift ;;
		--debug) variant=debug; shift ;;
		--arch)
			[[ $# -ge 2 ]] || { usage >&2; exit 1; }
			arch="$2"
			shift 2
			;;
		--os)
			[[ $# -ge 2 ]] || { usage >&2; exit 1; }
			if [[ "$2" != android ]]; then
				echo "mobile pack supports --os android only (got $2)" >&2
				usage >&2
				exit 1
			fi
			shift 2
			;;
		--) shift ;;
		-h|--help) usage; exit 0 ;;
		*) usage >&2; exit 1 ;;
	esac
done

if [[ "$arch" == all ]]; then
	arch="armeabi-v7a,arm64-v8a,x86,x86_64"
fi

if [[ -z "${PNPM:-}" || ! -x "${PNPM:-}" ]]; then
	if command -v pnpm >/dev/null 2>&1; then
		PNPM="$(command -v pnpm)"
	else
		PNPM=""
		while IFS= read -r d; do
			if [[ -x "$d/pnpm" && -x "$d/node" ]]; then
				PNPM="$d/pnpm"
			fi
		done < <(ls -1d "$HOME/.nvm/versions/node"/v*/bin 2>/dev/null | sort -V || true)
		if [[ -z "$PNPM" && -x "$root/scripts/shims/pnpm" ]]; then
			PNPM="$root/scripts/shims/pnpm"
		fi
	fi
fi
if [[ -z "${PNPM:-}" || ! -x "$PNPM" ]]; then
	echo "pnpm not found. install pnpm or set PNPM=/path/to/pnpm" >&2
	exit 1
fi
export PNPM
export PATH="$(dirname "$PNPM"):$PATH"

if [[ ! -d "$mobile/node_modules/expo" ]]; then
	echo "expo missing under apps/mobile. from $root run: pnpm install" >&2
	exit 1
fi

ensure_java() {
	if [[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" ]]; then
		return 0
	fi
	local sdkman="$HOME/.sdkman/candidates/java" d
	if [[ -d "$sdkman" ]]; then
		d="$(ls -1d "$sdkman"/17* 2>/dev/null | tail -1 || true)"
		if [[ -n "$d" && -x "$d/bin/java" ]]; then
			export JAVA_HOME="$d"
			return 0
		fi
	fi
	if command -v /usr/libexec/java_home >/dev/null 2>&1; then
		d="$(/usr/libexec/java_home -v 17 2>/dev/null || /usr/libexec/java_home 2>/dev/null || true)"
		if [[ -n "$d" && -x "$d/bin/java" ]]; then
			export JAVA_HOME="$d"
			return 0
		fi
	fi
	local jvm
	for jvm in /usr/lib/jvm/java-17-openjdk* /usr/lib/jvm/java-17-openjdk-amd64 /usr/lib/jvm/java-21-openjdk*; do
		if [[ -x "$jvm/bin/java" ]]; then
			export JAVA_HOME="$jvm"
			return 0
		fi
	done
	if command -v java >/dev/null 2>&1; then
		d="$(dirname "$(dirname "$(command -v java)")")"
		if [[ -x "$d/bin/java" ]]; then
			export JAVA_HOME="$d"
			return 0
		fi
	fi
	return 1
}

ensure_android_sdk() {
	if [[ -n "${ANDROID_HOME:-}" && -d "$ANDROID_HOME" ]]; then
		export ANDROID_SDK_ROOT="$ANDROID_HOME"
		return 0
	fi
	if [[ -n "${ANDROID_SDK_ROOT:-}" && -d "$ANDROID_SDK_ROOT" ]]; then
		export ANDROID_HOME="$ANDROID_SDK_ROOT"
		return 0
	fi
	local guess
	for guess in "$HOME/Library/Android/sdk" "$HOME/Android/Sdk"; do
		if [[ -d "$guess" ]]; then
			export ANDROID_HOME="$guess"
			export ANDROID_SDK_ROOT="$guess"
			return 0
		fi
	done
	return 1
}

if ! ensure_java; then
	echo "skip: JDK not found (set JAVA_HOME). mobile pack skipped."
	exit 0
fi
if ! ensure_android_sdk; then
	echo "skip: Android SDK not found (set ANDROID_HOME). mobile pack skipped."
	exit 0
fi

set_prop() {
	local file="$1" key="$2" value="$3" tmp
	if grep -q "^${key}=${value}$" "$file"; then
		return 0
	fi
	tmp="$(mktemp)"
	if grep -q "^${key}=" "$file"; then
		awk -v k="$key" -v v="$value" 'index($0, k"=")==1 { print k"="v; next } { print }' "$file" >"$tmp"
		mv "$tmp" "$file"
	else
		rm -f "$tmp"
		printf '%s=%s\n' "$key" "$value" >>"$file"
	fi
}

harden_gradle() {
	local props="$mobile/android/gradle.properties"
	local app_gradle="$mobile/android/app/build.gradle"
	local root_gradle="$mobile/android/build.gradle"
	[[ -f "$props" ]] || {
		echo "missing $props (prebuild failed?)" >&2
		exit 1
	}
	set_prop "$props" org.gradle.jvmargs "-Xmx4096m -XX:MaxMetaspaceSize=1024m"
	set_prop "$props" org.gradle.caching true
	set_prop "$props" org.gradle.daemon true
	set_prop "$props" android.lint.checkReleaseBuilds false
	if [[ -f "$root_gradle" ]] && ! grep -q "NDK_PIN_MARKER" "$root_gradle"; then
		cat >>"$root_gradle" <<'EOF'

// NDK_PIN_MARKER
subprojects {
	plugins.withId("com.android.library") {
		android { ndkVersion "27.1.12297006" }
	}
	plugins.withId("com.android.application") {
		android { ndkVersion "27.1.12297006" }
	}
}
EOF
	fi
	if [[ -f "$app_gradle" ]] && ! grep -q 'checkReleaseBuilds false' "$app_gradle"; then
		python3 - "$app_gradle" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
text = p.read_text()
needle = "    androidResources {\n        ignoreAssetsPattern"
insert = "    lint {\n        checkReleaseBuilds false\n        abortOnError false\n    }\n"
if needle in text:
    p.write_text(text.replace(needle, insert + needle, 1))
PY
	fi
}

ensure_gradle_home() {
	if [[ -z "${GRADLE_USER_HOME:-}" ]]; then
		export GRADLE_USER_HOME="$HOME/.gradle"
	fi
	mkdir -p "$GRADLE_USER_HOME/wrapper/dists"
	local stale
	while IFS= read -r stale; do
		[[ -n "$stale" ]] || continue
		if [[ ! -s "$stale" ]]; then
			rm -f "$stale" "${stale%.part}.lck"
		fi
	done < <(find "$GRADLE_USER_HOME/wrapper/dists" -name '*.part' 2>/dev/null || true)
}

ensure_sense_voice_model() {
	local dir="$mobile/assets/models/sense-voice"
	[[ -f "$dir/model.int8.onnx" ]] && return 0
	local name="sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
	local url="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${name}.tar.bz2"
	local archive="/tmp/${name}.tar.bz2"
	mkdir -p "$dir"
	echo "sense-voice model missing; downloading (~1GB archive, one-time)"
	curl -fL --retry 3 -o "$archive" "$url"
	tar -xjf "$archive" -C /tmp "$name/model.int8.onnx" "$name/tokens.txt"
	mv "/tmp/$name/model.int8.onnx" "$dir/model.int8.onnx"
	[[ -f "$dir/tokens.txt" ]] || mv "/tmp/$name/tokens.txt" "$dir/tokens.txt"
	rm -rf "/tmp/$name" "$archive"
}

ensure_gradle_home
ensure_sense_voice_model
export PATH="$JAVA_HOME/bin:$PATH"
echo "java   $JAVA_HOME"
echo "sdk    $ANDROID_HOME"
echo "gradle $GRADLE_USER_HOME"

if [[ ! -x "$mobile/android/gradlew" || "$force_prebuild" -eq 1 ]]; then
	echo "expo prebuild --platform android${force_prebuild:+ --clean}"
	(
		cd "$mobile"
		if [[ "$force_prebuild" -eq 1 ]]; then
			"$PNPM" exec expo prebuild --platform android --clean --non-interactive
		else
			"$PNPM" exec expo prebuild --platform android --non-interactive
		fi
	)
fi

harden_gradle

assemble="assembleRelease"
if [[ "$variant" == debug ]]; then
	assemble="assembleDebug"
fi
gradle_args=(
	--build-cache
	-PreactNativeArchitectures="$arch"
)
if [[ "$do_clean" -eq 1 ]]; then
	echo "gradle clean (wipes incremental native/JS outputs)"
	(
		cd "$mobile/android"
		./gradlew clean --build-cache
	)
fi
gradle_args+=(":app:$assemble")
echo "abi  $arch  (first build compiles native; later builds are incremental unless --clean/--prebuild)"
echo "gradle ${gradle_args[*]}"
(
	cd "$mobile/android"
	./gradlew "${gradle_args[@]}"
)

apk="$(ls -1t "$mobile/android/app/build/outputs/apk/$variant"/*.apk 2>/dev/null | head -1 || true)"
if [[ -z "$apk" || ! -f "$apk" ]]; then
	echo "gradle finished but no apk under android/app/build/outputs/apk/$variant" >&2
	exit 1
fi

version="$(node -p "require('$mobile/app.json').expo.version" 2>/dev/null || echo 1.0.0)"
dest_name="fast-mobile-${version}.apk"
if [[ "$variant" == debug ]]; then
	dest_name="fast-mobile-${version}-debug.apk"
fi
mkdir -p "$root/release" "$mobile/dist"
cp -f "$apk" "$root/release/$dest_name"
cp -f "$apk" "$mobile/dist/$dest_name"
size="$(du -h "$root/release/$dest_name" | awk '{print $1}')"
echo "APK -> $root/release/$dest_name ($size)"
echo "  $mobile/dist/$dest_name"
if [[ "$variant" == debug ]]; then
	echo "debug APK needs Metro (pnpm --dir apps/mobile exec expo start --dev-client)"
else
	echo "release APK is standalone (adb install -r $root/release/$dest_name)"
fi
