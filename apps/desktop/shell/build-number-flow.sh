#!/bin/sh
set -e
cd "$(dirname "$0")"
REPO="${REPO:-$(cd ../../.. && pwd)}"
printf 'import NumberFlow, { define } from "number-flow";\ndefine("number-flow", NumberFlow);\n' > number-flow-entry.js
NODE_PATH="${NUMBER_FLOW_MODULES:-$REPO/node_modules:$REPO/apps/desktop/ui/node_modules}" bun build number-flow-entry.js --target browser --conditions browser --minify --format iife --outfile onboarding-window/vendor/number-flow.js
rm number-flow-entry.js
