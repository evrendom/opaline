#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
cache_root="$HOME/.cache/opaline-desktop"
out="${OPALINE_DIST:-$cache_root/package}"
cache="${OPALINE_RUNTIME_CACHE:-$cache_root/runtimes}"
server_dir="${OPALINE_SERVER_PACKAGE_DIR:-$cache_root/server-package}"
server_version="${OPALINE_SERVER_VERSION:-0.18.0-desktop.$(git -C "$repo" rev-parse --short=8 HEAD)}"
layout="${OPALINE_RUNTIMES_LAYOUT:-unpacked}"
identity="${OPALINE_SIGN_IDENTITY:--}"
notary="${OPALINE_NOTARY_PROFILE:-}"
electron_app="${ELECTRON_APP:-$here/node_modules/electron/dist/Electron.app}"
version=$(sed -n 's/^[[:space:]]*"version": "\(.*\)",$/\1/p' "$here/package.json" | head -n 1)
app="$out/Opaline.app"
dmg="$out/Opaline.dmg"
dmg_theme="${OPALINE_DMG_THEME:-dark}"
work="$out/.work"

step() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*"; }

[ -d "$electron_app" ] || { echo "No Electron.app at $electron_app (symlink node_modules/electron)." >&2; exit 1; }
for file in onboarding-window/vendor/glass3d.js onboarding-window/dots/dots.js onboarding-window/dots/dots.css onboarding-window/previews/dark.png onboarding-window/previews/light.png; do
	[ -f "$here/$file" ] || { echo "Missing $file (see build-glass3d.sh, build-dots.sh, scripts/grab-previews.mjs)." >&2; exit 1; }
done

if [ "${OPALINE_DMG:-1}" != 0 ]; then
	[ -f "$here/dmg/background-$dmg_theme.tiff" ] || { echo "No DMG background for OPALINE_DMG_THEME=$dmg_theme (dark or light)." >&2; exit 1; }
fi

rm -rf "$app" "$dmg" "$work"
mkdir -p "$out" "$work"

step "local server: bun build packages/local-server"
(cd "$repo/packages/local-server" && bun run build >/dev/null)

server_manifest="$server_dir/opaline-server-$server_version.json"
if [ ! -f "$server_manifest" ]; then
	step "server: bun run build:selfhost --version $server_version"
	(cd "$repo" && bun run build:selfhost --version "$server_version" --out "$server_dir" >/dev/null)
fi
[ -f "$server_manifest" ] || server_manifest=$(ls "$server_dir"/opaline-server-"$server_version"*.json | sort | tail -n 1)
server_tarball="$server_dir/$(sed -n 's/^[[:space:]]*"file": "\(.*\)",*$/\1/p' "$server_manifest" | head -n 1)"
[ -f "$server_tarball" ] || { echo "No tarball for $server_manifest" >&2; exit 1; }

step "runtimes: verified downloads in $cache ($layout)"
if [ "$layout" = unpacked ]; then
	bun "$here/scripts/runtimes.ts" unpack "$cache" "$work/unpacked" >/dev/null
else
	bun "$here/scripts/runtimes.ts" download "$cache" "$work/runtimes" >/dev/null
fi

step "pricing.js from packages/api-routes/src/model-pricing.ts"
bun build "$repo/packages/api-routes/src/model-pricing.ts" --format=cjs --target=node --outfile "$here/pricing.js" >/dev/null

step "assemble $app"
cp -R "$electron_app" "$app"
rm -f "$app/Contents/Resources/default_app.asar"
resources="$app/Contents/Resources"
dest="$resources/app"
mkdir -p "$dest/local-server" "$resources/server" "$resources/runtimes"
cp "$here/package.json" "$here/main.js" "$here/agents.js" "$here/analyze.js" "$here/pricing.js" \
	"$here/preload.js" "$here/onboarding-preload.js" "$here/environments.js" "$here/environment-preload.js" "$dest/"
cp -R "$here/stack" "$here/analysis" "$here/onboarding" "$here/onboarding-window" "$here/environment-window" "$dest/"
cp "$repo/packages/local-server/dist/local-server.js" "$dest/local-server/"
printf '{"type":"module"}\n' > "$dest/local-server/package.json"
cp -R "$repo/plugins/opaline" "$dest/agent-plugin"
cp "$server_manifest" "$server_tarball" "$resources/server/"
if [ "$layout" = unpacked ]; then
	cp -R "$work/unpacked/bin/." "$resources/runtimes/"
else
	mkdir -p "$resources/runtimes/downloads"
	for file in $(bun -e "console.log(Object.values(require('$work/runtimes/runtimes.json').files).join(' '))"); do
		cp -c "$cache/$file" "$resources/runtimes/downloads/$file" 2>/dev/null || cp "$cache/$file" "$resources/runtimes/downloads/$file"
		chmod 0644 "$resources/runtimes/downloads/$file"
	done
	cp "$work/runtimes/runtimes.json" "$resources/runtimes/runtimes.json"
fi
cp "$here/icon/Opaline.icns" "$resources/Opaline.icns"
mkdir -p "$work/icon"
xcrun actool "$here/icon/Opaline.icon" --compile "$work/icon" --app-icon Opaline --include-all-app-icons \
	--enable-on-demand-resources NO --development-region en --target-device mac --platform macosx \
	--minimum-deployment-target 11.0 --output-partial-info-plist "$work/icon.plist" >/dev/null
cp "$work/icon/Assets.car" "$resources/Assets.car"
plist="$app/Contents/Info.plist"
plutil -replace CFBundleName -string Opaline "$plist"
plutil -replace CFBundleDisplayName -string Opaline "$plist"
plutil -replace CFBundleIdentifier -string so.opaline.desktop "$plist"
plutil -replace CFBundleIconFile -string Opaline.icns "$plist"
plutil -replace CFBundleIconName -string Opaline "$plist"
mv "$app/Contents/MacOS/Electron" "$app/Contents/MacOS/Opaline"
plutil -replace CFBundleExecutable -string Opaline "$plist"
plutil -replace CFBundleShortVersionString -string "$version" "$plist"
plutil -replace CFBundleVersion -string "$version" "$plist"
xattr -cr "$app"

if [ "$identity" = "-" ]; then
	step "sign: ad-hoc"
	codesign --force --deep --sign - "$app"
else
	step "sign: $identity (hardened runtime)"
	entitlements="$here/build/entitlements.plist"
	find "$resources/runtimes" -type f -perm -u+x | while read -r binary; do
		if file "$binary" | grep -q Mach-O; then
			codesign --force --timestamp --options runtime --entitlements "$entitlements" --sign "$identity" "$binary"
		fi
	done
	find "$app/Contents/Frameworks" -depth \( -name '*.dylib' -o -name '*.framework' -o -name '*.app' \) | while read -r item; do
		codesign --force --timestamp --options runtime --entitlements "$entitlements" --sign "$identity" "$item"
	done
	codesign --force --timestamp --options runtime --entitlements "$entitlements" --sign "$identity" "$app"
	if [ -n "$notary" ]; then
		step "notarize: notarytool profile $notary"
		ditto -c -k --keepParent "$app" "$out/Opaline-notarize.zip"
		xcrun notarytool submit "$out/Opaline-notarize.zip" --keychain-profile "$notary" --wait
		xcrun stapler staple "$app"
		rm -f "$out/Opaline-notarize.zip"
	fi
fi
codesign --verify --deep --strict "$app"

build_dmg() {
	stage="$work/dmg"
	rw="$work/Opaline-rw.dmg"
	for mounted in /Volumes/Opaline "/Volumes/Opaline "[0-9]*; do
		[ -d "$mounted" ] || continue
		hdiutil detach "$mounted" >/dev/null 2>&1 || { echo "A volume named Opaline is mounted at $mounted and could not be ejected; eject it and run again." >&2; exit 1; }
	done
	mkdir -p "$stage/.background"
	cp -cR "$app" "$stage/" 2>/dev/null || { rm -rf "$stage/Opaline.app"; ditto "$app" "$stage/Opaline.app"; }
	ln -s /Applications "$stage/Applications"
	cp "$here/dmg/background-$dmg_theme.tiff" "$stage/.background/background.tiff"
	size=$(($(du -sm "$stage" | cut -f1) * 11 / 10 + 64))
	hdiutil create -srcfolder "$stage" -volname Opaline -fs HFS+ -format UDRW -size "${size}m" "$rw" >/dev/null
	attached=$(hdiutil attach "$rw" -readwrite -noverify -noautoopen)
	device=$(printf '%s\n' "$attached" | awk 'NR == 1 { print $1 }')
	volume=$(printf '%s\n' "$attached" | sed -n 's|^.*[[:space:]]\(/Volumes/.*\)$|\1|p' | tail -n 1)
	trap 'hdiutil detach "$device" -force >/dev/null 2>&1' EXIT
	[ "$volume" = /Volumes/Opaline ] || { echo "$rw mounted at ${volume:-nowhere}, not /Volumes/Opaline." >&2; exit 1; }
	osascript >/dev/null <<'APPLESCRIPT'
tell application "Finder"
	tell disk "Opaline"
		open
		set current view of container window to icon view
		set toolbar visible of container window to false
		set statusbar visible of container window to false
		set pathbar visible of container window to false
		set bounds of container window to {200, 120, 860, 552}
		set viewOptions to icon view options of container window
		set arrangement of viewOptions to not arranged
		set icon size of viewOptions to 128
		set text size of viewOptions to 13
		set background picture of viewOptions to file ".background:background.tiff"
		set position of item "Opaline.app" to {170, 178}
		set position of item "Applications" to {490, 178}
		update without registering applications
		delay 1
		close
	end tell
end tell
APPLESCRIPT
	waited=0
	while [ ! -f "$volume/.DS_Store" ] && [ "$waited" -lt 10 ]; do
		sleep 1
		waited=$((waited + 1))
	done
	rm -rf "$volume/.fseventsd"
	sync
	hdiutil detach "$device" >/dev/null 2>&1 || { sleep 2; hdiutil detach "$device" -force >/dev/null; }
	trap - EXIT
	hdiutil convert "$rw" -format ULFO -o "$dmg" >/dev/null
	rm -f "$rw"
	if [ "$identity" != "-" ]; then
		codesign --force --timestamp --sign "$identity" "$dmg"
		if [ -n "$notary" ]; then
			step "notarize: $dmg"
			xcrun notarytool submit "$dmg" --keychain-profile "$notary" --wait
			xcrun stapler staple "$dmg"
		fi
	fi
}

if [ "${OPALINE_DMG:-1}" != 0 ]; then
	step "dmg: $dmg ($dmg_theme)"
	build_dmg
fi
rm -rf "$work"
step "done: $app ($(du -sh "$app" | cut -f1)), server $(basename "$server_tarball"), runtimes $layout"
[ ! -f "$dmg" ] || step "done: $dmg ($(du -sh "$dmg" | cut -f1))"
