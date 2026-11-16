#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)

usage() {
	cat <<'USAGE'
usage: apps/desktop/publish.sh [--dry-run] [--notes TEXT | --notes-file FILE] [--target REF]

Publishes the Opaline desktop app that package.sh built as a GitHub release, and
points installed apps at it.

Release procedure:
  1. Bump "version" in apps/desktop/package.json (semver, higher than the last
     desktop-v* release), commit, and push the commit.
  2. Build, sign and notarize from that commit:
       OPALINE_SIGN_IDENTITY="Developer ID Application: Evren Dombak (M8L5AS39YN)" \
       OPALINE_NOTARY_PROFILE=opaline-notary apps/desktop/package.sh
  3. apps/desktop/publish.sh --dry-run    checks everything, writes the zip and feed
  4. apps/desktop/publish.sh              creates release desktop-v<version> with the
                                          DMG, the update zip and the feed, then
                                          replaces the feed on release desktop-latest

Installed apps read
  https://github.com/<repository>/releases/download/desktop-latest/desktop-update-darwin-<arch>.json
and download the zip it names from the versioned release.

Environment:
  OPALINE_DIST          folder with Opaline.app and Opaline.dmg (default ~/.cache/opaline-desktop/package)
  OPALINE_RELEASE_REPO  GitHub repository (default: the one the app reads updates from)
  OPALINE_TEAM_ID       Developer ID team the app must be signed by (default M8L5AS39YN)
  OPALINE_RELEASE_WORK  where the zip and feed are written (default ~/.cache/opaline-desktop/release)
USAGE
}

dry_run=0
notes=""
notes_file=""
target=""
while [ $# -gt 0 ]; do
	case "$1" in
	--dry-run) dry_run=1 ;;
	--notes)
		notes="$2"
		shift
		;;
	--notes-file)
		notes_file="$2"
		shift
		;;
	--target)
		target="$2"
		shift
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		usage >&2
		exit 2
		;;
	esac
	shift
done

fail() {
	echo "publish: $*" >&2
	exit 1
}
step() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*"; }
updates_js() { bun -e "const u = require('$here/updates.js'); $1"; }

dist="${OPALINE_DIST:-$HOME/.cache/opaline-desktop/package}"
app="$dist/Opaline.app"
dmg="$dist/Opaline.dmg"
team="${OPALINE_TEAM_ID:-M8L5AS39YN}"
repository="${OPALINE_RELEASE_REPO:-$(updates_js 'console.log(u.REPOSITORY)')}"
feed_tag=$(updates_js 'console.log(u.FEED_TAG)')
version=$(sed -n 's/^[[:space:]]*"version": "\(.*\)",$/\1/p' "$here/package.json" | head -n 1)
tag=$(updates_js "console.log(u.releaseTag('$version'))")

[ -d "$app" ] || fail "no $app; run apps/desktop/package.sh first"
[ -f "$dmg" ] || fail "no $dmg; run package.sh without OPALINE_DMG=0"
updates_js "u.compareVersions('$version', '0.0.0')" >/dev/null 2>&1 || fail "apps/desktop/package.json version \"$version\" is not semver"

step "version $version ($tag) to $repository"
plist="$app/Contents/Info.plist"
short=$(plutil -extract CFBundleShortVersionString raw -o - "$plist")
bundle=$(plutil -extract CFBundleVersion raw -o - "$plist")
inner=$(sed -n 's/^[[:space:]]*"version": "\(.*\)",$/\1/p' "$app/Contents/Resources/app/package.json" | head -n 1)
[ "$short" = "$version" ] && [ "$bundle" = "$version" ] && [ "$inner" = "$version" ] ||
	fail "the app is $short (CFBundleVersion $bundle, app/package.json $inner), apps/desktop/package.json says $version; rebuild with package.sh"
[ -f "$app/Contents/Resources/app/updates.js" ] || fail "the app has no updater (Resources/app/updates.js); rebuild with package.sh"

case "$(lipo -archs "$app/Contents/MacOS/Opaline")" in
arm64) arch=arm64 ;;
x86_64) arch=x64 ;;
*) fail "the app must be built for one architecture, found: $(lipo -archs "$app/Contents/MacOS/Opaline")" ;;
esac

step "signature and notarization"
codesign --verify --deep --strict "$app" || fail "$app does not pass codesign --verify --deep --strict"
signer=$(codesign -dvv "$app" 2>&1 | sed -n 's/^TeamIdentifier=//p')
[ "$signer" = "$team" ] || fail "the app is signed by team ${signer:-none}, updates must come from $team"
assessment=$(spctl -a -vv -t exec "$app" 2>&1) || fail "Gatekeeper rejects $app: $assessment"
printf '%s\n' "$assessment" | grep -q '^source=Notarized Developer ID$' || fail "$app is not notarized: $assessment"
xcrun stapler validate "$app" >/dev/null 2>&1 || fail "$app has no stapled notarization ticket"
assessment=$(spctl -a -vv -t open --context context:primary-signature "$dmg" 2>&1) || fail "Gatekeeper rejects $dmg: $assessment"
printf '%s\n' "$assessment" | grep -q '^source=Notarized Developer ID$' || fail "$dmg is not notarized: $assessment"
xcrun stapler validate "$dmg" >/dev/null 2>&1 || fail "$dmg has no stapled notarization ticket"

step "release target"
if [ -z "$target" ]; then
	manifest=$(ls "$app/Contents/Resources/server"/opaline-server-*.json 2>/dev/null | sort | tail -n 1)
	short_sha=$(basename "${manifest:-none}" .json | sed -n 's/^opaline-server-.*\.\([0-9a-f]\{8,\}\)$/\1/p')
	[ -n "$short_sha" ] || fail "cannot tell which commit the app was built from; pass --target <commit>"
	target="$short_sha"
fi
commit=$(git -C "$repo" rev-parse --verify --quiet "$target^{commit}") || fail "unknown commit $target"
[ -n "$(git -C "$repo" branch -r --contains "$commit" 2>/dev/null)" ] || fail "commit $commit is not on any pushed branch; push it first"
[ "$(git -C "$repo" show "$commit:apps/desktop/package.json" | sed -n 's/^[[:space:]]*"version": "\(.*\)",$/\1/p' | head -n 1)" = "$version" ] ||
	fail "commit $commit has another apps/desktop/package.json version; bump, commit and rebuild"

step "GitHub: $repository"
gh auth status >/dev/null 2>&1 || fail "gh is not signed in"
if gh release view "$tag" -R "$repository" >/dev/null 2>&1 || gh api "repos/$repository/git/ref/tags/$tag" >/dev/null 2>&1; then
	fail "$tag already exists on $repository; bump apps/desktop/package.json"
fi
feed_name=$(updates_js "console.log(u.feedAssetName('$arch'))")
work="${OPALINE_RELEASE_WORK:-$HOME/.cache/opaline-desktop/release}/$version"
rm -rf "$work"
mkdir -p "$work/current"
if gh release download "$feed_tag" -R "$repository" -p "$feed_name" -D "$work/current" >/dev/null 2>&1; then
	published=$(bun -e "console.log(require('$here/updates.js').parseFeed(require('$work/current/$feed_name')).version)")
	[ "$(updates_js "console.log(u.compareVersions('$version', '$published'))")" = 1 ] ||
		fail "the feed already offers $published; $version must be higher"
	step "the feed offers $published now"
else
	step "no feed published yet on $feed_tag"
fi
rm -rf "$work/current"

zip_name=$(updates_js "console.log(u.updateZipName('$version', '$arch'))")
step "update zip: $zip_name"
ditto -c -k --sequesterRsrc --keepParent "$app" "$work/$zip_name"
mkdir -p "$work/check"
ditto -x -k "$work/$zip_name" "$work/check"
codesign --verify --deep --strict "$work/check/Opaline.app" || fail "the app inside $zip_name does not pass codesign"
rm -rf "$work/check"
cp -c "$dmg" "$work/Opaline-$version.dmg" 2>/dev/null || cp "$dmg" "$work/Opaline-$version.dmg"

zip_url="https://github.com/$repository/releases/download/$tag/$zip_name"
OPALINE_FEED_VERSION="$version" OPALINE_FEED_URL="$zip_url" OPALINE_FEED_NOTES="$notes" \
	bun -e "const u = require('$here/updates.js'); const e = process.env; const feed = u.buildFeed({ version: e.OPALINE_FEED_VERSION, url: e.OPALINE_FEED_URL, notes: e.OPALINE_FEED_NOTES }); u.parseFeed(feed); console.log(JSON.stringify(feed, null, 2));" \
	>"$work/$feed_name"
step "feed $feed_name -> $zip_url"

if [ -n "$notes_file" ]; then
	set -- --notes-file "$notes_file"
else
	set -- --notes "${notes:-Opaline $version for macOS ($arch).}"
fi

if [ "$dry_run" = 1 ]; then
	step "dry run: would create $tag at $commit with:"
	ls -l "$work" | sed 1d
	step "dry run: then replace $feed_name on $feed_tag. Nothing was published."
	exit 0
fi

step "creating release $tag"
gh release create "$tag" -R "$repository" --target "$commit" --title "Opaline $version" --latest "$@" \
	"$work/Opaline-$version.dmg" "$work/$zip_name" "$work/$feed_name"
if gh release view "$feed_tag" -R "$repository" >/dev/null 2>&1; then
	step "replacing $feed_name on $feed_tag"
	gh release upload "$feed_tag" -R "$repository" --clobber "$work/$feed_name"
else
	step "creating $feed_tag"
	gh release create "$feed_tag" -R "$repository" --target "$commit" --latest=false \
		--title "Opaline desktop update feed" \
		--notes "Installed Opaline apps read their update feed from this release. The apps themselves are in the desktop-v* releases." \
		"$work/$feed_name"
fi
mkdir -p "$work/verify"
gh release download "$feed_tag" -R "$repository" -p "$feed_name" -D "$work/verify"
cmp -s "$work/verify/$feed_name" "$work/$feed_name" || fail "the feed on $feed_tag differs from $work/$feed_name"
rm -rf "$work"
step "published $tag; installed apps offer $version on their next check"
