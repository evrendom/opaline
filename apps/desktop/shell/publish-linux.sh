#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)

usage() {
	cat <<'USAGE'
usage: apps/desktop/shell/publish-linux.sh [--dry-run] [--run RUN_ID]

Adds the Linux AppImage and .deb that the Desktop Linux workflow built to the
desktop-v<version> release (publish.sh creates it from the Mac build first), and
points installed Linux apps and the download links at them.

The workflow run must have built the commit the release was made from; by
default the newest successful run for that commit is used.

Installed Linux apps read
  https://github.com/<repository>/releases/download/desktop-latest/desktop-update-linux-x64.json
and offer the release page when it names a newer version. desktop-latest also
gets Opaline-Linux-x86_64.AppImage and Opaline-Linux-amd64.deb (the download links).
USAGE
}

dry_run=0
run=""
while [ $# -gt 0 ]; do
	case "$1" in
	--dry-run) dry_run=1 ;;
	--run)
		run="$2"
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
	echo "publish-linux: $*" >&2
	exit 1
}
step() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*"; }
updates_js() { bun -e "const u = require('$here/updates.js'); $1"; }

repository="${OPALINE_RELEASE_REPO:-$(updates_js 'console.log(u.REPOSITORY)')}"
feed_tag=$(updates_js 'console.log(u.FEED_TAG)')
version=$(sed -n 's/^[[:space:]]*"version": "\(.*\)",$/\1/p' "$here/package.json" | head -n 1)
tag=$(updates_js "console.log(u.releaseTag('$version'))")
feed_name=$(updates_js "console.log(u.feedAssetName('x64', 'linux'))")
appimage="Opaline-$version-linux-x86_64.AppImage"
deb="opaline_${version}_amd64.deb"

gh auth status >/dev/null 2>&1 || fail "gh is not signed in"
step "version $version ($tag) on $repository"
gh release view "$tag" -R "$repository" >/dev/null 2>&1 || fail "no release $tag yet; publish the Mac build with publish.sh first"
gh release view "$tag" -R "$repository" --json assets --jq '.assets[].name' | grep -qx "$feed_name" &&
	fail "$tag already has $feed_name"
commit=$(gh api "repos/$repository/commits/$tag" --jq .sha) || fail "cannot resolve $tag"
[ "$(git -C "$repo" show "$commit:apps/desktop/shell/package.json" 2>/dev/null | sed -n 's/^[[:space:]]*"version": "\(.*\)",$/\1/p' | head -n 1)" = "$version" ] ||
	fail "$tag ($commit) has another apps/desktop/shell/package.json version than $version"

if [ -z "$run" ]; then
	run=$(gh run list -R "$repository" --workflow desktop-linux.yml --commit "$commit" --status success --limit 1 --json databaseId --jq '.[0].databaseId // empty')
	[ -n "$run" ] || fail "no successful Desktop Linux run for $commit; run: gh workflow run desktop-linux.yml -R $repository --ref main"
fi
[ "$(gh run view "$run" -R "$repository" --json headSha --jq .headSha)" = "$commit" ] || fail "run $run did not build $commit"
step "packages from run $run"

work="${OPALINE_RELEASE_WORK:-$HOME/.cache/opaline-desktop/release}/linux-$version"
rm -rf "$work"
mkdir -p "$work"
gh run download "$run" -R "$repository" -n opaline-linux-x64 -D "$work"
[ -f "$work/$appimage" ] || fail "run $run has no $appimage"
[ -f "$work/$deb" ] || fail "run $run has no $deb"

if gh release download "$feed_tag" -R "$repository" -p "$feed_name" -D "$work/current" >/dev/null 2>&1; then
	published=$(bun -e "console.log(require('$here/updates.js').parseFeed(require('$work/current/$feed_name')).version)")
	[ "$(updates_js "console.log(u.compareVersions('$version', '$published'))")" = 1 ] ||
		fail "the Linux feed already offers $published; $version must be higher"
fi
rm -rf "$work/current"

url="https://github.com/$repository/releases/download/$tag/$appimage"
OPALINE_FEED_VERSION="$version" OPALINE_FEED_URL="$url" \
	bun -e "const u = require('$here/updates.js'); const e = process.env; const feed = u.buildFeed({ version: e.OPALINE_FEED_VERSION, url: e.OPALINE_FEED_URL }); u.parseFeed(feed); console.log(JSON.stringify(feed, null, 2));" \
	>"$work/$feed_name"
cp "$work/$appimage" "$work/Opaline-Linux-x86_64.AppImage"
cp "$work/$deb" "$work/Opaline-Linux-amd64.deb"

if [ "$dry_run" = 1 ]; then
	step "dry run: would add to $tag:"
	ls -l "$work/$appimage" "$work/$deb" "$work/$feed_name"
	step "dry run: then replace $feed_name and the Linux downloads on $feed_tag. Nothing was published."
	exit 0
fi

step "adding Linux to $tag"
gh release upload "$tag" -R "$repository" "$work/$appimage" "$work/$deb" "$work/$feed_name"
step "replacing $feed_name and the Linux downloads on $feed_tag"
gh release upload "$feed_tag" -R "$repository" --clobber "$work/$feed_name" "$work/Opaline-Linux-x86_64.AppImage" "$work/Opaline-Linux-amd64.deb"
rm -rf "$work"
step "published Linux $version; installed Linux apps offer it on their next check"
