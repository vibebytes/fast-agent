#!/usr/bin/env bash
# icon.png (full-bleed art) + macos-squircle-mask.png (Apple 1024 grid)
# → icon.icns (complete iconutil set) + Assets.car.
#
# macOS 14/15 render ICNS literally and do not apply a system squircle.
# ChatGPT/Cursor ship a 824×824 tile with 100px transparent margins on a
# 1024 canvas. Full-bleed opaque art shows as a sharp square.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
build="$root/build"
src="$build/icon.png"
mask="$build/macos-squircle-mask.png"
[[ -f "$src" ]] || {
	echo "make-mac-icon: missing $src" >&2
	exit 1
}
[[ -f "$mask" ]] || {
	echo "make-mac-icon: missing $mask" >&2
	exit 1
}

actool="$(xcrun --find actool 2>/dev/null || true)"
[[ -n "$actool" && -x "$actool" ]] || {
	echo "make-mac-icon: actool not found (need Xcode)" >&2
	exit 1
}

work="$(mktemp -d "${TMPDIR:-/tmp}/fast-mac-icon.XXXXXX")"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT

setdir="$work/icon.iconset"
assets="$work/Icon.xcassets"
appicon="$assets/AppIcon.appiconset"
mkdir -p "$setdir" "$appicon"

python3 - "$src" "$mask" "$setdir" "$appicon" "$work/masked.png" <<'PY'
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

src, mask_p, iconset, appicon, masked_p = map(Path, sys.argv[1:])
im = Image.open(src).convert("RGBA")
mk = Image.open(mask_p).convert("L")
if mk.size != im.size:
    mk = mk.resize(im.size, Image.Resampling.LANCZOS)
im.putalpha(mk)
arr = np.array(im)
arr[arr[..., 3] == 0] = 0
im = Image.fromarray(arr, "RGBA")
im.save(masked_p, "PNG")

sizes = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]
for name, sz in sizes:
    out = im.resize((sz, sz), Image.Resampling.LANCZOS)
    out.save(iconset / name, "PNG")
    out.save(appicon / name, "PNG")

catalog = {
    "images": [
        {"filename": "icon_16x16.png", "idiom": "mac", "scale": "1x", "size": "16x16"},
        {"filename": "icon_16x16@2x.png", "idiom": "mac", "scale": "2x", "size": "16x16"},
        {"filename": "icon_32x32.png", "idiom": "mac", "scale": "1x", "size": "32x32"},
        {"filename": "icon_32x32@2x.png", "idiom": "mac", "scale": "2x", "size": "32x32"},
        {"filename": "icon_128x128.png", "idiom": "mac", "scale": "1x", "size": "128x128"},
        {"filename": "icon_128x128@2x.png", "idiom": "mac", "scale": "2x", "size": "128x128"},
        {"filename": "icon_256x256.png", "idiom": "mac", "scale": "1x", "size": "256x256"},
        {"filename": "icon_256x256@2x.png", "idiom": "mac", "scale": "2x", "size": "256x256"},
        {"filename": "icon_512x512.png", "idiom": "mac", "scale": "1x", "size": "512x512"},
        {"filename": "icon_512x512@2x.png", "idiom": "mac", "scale": "2x", "size": "512x512"},
    ],
    "info": {"author": "xcode", "version": 1},
}
(appicon / "Contents.json").write_text(json.dumps(catalog, indent=2) + "\n")
(appicon.parent / "Contents.json").write_text(
    json.dumps({"info": {"author": "xcode", "version": 1}}, indent=2) + "\n"
)
PY

iconutil -c icns "$setdir" -o "$build/icon.icns"

compiled="$work/compiled"
mkdir -p "$compiled"
"$actool" \
	"$assets" \
	--compile "$compiled" \
	--app-icon AppIcon \
	--output-partial-info-plist "$compiled/partial.plist" \
	--platform macosx \
	--minimum-deployment-target 11.0 \
	--errors --warnings \
	--output-format human-readable-text
[[ -f "$compiled/Assets.car" ]] || {
	echo "make-mac-icon: actool did not write Assets.car" >&2
	exit 1
}
cp "$compiled/Assets.car" "$build/Assets.car"

# iconutil keeps every size. actool's AppIcon.icns is a stub (no 512/1024) — do not replace.

python3 - "$build/icon.icns" <<'PY'
import subprocess, sys, tempfile
from pathlib import Path
from PIL import Image
import numpy as np

icns = Path(sys.argv[1])
with tempfile.TemporaryDirectory() as td:
    out = Path(td) / "check.iconset"
    subprocess.run(["iconutil", "--convert", "iconset", str(icns), "-o", str(out)], check=True)
    names = sorted(p.name for p in out.glob("*.png"))
    need = {
        "icon_16x16.png", "icon_16x16@2x.png", "icon_32x32.png", "icon_32x32@2x.png",
        "icon_128x128.png", "icon_128x128@2x.png", "icon_256x256.png", "icon_256x256@2x.png",
        "icon_512x512.png", "icon_512x512@2x.png",
    }
    missing = sorted(need - set(names))
    if missing:
        raise SystemExit(f"make-mac-icon: icns missing {missing}")
    im = Image.open(out / "icon_512x512@2x.png").convert("RGBA")
    a = np.array(im)
    al = a[..., 3]
    if any(int(al[y, x]) > 8 for y, x in ((0, 0), (0, -1), (-1, 0), (-1, -1))):
        raise SystemExit(f"make-mac-icon: 1024 corners not transparent: {a[0,0]} {a[0,-1]}")
    ys, xs = np.where(al > 128)
    w = int(xs.max() - xs.min() + 1)
    inset = int(xs.min())
    if not (820 <= w <= 828 and 96 <= inset <= 104):
        raise SystemExit(f"make-mac-icon: tile {w} inset {inset} (want 824 / 100)")
    print(f"make-mac-icon: icns 1024 tile {w}x{w} inset {inset} corners alpha {int(al[0,0])}")
PY

echo "make-mac-icon: $build/icon.icns"
echo "make-mac-icon: $build/Assets.car"
