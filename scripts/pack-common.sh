#!/usr/bin/env bash
# Shared by build/{desktop,cli,all}.sh. Source only — do not exec.
# Engine: modules/engine/current from scripts/fetch-engine.sh.

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	echo "source this file from build/*.sh" >&2
	exit 1
fi

FAST_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${root:=$(cd "$FAST_SCRIPTS_DIR/.." && pwd)}"
# shellcheck source=engine-bin.sh
source "$FAST_SCRIPTS_DIR/engine-bin.sh"
cd "$root"

: "${FAST_BUILD_MODE:=incremental}"
: "${FAST_BUILD_OS:=}"

host_os() {
	local sys arch
	sys="$(uname -s 2>/dev/null || echo unknown)"
	arch="$(uname -m 2>/dev/null || echo unknown)"
	case "$sys" in
		Darwin)
			if [[ "$arch" == arm64 || "$arch" == aarch64 ]]; then echo darwin-arm64
			else echo darwin-x64
			fi
			;;
		Linux)
			if [[ "$arch" == aarch64 || "$arch" == arm64 ]]; then echo linux-arm64
			else echo linux-x64
			fi
			;;
		MINGW*|MSYS*|CYGWIN*) echo win32-x64 ;;
		*) echo darwin-arm64 ;;
	esac
}

# stdin: product or engine id → stdout: darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64
canonical_engine_os() {
	local id="${1:-}" a
	a="$(uname -m 2>/dev/null || echo unknown)"
	case "$id" in
		'') host_os ;;
		darwin)
			if [[ "$a" == arm64 || "$a" == aarch64 ]]; then echo darwin-arm64
			else echo darwin-x64
			fi
			;;
		linux)
			if [[ "$a" == aarch64 || "$a" == arm64 ]]; then echo linux-arm64
			else echo linux-x64
			fi
			;;
		windows|win32) echo win32-x64 ;;
		darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64) echo "$id" ;;
		*)
			echo "unknown --os $id (darwin|linux|windows|darwin-arm64|darwin-x64|darwin-both|linux-x64|linux-arm64|win32-x64)" >&2
			return 1
			;;
	esac
}

# One concrete engine/Electron id. Empty FAST_BUILD_OS → host.
resolved_os() {
	canonical_engine_os "${FAST_BUILD_OS:-}"
}

electron_cpu() {
	case "${1:-}" in
		*-arm64) echo arm64 ;;
		*) echo x64 ;;
	esac
}

electron_platform() {
	case "${1:-$(host_os)}" in
		darwin-*) echo darwin ;;
		linux-*) echo linux ;;
		win32-*) echo win ;;
		*) echo darwin ;;
	esac
}

mac_unpacked_app() {
	case "${1:-}" in
		darwin-arm64) echo "$root/apps/desktop/release/mac-arm64/Fast.app" ;;
		darwin-x64) echo "$root/apps/desktop/release/mac/Fast.app" ;;
		*) echo "" ;;
	esac
}

desktop_version() {
	node -p "require('$root/apps/desktop/package.json').version"
}

# Matches electron-builder.yml mac.artifactName: ${productName}-${version}-mac-${arch}.${ext}
mac_installer() {
	local ext="$1" cpu="$2"
	echo "$root/apps/desktop/release/Fast-$(desktop_version)-mac-${cpu}.${ext}"
}

cli_pack_dir() {
	echo "$root/release/cli-$(resolved_os)"
}

# File or directory → du -sh (e.g. 333M). Empty if missing.
human_size() {
	local p="${1:-}"
	[[ -e "$p" ]] || return 1
	du -sh "$p" 2>/dev/null | awk '{print $1}'
}

echo_sized() {
	local label="$1" path="$2"
	local sz
	if sz="$(human_size "$path")"; then
		echo "$label $path ($sz)"
	else
		echo "$label $path"
	fi
}

linux_unpacked_dir() {
	case "${1:-}" in
		linux-arm64) echo "$root/apps/desktop/release/linux-arm64-unpacked" ;;
		linux-x64) echo "$root/apps/desktop/release/linux-unpacked" ;;
		*) echo "" ;;
	esac
}

# Run $1 once per pack target. darwin-both → arm64 then x64, each pass --clean.
for_each_pack_os() {
	local fn="$1"
	local saved_os="${FAST_BUILD_OS:-}"
	local saved_mode="${FAST_BUILD_MODE:-incremental}"
	local targets=()
	local t
	if [[ "$saved_os" == darwin-both ]]; then
		targets=(darwin-arm64 darwin-x64)
	else
		targets=("$saved_os")
	fi
	for t in "${targets[@]}"; do
		FAST_BUILD_OS="$t"
		if [[ "$saved_os" == darwin-both ]]; then
			FAST_BUILD_MODE=clean
		fi
		"$fn"
	done
	FAST_BUILD_OS="$saved_os"
	FAST_BUILD_MODE="$saved_mode"
}

node_at_least_2019() {
	local v="${1:-}" maj min
	[[ "$v" =~ ^v([0-9]+)\.([0-9]+)\. ]] || return 1
	maj=$((BASH_REMATCH[1]))
	min=$((BASH_REMATCH[2]))
	(( maj > 20 || (maj == 20 && min >= 19) ))
}

ensure_modern_node() {
	if node_at_least_2019 "$(node -v 2>/dev/null || true)"; then
		return 0
	fi
	local d
	while IFS= read -r d; do
		if node_at_least_2019 "$("$d/node" -v 2>/dev/null || true)"; then
			export PATH="$d:$PATH"
			echo "node $(node -v) (from $d)"
			return 0
		fi
	done < <(ls -1d "$HOME"/.volta/tools/image/node/*/bin 2>/dev/null | sort -rV)
	echo "electron-builder26 needs node >=20.19 (require(esm)); found $(node -v 2>/dev/null || echo none)." >&2
	echo "  fix: put Node 22 first on PATH" >&2
	exit 1
}

ensure_engine() {
	local dest="$root/modules/engine/current"
	local marker="$dest/.fast-os"
	local want="" have="" cli=""
	want="$(resolved_os)" || exit 1
	if engine_cli_path "$dest" >/dev/null && [[ "${FAST_BUILD_MODE:-incremental}" != clean ]]; then
		normalize_engine_bin "$dest"
		cli="$(engine_cli_path "$dest")"
		have="$(cat "$marker" 2>/dev/null || true)"
		if [[ -n "$have" && "$have" != "$want" ]]; then
			echo "modules/engine/current is $have; --os $want needs --clean" >&2
			exit 1
		fi
		if ! engine_jre_ok "$dest" "$want"; then
			"$root/scripts/ensure-engine-jre.sh" "$dest" "$want"
		fi
		"$root/scripts/patch-engine-java.sh" "$dest"
		echo "engine already at $cli"
		return
	fi
	local fetch_args=()
	if [[ "${FAST_BUILD_MODE:-incremental}" == clean ]]; then
		fetch_args+=(--clean)
	else
		fetch_args+=(--incremental)
	fi
	fetch_args+=("$want")
	"$root/scripts/fetch-engine.sh" "${fetch_args[@]}"
}

build_js() {
	pnpm --dir packages/core/bridge/protocol run build
	pnpm --dir packages/core/bridge/client run build
	pnpm --dir packages/core/session-view run build
	pnpm --dir apps/tui run build
}

stage() {
	if [[ "${FAST_BUILD_MODE:-incremental}" == clean ]]; then
		rm -rf "$root/staging/pack"
	fi
	node "$root/scripts/stage-pack.mjs"
}

pack_cli() {
	local dest link
	dest="$(cli_pack_dir)"
	link="$root/release/cli"
	rm -rf "$dest"
	mkdir -p "$dest"
	cp -R "$root/staging/pack/." "$dest/"
	chmod +x "$dest/bin/fast-cli" "$dest/bin/fast" "$dest/bin/fast-ink" "$dest/engine/bin/fast-cli" 2>/dev/null || true
	mkdir -p "$root/release"
	rm -rf "$link"
	ln -sfn "$(basename "$dest")" "$link"
	echo_sized "CLI pack ->" "$dest"
	echo "  $dest/bin/fast-ink"
	echo "  $dest/bin/fast-cli"
	echo "  $dest/bin/fast"
	echo "  $link -> $(basename "$dest")"
	if [[ -d "$dest/engine/jre" ]]; then
		echo_sized "  jre" "$dest/engine/jre"
	fi
}

clear_mac_out() {
	local eos="${1:-}"
	local dir bak
	case "$eos" in
		darwin-arm64) dir="$root/apps/desktop/release/mac-arm64" ;;
		*) dir="$root/apps/desktop/release/mac" ;;
	esac
	[[ -e "$dir" ]] || return 0
	chmod -R u+w "$dir" 2>/dev/null || true
	if rm -rf "$dir" 2>/dev/null; then
		return 0
	fi
	bak="${dir}.bak.$$"
	if mv "$dir" "$bak" 2>/dev/null; then
		echo "$dir in use; moved aside -> $bak"
		rm -rf "$bak" 2>/dev/null || echo "leave $bak (quit Fast.app to delete)"
		return 0
	fi
	echo "cannot clear $dir (quit Fast.app launched from that folder)" >&2
	lsof +D "$dir" 2>/dev/null | awk 'NR==1 || /Fast|java|Electron/' | head -20 >&2 || true
	exit 1
}

pack_desktop() {
	if [[ ! -d "$root/staging/pack/engine" || ! -f "$root/staging/pack/tui/dist/main.js" ]]; then
		echo "stage first (missing staging/pack)" >&2
		exit 1
	fi
	export CSC_IDENTITY_AUTO_DISCOVERY=false
	if [[ "${ELECTRON_MIRROR:-}${npm_config_electron_mirror:-}" == *taobao* ]]; then
		export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
		export npm_config_electron_mirror=https://npmmirror.com/mirrors/electron/
	fi
	local eos platform cpu
	eos="$(resolved_os)" || exit 1
	platform="$(electron_platform "$eos")"
	cpu="$(electron_cpu "$eos")"
	ensure_modern_node
	if [[ "$platform" == darwin ]]; then
		clear_mac_out "$eos"
		rm -f "$root/apps/desktop/release/"*-mac-"${cpu}.pkg" "$root/apps/desktop/release/"*-mac-"${cpu}.dmg"
	fi
	(
		cd "$root/apps/desktop"
		if [[ "$platform" == darwin ]]; then
			bash scripts/pack/make-mac-icon.sh
		fi
		pnpm exec electron-vite build
		node scripts/pack/vendor-npm.mjs
		case "$platform" in
			darwin) CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --config electron-builder.yml --mac pkg "--$cpu" ;;
			linux) CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --config electron-builder.yml --linux dir "--$cpu" ;;
			win) CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --config electron-builder.yml --win dir ;;
		esac
	)
	local app pkg dmg unpacked res
	if [[ "$platform" == darwin ]]; then
		app="$(mac_unpacked_app "$eos")"
		[[ -d "$app" ]] || app=""
		pkg="$(mac_installer pkg "$cpu")"
		dmg="$(mac_installer dmg "$cpu")"
		[[ -f "$pkg" ]] || pkg=""
		[[ -f "$dmg" ]] || dmg=""
		unpacked=""
	elif [[ "$platform" == linux ]]; then
		app=""
		pkg=""
		dmg=""
		unpacked="$(linux_unpacked_dir "$eos")"
		[[ -d "$unpacked" ]] || unpacked=""
	else
		app="$(find "$root/apps/desktop/release" -name 'Fast.app' -type d -print -quit 2>/dev/null || true)"
		pkg="$(find "$root/apps/desktop/release" -maxdepth 1 -name '*.pkg' -print -quit 2>/dev/null || true)"
		dmg="$(find "$root/apps/desktop/release" -maxdepth 1 -name '*.dmg' -print -quit 2>/dev/null || true)"
		unpacked="$(find "$root/apps/desktop/release" -maxdepth 1 -type d -name '*unpacked' -print -quit 2>/dev/null || true)"
	fi
	if [[ -n "$app" ]]; then
		app="$(cd "$app" && pwd)"
		res="$app/Contents/Resources"
		echo_sized "Desktop app ->" "$app"
		echo "  engine $res/engine/bin/fast-cli"
		echo "  shims  $res/bin"
		if [[ -d "$res/engine/jre" ]]; then
			echo_sized "  jre" "$res/engine/jre"
		fi
	fi
	if [[ -n "$pkg" && -n "$dmg" ]]; then
		pkg="$(cd "$(dirname "$pkg")" && pwd)/$(basename "$pkg")"
		dmg="$(cd "$(dirname "$dmg")" && pwd)/$(basename "$dmg")"
		mkdir -p "$root/release"
		ln -sfn "$pkg" "$root/release/$(basename "$pkg")"
		ln -sfn "$dmg" "$root/release/$(basename "$dmg")"
		echo_sized "Installer ->" "$dmg"
		echo_sized "  pkg" "$pkg"
		echo "  contains Install Fast.pkg (installs /Applications/Fast.app + /usr/local/bin/{fast-ink,fast-cli,fast})"
	elif [[ "$platform" == darwin ]]; then
		echo "electron-builder finished; missing $(mac_installer pkg "$cpu") or $(mac_installer dmg "$cpu")" >&2
		exit 1
	elif [[ -n "$unpacked" ]]; then
		unpacked="$(cd "$unpacked" && pwd)"
		echo_sized "Desktop dir ->" "$unpacked"
		echo "  engine $unpacked/resources/engine/bin/fast-cli"
		if [[ -d "$unpacked/resources/engine/jre" ]]; then
			echo_sized "  jre" "$unpacked/resources/engine/jre"
		fi
	else
		echo "electron-builder finished; no Fast.app / unpacked dir under apps/desktop/release" >&2
		exit 1
	fi
}

smoke_cli() {
	local dest engine_os
	dest="$(cli_pack_dir)"
	[[ -x "$dest/bin/fast-cli" || -f "$dest/bin/fast-cli" ]] || {
		echo "smoke: missing $dest/bin/fast-cli" >&2
		exit 1
	}
	[[ -e "$dest/bin/fast" ]] || {
		echo "smoke: missing $dest/bin/fast" >&2
		exit 1
	}
	[[ -f "$dest/tui/dist/main.js" ]] || {
		echo "smoke: missing tui" >&2
		exit 1
	}
	[[ -f "$dest/tui/node_modules/@fast-ide/session-view/dist/index.js" ]] || {
		echo "smoke: staged session-view not linked" >&2
		exit 1
	}
	engine_os="$(tr -d '[:space:]' <"$dest/engine/.fast-os" 2>/dev/null || true)"
	[[ "$engine_os" == "$(resolved_os)" ]] || {
		echo "smoke: $dest engine is ${engine_os:-unknown}; expected $(resolved_os)" >&2
		exit 1
	}
	engine_jre_ok "$dest/engine" "$(resolved_os)" || {
		echo "smoke: missing bundled JRE at $dest/engine/jre (expected temurin-17-$(resolved_os))" >&2
		exit 1
	}
	grep -q 'jre/bin/java' "$dest/engine/bin/fast-cli" || {
		echo "smoke: $dest/engine/bin/fast-cli does not exec bundled jre" >&2
		exit 1
	}
	[[ -s "$dest/engine/.fast-engine-id" ]] || {
		echo "smoke: missing $dest/engine/.fast-engine-id" >&2
		exit 1
	}
	(cd "$dest/tui" && node --input-type=module -e "import '@fast-ide/session-view'; import '@fastllm/bridge-client'")
	echo_sized "CLI smoke ok" "$dest"
}

smoke_desktop() {
	local app pkg dmg unpacked eos platform cpu
	eos="$(resolved_os)" || exit 1
	platform="$(electron_platform "$eos")"
	cpu="$(electron_cpu "$eos")"
	if [[ "$platform" == darwin ]]; then
		app="$(mac_unpacked_app "$eos")"
		[[ -d "$app" ]] || app=""
		pkg="$(mac_installer pkg "$cpu")"
		dmg="$(mac_installer dmg "$cpu")"
		[[ -f "$pkg" ]] || pkg=""
		[[ -f "$dmg" ]] || dmg=""
		unpacked=""
	elif [[ "$platform" == linux ]]; then
		app=""
		pkg=""
		dmg=""
		unpacked="$(linux_unpacked_dir "$eos")"
		[[ -d "$unpacked" ]] || unpacked=""
	else
		app="$(find "$root/apps/desktop/release" -name 'Fast.app' -type d -print -quit 2>/dev/null || true)"
		pkg="$(find "$root/apps/desktop/release" -maxdepth 1 -name '*.pkg' -print -quit 2>/dev/null || true)"
		dmg="$(find "$root/apps/desktop/release" -maxdepth 1 -name '*.dmg' -print -quit 2>/dev/null || true)"
		unpacked="$(find "$root/apps/desktop/release" -maxdepth 1 -type d -name '*unpacked' -print -quit 2>/dev/null || true)"
	fi
	if [[ -z "$app" ]]; then
		if [[ -n "$unpacked" ]] && {
			[[ -f "$unpacked/resources/engine/bin/fast-cli" ]] ||
				[[ -f "$unpacked/resources/engine/bin/fast-cli.bat" ]]
		}; then
			if [[ -f "$unpacked/Fast.exe" ]]; then
				[[ -f "$unpacked/resources/bin/fast.bat" && -f "$unpacked/resources/bin/fast-cli.bat" ]] || {
					echo "smoke: Windows dir missing resources/bin/fast.bat + fast-cli.bat" >&2
					exit 1
				}
			fi
			engine_jre_ok "$unpacked/resources/engine" "$eos" || {
				echo "smoke: missing bundled JRE in $unpacked" >&2
				exit 1
			}
			if [[ -f "$unpacked/resources/engine/bin/fast-cli" ]]; then
				grep -q 'jre/bin/java' "$unpacked/resources/engine/bin/fast-cli" || {
					echo "smoke: packaged fast-cli does not exec bundled jre" >&2
					exit 1
				}
			fi
			[[ -s "$unpacked/resources/engine/.fast-engine-id" ]] || {
				echo "smoke: missing $unpacked/resources/engine/.fast-engine-id" >&2
				exit 1
			}
			echo_sized "Desktop smoke ok (dir)" "$unpacked"
			return
		fi
		echo "desktop smoke skipped (no Fast.app)"
		return
	fi
	local res="$app/Contents/Resources"
	[[ -f "$res/engine/bin/fast-cli" ]] || {
		echo "smoke: packaged engine missing" >&2
		exit 1
	}
	local engine_os bin_info
	engine_os="$(tr -d '[:space:]' <"$res/engine/.fast-os" 2>/dev/null || true)"
	[[ "$engine_os" == "$eos" ]] || {
		echo "smoke: packaged engine is ${engine_os:-unknown}; expected $eos" >&2
		exit 1
	}
	engine_jre_ok "$res/engine" "$eos" || {
		echo "smoke: missing bundled JRE at $res/engine/jre" >&2
		exit 1
	}
	grep -q 'jre/bin/java' "$res/engine/bin/fast-cli" || {
		echo "smoke: packaged fast-cli does not exec bundled jre" >&2
		exit 1
	}
	[[ -s "$res/engine/.fast-engine-id" ]] || {
		echo "smoke: missing $res/engine/.fast-engine-id" >&2
		exit 1
	}
	bin_info="$(file "$app/Contents/MacOS/Fast" 2>/dev/null || true)"
	case "$eos" in
		darwin-arm64)
			[[ "$bin_info" == *arm64* ]] || {
				echo "smoke: Fast.app is not arm64 ($bin_info)" >&2
				exit 1
			}
			;;
		darwin-x64)
			[[ "$bin_info" == *x86_64* ]] || {
				echo "smoke: Fast.app is not x86_64 ($bin_info)" >&2
				exit 1
			}
			;;
	esac
	[[ -x "$res/bin/fast-ink" || -f "$res/bin/fast-ink" ]] || {
		echo "smoke: packaged fast-ink shim missing" >&2
		exit 1
	}
	[[ -e "$res/bin/fast-cli" && -e "$res/bin/fast" ]] || {
		echo "smoke: packaged PATH shims missing (fast-cli + alias fast)" >&2
		exit 1
	}
	[[ -f "$res/Assets.car" ]] || {
		echo "smoke: packaged Assets.car missing" >&2
		exit 1
	}
	[[ "$(plutil -extract CFBundleIconName raw "$app/Contents/Info.plist" 2>/dev/null || true)" == AppIcon ]] || {
		echo "smoke: CFBundleIconName is not AppIcon" >&2
		exit 1
	}
	[[ -n "$pkg" && -f "$pkg" ]] || {
		echo "smoke: missing $(mac_installer pkg "$cpu")" >&2
		exit 1
	}
	[[ -n "$dmg" && -f "$dmg" ]] || {
		echo "smoke: missing $(mac_installer dmg "$cpu")" >&2
		exit 1
	}
	local expand script attach asar asar_js
	expand="$(mktemp -d)"
	pkgutil --expand "$pkg" "$expand/pkg"
	script="$(find "$expand" -name '*postinstall*' -print -quit)"
	[[ -n "$script" ]] || {
		echo "smoke: pkg has no postinstall" >&2
		rm -rf "$expand"
		exit 1
	}
	grep -q '/usr/local/bin/fast-ink' "$script" || {
		echo "smoke: postinstall does not link fast-ink" >&2
		rm -rf "$expand"
		exit 1
	}
	grep -q '/usr/local/bin/fast-cli' "$script" || {
		echo "smoke: postinstall does not link fast-cli" >&2
		rm -rf "$expand"
		exit 1
	}
	# exact `fast`, not a prefix of fast-cli / fast-ink
	grep -qE '/usr/local/bin/fast([^[:alnum:]_-]|$)' "$script" || {
		echo "smoke: postinstall does not link alias fast" >&2
		rm -rf "$expand"
		exit 1
	}
	rm -rf "$expand"
	attach="$(hdiutil attach -nobrowse -readonly "$dmg" | sed -n 's/.*\(\/Volumes\/.*\)$/\1/p' | tail -n1)"
	if [[ -z "$attach" || ! -f "$attach/Install Fast.pkg" ]]; then
		echo "smoke: dmg missing Install Fast.pkg (mounted as ${attach:-none})" >&2
		if [[ "$attach" == /Volumes/* ]]; then
			hdiutil detach "$attach" >/dev/null 2>&1 || true
		fi
		exit 1
	fi
	hdiutil detach "$attach" >/dev/null
	asar="$res/app.asar"
	[[ -f "$asar" ]] || {
		echo "smoke: missing $asar" >&2
		exit 1
	}
	asar_js="$(find "$root/node_modules/.pnpm" -path '*@electron+asar*/node_modules/@electron/asar/bin/asar.js' 2>/dev/null | head -1)"
	if [[ -n "$asar_js" ]]; then
		if node "$asar_js" list "$asar" | grep -q '^/node_modules'; then
			echo "smoke: app.asar still contains /node_modules" >&2
			exit 1
		fi
		node "$asar_js" list "$asar" | grep -q 'ts.worker' || {
			echo "smoke: app.asar missing Monaco ts.worker" >&2
			exit 1
		}
	else
		echo "smoke: @electron/asar not found; skip asar list checks" >&2
	fi
	echo_sized "Desktop smoke ok" "$dmg"
}

prepare_pack() {
	ensure_engine
	build_js
	stage
}
