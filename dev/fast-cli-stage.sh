#!/usr/bin/env bash
# Staged agent classpath + current/ wrapper: ini first, FAST_* -D last.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fast="$(cd "$here/.." && pwd)"
placed="$fast/modules/engine/current"
staged="$(cd "$fast/../agent/modules/cli/cli/target/universal/stage" && pwd)"
if [[ ! -d "$staged/lib" ]]; then
	echo "fast-cli-stage: missing $staged/lib (cd agent && sbt cli/Universal/stage)" >&2
	exit 1
fi
conf="$placed/conf"
exts="$placed/extensions"
if [[ ! -d "$conf" && -d "$placed/../conf" ]]; then
	conf="$(cd "$placed/../conf" && pwd)"
	if [[ -d "$placed/../extensions" ]]; then
		exts="$(cd "$placed/../extensions" && pwd)"
	fi
fi
if [[ "${FAST_USE_SYSTEM_JAVA:-}" == 1 ]]; then
	java=java
else
	java="$placed/jre/bin/java"
	if [[ ! -x "$java" && ! -f "$java" ]]; then
		java=java
	else
		export JAVA_HOME="$placed/jre"
		export PATH="$JAVA_HOME/bin:$PATH"
	fi
fi
if [[ -f "$placed/.fast-engine-id" ]]; then
	export FAST_ENGINE_ID="$(tr -d '\n' <"$placed/.fast-engine-id")"
fi
ini_args=()
if [[ -f "$conf/application.ini" ]]; then
	while IFS= read -r line || [[ -n "$line" ]]; do
		line="${line%$'\r'}"
		case "$line" in
			''|\#*) continue ;;
		esac
		line="${line//\$\{\{app_home\}\}/$placed}"
		line="${line//\$\{user.home\}/$HOME}"
		case "$line" in
			-J*) line="${line#-J}" ;;
		esac
		ini_args+=("$line")
	done <"$conf/application.ini"
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
join_port=()
if [[ -n "${FAST_JOIN_PORT:-}" ]]; then
	join_port=(-Dfast.enroll.port="$FAST_JOIN_PORT")
fi
bridge_wss=()
if [[ -n "${FAST_BRIDGE_WSS_PORT:-}" ]]; then
	bridge_wss=(-Dfast.bridge.wss="$FAST_BRIDGE_WSS_PORT")
fi
bridge_ws=()
if [[ -n "${FAST_BRIDGE_WS_PORT:-}" ]]; then
	bridge_ws=(-Dfast.bridge.ws="$FAST_BRIDGE_WS_PORT")
fi
rocks_root=()
if [[ -n "${FAST_ROCKS_ROOT:-}" ]]; then
	rocks_root=(-Dfast.rocks.root="$FAST_ROCKS_ROOT")
fi
exec "$java" --add-opens=java.base/java.nio=ALL-UNNAMED \
	${ini_args[@]+"${ini_args[@]}"} \
	-Dfast.engines.yaml="$conf/engines.yaml" \
	-Dfast.extensions.yaml="$conf/extensions.yaml" \
	-Dfast.extensions="$exts" \
	${runtime_root[@]+"${runtime_root[@]}"} ${agent_port[@]+"${agent_port[@]}"} ${agent_http[@]+"${agent_http[@]}"} \
	${join_port[@]+"${join_port[@]}"} ${bridge_wss[@]+"${bridge_wss[@]}"} ${bridge_ws[@]+"${bridge_ws[@]}"} \
	${rocks_root[@]+"${rocks_root[@]}"} \
	-cp "$staged/lib/*" \
	ai.fastllm.agent.cli.CliApp "$@"
