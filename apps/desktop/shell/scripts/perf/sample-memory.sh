#!/bin/zsh
# Samples the resident memory of every Opaline process every 3 s, grouped by role,
# and prints each role's peak at the end. See docs/desktop-performance.md.
#
#   scripts/perf/sample-memory.sh <seconds> [out file]
#
# Matches processes of any Opaline.app bundle and of its server data folder.
set -eu
seconds=${1:?seconds}
out=${2:-/dev/stdout}
[ "$out" = /dev/stdout ] || : > "$out"
end=$((SECONDS + seconds))
while (( SECONDS < end )); do
	ps -axo rss=,command= | awk -v t=$SECONDS '
		/Opaline\.app|Application Support\/Opaline|opaline-server/ && !/awk|sample-memory/ {
			role = "other"
			if ($0 ~ /clickhouse/) role = ($0 ~ / local /) ? "analysis" : "clickhouse"
			else if ($0 ~ /postgres/) role = "postgres"
			else if ($0 ~ /bun/) role = "server"
			else if ($0 ~ /Helper \(Renderer\)/) role = "renderer"
			else if ($0 ~ /Helper/) role = "helper"
			else if ($0 ~ /MacOS\/Opaline/) role = "main"
			mb[role] += $1 / 1024; total += $1 / 1024
		}
		END { printf "%d total=%d", t, total; for (r in mb) printf " %s=%d", r, mb[r]; print "" }' >> "$out"
	sleep 3
done
if [ "$out" != /dev/stdout ]; then
	awk '{ for (i = 2; i <= NF; i++) { split($i, a, "="); if (a[2] > peak[a[1]]) peak[a[1]] = a[2] } }
		END { printf "peak MB:"; for (k in peak) printf " %s=%d", k, peak[k]; print "" }' "$out"
fi
