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
