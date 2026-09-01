#!/usr/bin/env bash
# Write PATH shims into $1/bin for a pack root that already has engine/ and tui/.
set -euo pipefail

root="${1:-}"
if [[ -z "$root" || ! -d "$root" ]]; then
	echo "usage: $0 <pack-root>" >&2
	exit 1
fi
root="$(cd "$root" && pwd)"
bin="$root/bin"
mkdir -p "$bin"
chmod +x "$root/engine/bin/fast-cli" 2>/dev/null || true

cat >"$bin/fast-cli" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
	SOURCE_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
	SOURCE="$(readlink "$SOURCE")"
	case "$SOURCE" in
		/*) ;;
		*) SOURCE="$SOURCE_DIR/$SOURCE" ;;
	esac
done
DIR="$(cd -P "$(dirname "$SOURCE")/.." && pwd)"
cli="$DIR/engine/bin/fast-cli"
if [[ ! -f "$cli" ]]; then
	echo "fast: missing $cli" >&2
	exit 1
fi
chmod +x "$cli" 2>/dev/null || true
exec "$cli" "$@"
EOF

cat >"$bin/fast-ink" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
	SOURCE_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
	SOURCE="$(readlink "$SOURCE")"
	case "$SOURCE" in
		/*) ;;
		*) SOURCE="$SOURCE_DIR/$SOURCE" ;;
	esac
done
DIR="$(cd -P "$(dirname "$SOURCE")/.." && pwd)"
main="$DIR/tui/dist/main.js"
cli="$DIR/engine/bin/fast-cli"
if [[ ! -f "$main" ]]; then
	echo "fast: missing $main" >&2
	exit 1
fi
export FAST_BUNDLED_ENGINE="${FAST_BUNDLED_ENGINE:-$cli}"
chmod +x "$cli" 2>/dev/null || true

macos="$(cd "$DIR/../MacOS" 2>/dev/null && pwd || true)"
if [[ -n "$macos" ]]; then
	for exe in "$macos"/*; do
		base="$(basename "$exe")"
		if [[ -x "$exe" && "$base" != *Helper* && "$base" != *helper* ]]; then
			export ELECTRON_RUN_AS_NODE=1
			exec "$exe" "$main" "$@"
		fi
	done
fi

if command -v node >/dev/null 2>&1; then
	exec node "$main" "$@"
fi
echo "fast-ink: need Node.js, or run from the Fast.app bundle" >&2
exit 1
EOF

cat >"$bin/node" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
macos="$(cd "$DIR/../MacOS" 2>/dev/null && pwd || true)"
if [[ -n "$macos" ]]; then
	for exe in "$macos"/*; do
		base="$(basename "$exe")"
		if [[ -x "$exe" && "$base" != *Helper* && "$base" != *helper* ]]; then
			export ELECTRON_RUN_AS_NODE=1
			exec "$exe" "$@"
		fi
	done
fi
exec node "$@"
EOF

if [[ -f "$root/npm/bin/npm-cli.js" ]]; then
	cat >"$bin/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli="$DIR/npm/bin/npm-cli.js"
if [[ ! -f "$cli" ]]; then
	echo "npm: missing $cli" >&2
	exit 1
fi
macos="$(cd "$DIR/../MacOS" 2>/dev/null && pwd || true)"
if [[ -n "$macos" ]]; then
	for exe in "$macos"/*; do
		base="$(basename "$exe")"
		if [[ -x "$exe" && "$base" != *Helper* && "$base" != *helper* ]]; then
			export ELECTRON_RUN_AS_NODE=1
			exec "$exe" "$cli" "$@"
		fi
	done
fi
exec node "$cli" "$@"
EOF
else
	echo "npm shim skipped ($root/npm missing; run apps/desktop/scripts/pack/vendor-npm.mjs)" >&2
fi

chmod +x "$bin/fast-cli" "$bin/fast-ink" "$bin/node"
ln -sfn fast-cli "$bin/fast" 2>/dev/null || cp -f "$bin/fast-cli" "$bin/fast"
[[ -f "$bin/npm" ]] && chmod +x "$bin/npm" || true

# cmd.exe / PowerShell: same names with .bat (unix scripts are not on Windows PATH).
chmod +x "$root/engine/bin/fast-cli.bat" 2>/dev/null || true
cat >"$bin/fast-cli.bat" <<'EOF'
@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "CLI=%ROOT%\engine\bin\fast-cli.bat"
if not exist "%CLI%" set "CLI=%ROOT%\engine\bin\fast-cli"
if not exist "%CLI%" (
	echo fast: missing %ROOT%\engine\bin\fast-cli.bat 1>&2
	exit /b 1
)
"%CLI%" %*
EOF
cat >"$bin/fast.bat" <<'EOF'
@echo off
"%~dp0fast-cli.bat" %*
EOF
cat >"$bin/fast-ink.bat" <<'EOF'
@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "MAIN=%ROOT%\tui\dist\main.js"
set "CLI=%ROOT%\engine\bin\fast-cli.bat"
if not exist "%CLI%" set "CLI=%ROOT%\engine\bin\fast-cli"
if not exist "%MAIN%" (
	echo fast: missing %MAIN% 1>&2
	exit /b 1
)
if exist "%CLI%" if not defined FAST_BUNDLED_ENGINE set "FAST_BUNDLED_ENGINE=%CLI%"
for %%I in ("%ROOT%\..") do set "APPDIR=%%~fI"
if exist "%APPDIR%\Fast.exe" (
	set "ELECTRON_RUN_AS_NODE=1"
	"%APPDIR%\Fast.exe" "%MAIN%" %*
	exit /b %ERRORLEVEL%
)
where node >nul 2>&1 && (
	node "%MAIN%" %*
	exit /b %ERRORLEVEL%
)
echo fast-ink: need Node.js, or run from the Fast install folder 1>&2
exit /b 1
EOF
cat >"$bin/node.bat" <<'EOF'
@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
for %%I in ("%ROOT%\..") do set "APPDIR=%%~fI"
if exist "%APPDIR%\Fast.exe" (
	set "ELECTRON_RUN_AS_NODE=1"
	"%APPDIR%\Fast.exe" %*
	exit /b %ERRORLEVEL%
)
node %*
EOF
if [[ -f "$root/npm/bin/npm-cli.js" ]]; then
	cat >"$bin/npm.bat" <<'EOF'
@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "CLI=%ROOT%\npm\bin\npm-cli.js"
if not exist "%CLI%" (
	echo npm: missing %CLI% 1>&2
	exit /b 1
)
for %%I in ("%ROOT%\..") do set "APPDIR=%%~fI"
if exist "%APPDIR%\Fast.exe" (
	set "ELECTRON_RUN_AS_NODE=1"
	"%APPDIR%\Fast.exe" "%CLI%" %*
	exit /b %ERRORLEVEL%
)
node "%CLI%" %*
EOF
fi

echo "shims -> $bin"
