#!/usr/bin/env bash
# Rewrite engine bin/fast-cli(+.bat) to exec the bundled jre. Maven overwrites these.
# FAST_USE_SYSTEM_JAVA=1 keeps `java` on PATH (dev escape).
set -euo pipefail

dest="${1:-}"
[[ -n "$dest" && -d "$dest/bin" ]] || {
	echo "usage: $0 <engine-dir>" >&2
	exit 1
}
dest="$(cd "$dest" && pwd)"
bin="$dest/bin"

lib="$dest/lib"
jar_cmd="$(command -v jar || true)"

fix_rocksdb_native() {
	local jar
	jar="$(ls "$lib"/rocksdbjni-*.jar 2>/dev/null | head -1)"
	[[ -n "$jar" ]] || return 0
	unzip -l "$jar" 2>/dev/null | grep -q "librocksdbjni-osx" && return 0
	local fast_app
	for fast_app in /Applications/Fast.app/Contents/Resources/engine/lib/rocksdbjni-*.jar; do
		if [[ -f "$fast_app" ]] && unzip -l "$fast_app" 2>/dev/null | grep -q "librocksdbjni-osx"; then
			cp -f "$fast_app" "$jar"
			echo "patched rocksdb native into ${jar##*/} (from Fast.app)"
			return 0
		fi
	done
	echo "WARN: $jar lacks osx rocksdb native and no Fast.app source found" >&2
}

fix_lance_native() {
	[[ -n "$jar_cmd" ]] || return 0
	local jar dylib
	jar="$(ls "$lib"/lance-core-*.jar 2>/dev/null | head -1)"
	dylib="$(cd "$dest/../../../.." 2>/dev/null && pwd)/agent/modules/lib/native/lance-jni-darwin-x86-64/liblance_jni.dylib"
	[[ -n "$jar" && -f "$dylib" ]] || return 0
	unzip -l "$jar" 2>/dev/null | grep -q "nativelib/darwin-x86-64/liblance_jni.dylib" && return 0
	local work
	work="$(mktemp -d)"
	mkdir -p "$work/nativelib/darwin-x86-64"
	cp "$dylib" "$work/nativelib/darwin-x86-64/"
	(cd "$work" && "$jar_cmd" uf "$jar" nativelib/darwin-x86-64/liblance_jni.dylib)
	rm -rf "$work"
	echo "patched darwin-x86-64 lance native into ${jar##*/}"
}

fix_rocksdb_native
fix_lance_native

cat >"$bin/fast-cli" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
conf="$root/conf"
exts="$root/extensions"
if [[ ! -d "$conf" && -d "$root/../conf" ]]; then
	conf="$(cd "$root/../conf" && pwd)"
	if [[ -d "$root/../extensions" ]]; then
		exts="$(cd "$root/../extensions" && pwd)"
	fi
fi
if [[ "${FAST_USE_SYSTEM_JAVA:-}" == 1 ]]; then
	java=java
else
	java="$root/jre/bin/java"
	if [[ ! -x "$java" && ! -f "$java" ]]; then
		echo "fast: bundled JRE missing at $root/jre (FAST_USE_SYSTEM_JAVA=1 to use PATH java)" >&2
		exit 1
	fi
	export JAVA_HOME="$root/jre"
	export PATH="$JAVA_HOME/bin:$PATH"
fi
if [[ -f "$root/.fast-engine-id" ]]; then
	export FAST_ENGINE_ID="$(tr -d '\n' <"$root/.fast-engine-id")"
fi
runtime_root=()
if [[ -n "${FAST_RUNTIME_ROOT:-}" ]]; then
	runtime_root=(-Dfast.runtime.root="$FAST_RUNTIME_ROOT")
fi
agent_port=()
if [[ -n "${FAST_AGENT_PORT:-}" ]]; then
	agent_port=(-DagentPort="$FAST_AGENT_PORT")
fi
agent_http=()
if [[ -n "${FAST_AGENT_HTTP_PORT:-}" ]]; then
	agent_http=(-DagentHttpPort="$FAST_AGENT_HTTP_PORT")
fi
# bash 3.2: expanding an empty array under set -u aborts with "unbound variable"
exec "$java" --add-opens=java.base/java.nio=ALL-UNNAMED \
	${runtime_root[@]+"${runtime_root[@]}"} ${agent_port[@]+"${agent_port[@]}"} ${agent_http[@]+"${agent_http[@]}"} \
	-Dfast.engines.yaml="$conf/engines.yaml" \
	-Dfast.extensions.yaml="$conf/extensions.yaml" \
	-Dfast.extensions="$exts" \
	-cp "$root/lib/*" \
	ai.fastllm.agent.cli.CliApp "$@"
EOF
chmod +x "$bin/fast-cli"
ln -sfn fast-cli "$bin/fast"

cat >"$bin/fast-cli.bat" <<'EOF'
@echo off
setlocal
set "ROOT=%~dp0.."
set "CONF=%ROOT%\conf"
set "EXTS=%ROOT%\extensions"
if not exist "%CONF%" if exist "%ROOT%\..\conf" (
	set "CONF=%ROOT%\..\conf"
	if exist "%ROOT%\..\extensions" set "EXTS=%ROOT%\..\extensions"
)
if "%FAST_USE_SYSTEM_JAVA%"=="1" (
	set "JAVA=java"
) else (
	set "JAVA_HOME=%ROOT%\jre"
	set "PATH=%JAVA_HOME%\bin;%PATH%"
	set "JAVA=%JAVA_HOME%\bin\java.exe"
	if not exist "%JAVA%" (
		echo fast: bundled JRE missing at %ROOT%\jre 1>&2
		exit /b 1
	)
)
if exist "%ROOT%\.fast-engine-id" (
	set /p FAST_ENGINE_ID=<"%ROOT%\.fast-engine-id"
)
set "RUNTIME_ROOT="
if defined FAST_RUNTIME_ROOT set "RUNTIME_ROOT=-Dfast.runtime.root=%FAST_RUNTIME_ROOT%"
set "AGENT_PORT="
if defined FAST_AGENT_PORT set "AGENT_PORT=-DagentPort=%FAST_AGENT_PORT%"
set "AGENT_HTTP="
if defined FAST_AGENT_HTTP_PORT set "AGENT_HTTP=-DagentHttpPort=%FAST_AGENT_HTTP_PORT%"
"%JAVA%" --add-opens=java.base/java.nio=ALL-UNNAMED %RUNTIME_ROOT% %AGENT_PORT% %AGENT_HTTP% -Dfast.engines.yaml="%CONF%\engines.yaml" -Dfast.extensions.yaml="%CONF%\extensions.yaml" -Dfast.extensions="%EXTS%" -cp "%ROOT%\lib\*" ai.fastllm.agent.cli.CliApp %*
EOF
cp -f "$bin/fast-cli.bat" "$bin/fast.bat"
echo "patched $bin/fast-cli to use bundled jre"
