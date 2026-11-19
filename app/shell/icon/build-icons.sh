#!/bin/zsh
set -e
here=$(cd "$(dirname "$0")" && pwd)
icon=$here/Opaline.icon
ictool="/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool"
t=$(mktemp -d)
render() {
	"$ictool" "$icon" --export-image --output-file "$t/a.png" --platform macOS --rendition "$1" --width "$3" --height "$3" --scale 1 >/dev/null
	sips -p "$2" "$2" "$t/a.png" --out "$4" >/dev/null
}
mkdir "$t/Opaline.iconset"
for s in 16 32 128 256 512; do
	render Default $s $((s * 824 / 1024)) "$t/Opaline.iconset/icon_${s}x${s}.png"
	render Default $((s * 2)) $((s * 2 * 824 / 1024)) "$t/Opaline.iconset/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$t/Opaline.iconset" -o "$here/Opaline.icns"
for variant in Default Dark; do
	name=opaline; [ $variant = Dark ] && name=opaline-dark
	mkdir -p "$here/png"
	for s in 16 24 32 48 64 128 256 512 1024; do
		render $variant $s $((s * 15 / 16)) "$here/png/$name-$s.png"
	done
	python3 -I - "$here/png/$name" "$here/$name.ico" <<'PY'
import struct, sys
base, out = sys.argv[1], sys.argv[2]
sizes = [16, 24, 32, 48, 64, 128, 256]
data = [open(f"{base}-{s}.png", "rb").read() for s in sizes]
head = struct.pack("<HHH", 0, 1, len(sizes))
offset = 6 + 16 * len(sizes)
entries = b""
for s, d in zip(sizes, data):
    entries += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(d), offset)
    offset += len(d)
open(out, "wb").write(head + entries + b"".join(data))
PY
done
rm -rf "$t"
