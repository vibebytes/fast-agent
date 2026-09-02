# Shared: product CLI is fast-cli, alias fast.
# Maven 0.3.0 still ships agent-cli — rename after place.
# shellcheck shell=bash

engine_cli_path() {
	local bin="$1/bin"
	local n
	for n in fast-cli fast-cli.bat fast fast.bat agent-cli agent-cli.bat; do
		if [[ -f "$bin/$n" ]]; then
			echo "$bin/$n"
			return 0
		fi
	done
	return 1
}

normalize_engine_bin() {
	local bin="$1/bin"
	[[ -d "$bin" ]] || return 1
	if [[ -f "$bin/agent-cli" && ! -f "$bin/fast-cli" ]]; then
		mv "$bin/agent-cli" "$bin/fast-cli"
	fi
	if [[ -f "$bin/agent-cli.bat" && ! -f "$bin/fast-cli.bat" ]]; then
		mv "$bin/agent-cli.bat" "$bin/fast-cli.bat"
	fi
	chmod +x "$bin/fast-cli" 2>/dev/null || true
	if [[ -f "$bin/fast-cli" ]]; then
		ln -sfn fast-cli "$bin/fast"
	fi
	if [[ -f "$bin/fast-cli.bat" ]]; then
		cp -f "$bin/fast-cli.bat" "$bin/fast.bat"
	fi
}

engine_jre_java() {
	local dest="$1"
	if [[ -e "$dest/jre/bin/java.exe" ]]; then
		echo "$dest/jre/bin/java.exe"
		return 0
	fi
	if [[ -e "$dest/jre/bin/java" ]]; then
		echo "$dest/jre/bin/java"
		return 0
	fi
	return 1
}

engine_jre_arch_ok() {
	local dest="$1" os="${2:-}" java="" info=""
	java="$(engine_jre_java "$dest")" || return 1
	command -v file >/dev/null || return 0
	info="$(file "$java" 2>/dev/null || true)"
	case "$os" in
		darwin-arm64) [[ "$info" == *arm64* ]] ;;
		darwin-x64) [[ "$info" == *x86_64* ]] ;;
		linux-x64) [[ "$info" == *x86-64* || "$info" == *x86_64* ]] ;;
		linux-arm64) [[ "$info" == *aarch64* ]] ;;
		win32-x64) [[ "$info" == *PE32+* || "$info" == *x86-64* ]] ;;
		*) return 1 ;;
	esac
}

# dest + expected os (darwin-arm64 | …)
engine_jre_ok() {
	local dest="$1" os="${2:-}" mark=""
	engine_jre_java "$dest" >/dev/null || return 1
	if [[ -f "$dest/.fast-jre" ]]; then
		mark="$(tr -d '[:space:]' <"$dest/.fast-jre")"
	fi
	[[ -n "$os" && "$mark" == "temurin-17-${os}" ]] || return 1
	engine_jre_arch_ok "$dest" "$os"
}
