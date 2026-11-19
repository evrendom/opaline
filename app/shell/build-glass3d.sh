#!/bin/sh
set -e
cd "$(dirname "$0")"
bun build glass3d/entry.js --minify --format iife --outfile onboarding-window/vendor/glass3d.js
