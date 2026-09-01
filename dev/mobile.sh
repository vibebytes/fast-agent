#!/usr/bin/env bash
# Expo / native mobile. Does not read modules/engine/current.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mobile="$root/apps/mobile"
android=0
ios=0
pass=()

usage() {
	cat <<'EOF'
usage: ./dev/mobile.sh [--android] [--ios] [-h|--help] [--] [expo args...]

  Start the mobile app (Expo). Does not fetch or read the engine tree.

  --android   expo run:android / start with Android
  --ios       expo run:ios / start with iOS
  -h, --help  print this help
  --          pass the rest to Expo

  Other args are forwarded to Expo.
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--android) android=1; shift ;;
		--ios) ios=1; shift ;;
		-h|--help) usage; exit 0 ;;
		--) shift; pass+=("$@"); break ;;
		*) pass+=("$1"); shift ;;
	esac
done

if [[ ! -d "$mobile/node_modules/expo" ]]; then
	echo "expo missing under apps/mobile. from $root run: pnpm install" >&2
	exit 1
fi

cd "$mobile"
if [[ "$android" -eq 1 && "$ios" -eq 1 ]]; then
	echo "use only one of --android --ios" >&2
	usage >&2
	exit 1
fi
if [[ "$android" -eq 1 ]]; then
	exec pnpm --dir "$mobile" exec expo start --android "${pass[@]+"${pass[@]}"}"
fi
if [[ "$ios" -eq 1 ]]; then
	exec pnpm --dir "$mobile" exec expo start --ios "${pass[@]+"${pass[@]}"}"
fi
exec pnpm --dir "$mobile" exec expo start "${pass[@]+"${pass[@]}"}"
