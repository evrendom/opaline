#!/bin/sh
set -e
cd "$(dirname "$0")"
ATHENA="${ATHENA:-$(cd ../.. && pwd)}"
printf '{"compilerOptions":{"jsx":"react-jsx","baseUrl":"%s","paths":{"@/*":["%s/*"]}}}\n' "$ATHENA/apps/web" "$ATHENA/apps/web/src" > dots/tsconfig.json
sed -e 's#from "\./cost-dot-calendar"#from LOCAL_CALENDAR#' -e 's#from "\./#from "@/features/costs/#' -e 's#import "\./cost-dot-chart.css"#import "@/features/costs/cost-dot-chart.css"#' -e 's#LOCAL_CALENDAR#"./calendar"#' \
	"$ATHENA/apps/web/src/features/costs/cost-dot-chart.tsx" > dots/chart.tsx
NODE_PATH="$ATHENA/apps/web/node_modules" bun build dots/dots.tsx \
	--tsconfig-override dots/tsconfig.json \
	--define 'process.env.NODE_ENV="production"' \
	--minify --outdir onboarding-window/dots --entry-naming '[name].[ext]' --asset-naming '[name].[ext]'
rm dots/tsconfig.json dots/chart.tsx
{
	cat "$ATHENA/apps/web/src/features/costs/cost-dot-chart.css"
	sed -e '/^@reference/d' -e 's/@apply corner-squircle;/corner-shape: squircle;/' "$ATHENA/apps/web/src/app/ui/bones.css"
} > onboarding-window/dots/dots.css
