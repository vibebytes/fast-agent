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
exec "$java" --add-opens=java.base/java.nio=ALL-UNNAMED \
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
"%JAVA%" --add-opens=java.base/java.nio=ALL-UNNAMED -Dfast.engines.yaml="%CONF%\engines.yaml" -Dfast.extensions.yaml="%CONF%\extensions.yaml" -Dfast.extensions="%EXTS%" -cp "%ROOT%\lib\*" ai.fastllm.agent.cli.CliApp %*
EOF
cp -f "$bin/fast-cli.bat" "$bin/fast.bat"
echo "patched $bin/fast-cli to use bundled jre"
