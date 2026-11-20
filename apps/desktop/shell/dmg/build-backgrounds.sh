#!/bin/zsh
set -e
here=$(cd "$(dirname "$0")" && pwd)
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
t=$(mktemp -d)
python3 -I - "$here/background.html" "$here/../glass3d/entry.js" "$here/../onboarding/fonts/InterVariable.woff2" "$t/page.html" <<'PY'
import json, re, sys
template, entry, font, out = sys.argv[1:]
fragment = re.search(r"const BACKDROP_FRAGMENT = `(.*?)`;", open(entry).read(), re.S).group(1)
page = open(template).read().replace("__FRAGMENT__", json.dumps(fragment)).replace("__FONT__", "file://" + font)
open(out, "w").write(page)
PY
for scale in 1 2; do
	name=background; [ $scale = 2 ] && name=$name@2x
	"$chrome" --headless=new --hide-scrollbars --default-background-color=00000000 --enable-unsafe-swiftshader --use-angle=swiftshader --force-device-scale-factor=$scale --window-size=660,400 --virtual-time-budget=5000 --screenshot="$t/$name.png" "file://$t/page.html" 2>/dev/null
done
tiffutil -cathidpicheck "$t/background.png" "$t/background@2x.png" -out "$here/background.tiff" >/dev/null 2>&1
rm -rf "$t"
