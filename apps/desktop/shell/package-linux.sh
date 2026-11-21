#!/bin/sh
# Builds Opaline for Linux x64 as an AppImage and a .deb. Runs on Linux (see
# .github/workflows/desktop-linux.yml); package.sh is the macOS build.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
cache_root="$HOME/.cache/opaline-desktop"
out="${OPALINE_DIST:-$cache_root/package-linux}"
cache="${OPALINE_RUNTIME_CACHE:-$cache_root/runtimes}"
server_dir="${OPALINE_SERVER_PACKAGE_DIR:-$cache_root/server-package}"
server_version="${OPALINE_SERVER_VERSION:-0.18.0-desktop.$(git -C "$repo" rev-parse --short=8 HEAD)}"
version=$(sed -n 's/^[[:space:]]*"version": "\(.*\)",$/\1/p' "$here/package.json" | head -n 1)
work="$out/.work"
app="$out/opaline-linux-x64"
appimage="$out/Opaline-$version-linux-x86_64.AppImage"
deb="$out/opaline_${version}_amd64.deb"

# appimagetool and the AppImage runtime it embeds, pinned and checked.
APPIMAGETOOL_URL=https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage
APPIMAGETOOL_SHA256=ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0
APPIMAGE_RUNTIME_URL=https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64
APPIMAGE_RUNTIME_SHA256=2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d

step() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*"; }
fail() {
	echo "package-linux: $*" >&2
	exit 1
}

[ "$(uname -s)" = Linux ] || fail "build on Linux (macOS uses package.sh)"
[ "$(uname -m)" = x86_64 ] || fail "only x86_64 is built for now"
for tool in bun dpkg-deb git curl sha256sum unzip; do
	command -v "$tool" >/dev/null || fail "needs $tool"
done
for file in onboarding-window/vendor/glass3d.js onboarding-window/dots/dots.js onboarding-window/dots/dots.css onboarding-window/previews/dark.png onboarding-window/previews/light.png icon/Opaline.png; do
	[ -f "$here/$file" ] || fail "missing $file"
done

pinned() {
	url=$1
	sha=$2
	file="$cache/$3"
	if [ ! -f "$file" ] || [ "$(sha256sum "$file" | cut -d' ' -f1)" != "$sha" ]; then
		mkdir -p "$cache"
		curl -fsSL --retry 3 -o "$file.partial" "$url"
		[ "$(sha256sum "$file.partial" | cut -d' ' -f1)" = "$sha" ] || fail "$url does not match its pinned SHA-256"
		mv "$file.partial" "$file"
	fi
	chmod +x "$file"
	printf '%s\n' "$file"
}

rm -rf "$app" "$appimage" "$deb" "$work"
mkdir -p "$out" "$work"

step "electron: verified download for linux-x64"
electron=$(bun "$here/scripts/electron.ts" "$cache" linux-x64 | tail -n 1)
[ -x "$electron/electron" ] || fail "no electron binary in $electron"

step "local server: bun build packages/local-server"
(cd "$repo/packages/local-server" && bun run build >/dev/null)

server_manifest="$server_dir/opaline-server-$server_version.json"
if [ ! -f "$server_manifest" ]; then
	step "server: bun run build:selfhost --version $server_version"
	(cd "$repo" && bun run build:selfhost --version "$server_version" --out "$server_dir" >/dev/null)
fi
[ -f "$server_manifest" ] || server_manifest=$(ls "$server_dir"/opaline-server-"$server_version"*.json | sort | tail -n 1)
server_tarball="$server_dir/$(sed -n 's/^[[:space:]]*"file": "\(.*\)",*$/\1/p' "$server_manifest" | head -n 1)"
[ -f "$server_tarball" ] || fail "no tarball for $server_manifest"

step "runtimes: verified downloads for linux-x64 in $cache"
bun "$here/scripts/runtimes.ts" unpack "$cache" "$work/unpacked" linux-x64 >/dev/null

step "pricing.js from packages/api-routes/src/model-pricing.ts"
bun build "$repo/packages/api-routes/src/model-pricing.ts" --format=cjs --target=node --outfile "$here/pricing.js" >/dev/null

step "assemble $app"
cp -a "$electron" "$app"
rm -f "$app/.complete" "$app/resources/default_app.asar"
mv "$app/electron" "$app/opaline"
resources="$app/resources"
dest="$resources/app"
mkdir -p "$dest/local-server" "$resources/server" "$resources/runtimes"
cp "$here/package.json" "$here/main.js" "$here/deep-link.js" "$here/agents.js" "$here/analyze.js" "$here/folder-access.js" "$here/pricing.js" "$here/updates.js" "$here/window-state.js" \
	"$here/preload.js" "$here/onboarding-preload.js" "$here/environments.js" "$here/environment-preload.js" "$here/dock-usage.js" "$here/star-prompt.js" "$dest/"
cp -R "$here/stack" "$here/analysis" "$here/onboarding" "$here/onboarding-window" "$here/environment-window" "$here/start-window" "$dest/"
mkdir -p "$dest/icon"
cp "$here/icon/Opaline.png" "$dest/icon/"
build_dirty=false
[ -z "$(git -C "$repo" status --porcelain --untracked-files=no)" ] || build_dirty=true
printf '{"commit":"%s","dirty":%s,"release":true}\n' "$(git -C "$repo" rev-parse --short=9 HEAD)" "$build_dirty" >"$dest/build.json"
cp "$repo/packages/local-server/dist/local-server.js" "$dest/local-server/"
printf '{"type":"module"}\n' >"$dest/local-server/package.json"
cp -R "$repo/plugin" "$dest/agent-plugin"
cp "$server_manifest" "$server_tarball" "$resources/server/"
cp -R "$work/unpacked/bin/." "$resources/runtimes/"

desktop_entry() {
	cat <<DESKTOP
[Desktop Entry]
Type=Application
Name=Opaline
Comment=See where your Claude Code and Codex agents get stuck
Exec=$1 %U
Icon=opaline
Terminal=false
Categories=Development;
MimeType=x-scheme-handler/opaline;
StartupWMClass=Opaline
DESKTOP
}

step "deb: $deb"
root="$work/deb"
mkdir -p "$root/opt" "$root/usr/bin" "$root/usr/share/applications" "$root/usr/share/icons/hicolor/512x512/apps" "$root/DEBIAN"
cp -a "$app" "$root/opt/Opaline"
ln -s /opt/Opaline/opaline "$root/usr/bin/opaline"
desktop_entry /opt/Opaline/opaline >"$root/usr/share/applications/opaline.desktop"
cp "$here/icon/Opaline.png" "$root/usr/share/icons/hicolor/512x512/apps/opaline.png"
size=$(du -sk "$root" | cut -f1)
cat >"$root/DEBIAN/control" <<CONTROL
Package: opaline
Version: $version
Architecture: amd64
Maintainer: Opaline <hello@opaline.so>
Installed-Size: $size
Depends: libgtk-3-0 | libgtk-3-0t64, libnss3, libxss1, libxtst6, libatspi2.0-0 | libatspi2.0-0t64, libuuid1, libsecret-1-0, libgbm1, libasound2 | libasound2t64, xdg-utils
Section: devel
Priority: optional
Homepage: https://opaline.so
Description: See where your Claude Code and Codex agents get stuck
 Opaline reads your Claude Code and Codex sessions on this computer and runs
 its own local server, so nothing leaves the machine.
CONTROL
# Chromium's sandbox: the setuid helper, and on Ubuntu 23.10+ an AppArmor
# profile that allows the user namespaces unprivileged apps are otherwise denied.
cat >"$root/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -e
chown root:root /opt/Opaline/chrome-sandbox
chmod 4755 /opt/Opaline/chrome-sandbox
if [ -f /etc/apparmor.d/abi/4.0 ]; then
	cat >/etc/apparmor.d/opaline <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>

profile opaline /opt/Opaline/opaline flags=(unconfined) {
  userns,
  include if exists <local/opaline>
}
PROFILE
	apparmor_parser -r /etc/apparmor.d/opaline 2>/dev/null || true
fi
command -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications || true
POSTINST
cat >"$root/DEBIAN/postrm" <<'POSTRM'
#!/bin/sh
set -e
if [ "$1" = remove ] || [ "$1" = purge ]; then
	if [ -f /etc/apparmor.d/opaline ]; then
		apparmor_parser -R /etc/apparmor.d/opaline 2>/dev/null || true
		rm -f /etc/apparmor.d/opaline
	fi
fi
command -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications || true
POSTRM
chmod 0755 "$root/DEBIAN/postinst" "$root/DEBIAN/postrm"
dpkg-deb --root-owner-group -Zxz --build "$root" "$deb" >/dev/null

step "AppImage: $appimage"
appdir="$work/AppDir"
cp -a "$app" "$appdir"
desktop_entry AppRun >"$appdir/opaline.desktop"
printf 'X-AppImage-Version=%s\n' "$version" >>"$appdir/opaline.desktop"
cp "$here/icon/Opaline.png" "$appdir/opaline.png"
ln -s opaline.png "$appdir/.DirIcon"
# An AppImage cannot ship a setuid sandbox helper. Chromium then sandboxes with
# user namespaces; where the system forbids them (Ubuntu 24.04 AppArmor), it
# runs without the sandbox instead of crashing at launch.
cat >"$appdir/AppRun" <<'APPRUN'
#!/bin/sh
here=$(dirname "$(readlink -f "$0")")
if unshare --user --map-root-user true 2>/dev/null; then
	exec "$here/opaline" "$@"
fi
exec "$here/opaline" --no-sandbox "$@"
APPRUN
chmod 0755 "$appdir/AppRun"
tool=$(pinned "$APPIMAGETOOL_URL" "$APPIMAGETOOL_SHA256" appimagetool-1.9.1-x86_64.AppImage)
runtime=$(pinned "$APPIMAGE_RUNTIME_URL" "$APPIMAGE_RUNTIME_SHA256" appimage-runtime-20251108-x86_64)
APPIMAGE_EXTRACT_AND_RUN=1 ARCH=x86_64 "$tool" --no-appstream --comp zstd --runtime-file "$runtime" "$appdir" "$appimage" >/dev/null

rm -rf "$work"
step "done: $app ($(du -sh "$app" | cut -f1)), server $(basename "$server_tarball")"
step "done: $deb ($(du -sh "$deb" | cut -f1))"
step "done: $appimage ($(du -sh "$appimage" | cut -f1))"
