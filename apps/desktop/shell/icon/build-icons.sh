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
rm -rf "$t"
