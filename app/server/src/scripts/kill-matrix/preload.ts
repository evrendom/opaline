import { appendFileSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { escapeRegExp } from "./escape-regexp.js";

/**
 * `bun test --preload` hook of the kill matrix. It watches the modules under
 * test (`KILL_MATRIX_MODULES`, real paths, one per line) and notes each load
 * in `KILL_MATRIX_LOADED`, so the runner knows which tests import which
 * module. When `KILL_MATRIX_TARGET` is imported, Bun loads the mutant in
 * `KILL_MATRIX_SOURCE` in its place. Modules on disk are never written, so no
 * run, crash or interrupt can leave a mutant behind.
 */

const modules = (process.env.KILL_MATRIX_MODULES ?? "")
	.split("\n")
	.filter(Boolean);
const target = process.env.KILL_MATRIX_TARGET;
const source = process.env.KILL_MATRIX_SOURCE;
const loaded = process.env.KILL_MATRIX_LOADED;
if (modules.length === 0 || !loaded || (target && !source))
	throw new Error(
		"kill-matrix preload needs KILL_MATRIX_MODULES and KILL_MATRIX_LOADED, and KILL_MATRIX_SOURCE with KILL_MATRIX_TARGET",
	);

const LOADERS: Readonly<Record<string, "js" | "jsx" | "ts" | "tsx">> = {
	".js": "js",
	".mjs": "js",
	".cjs": "js",
	".jsx": "jsx",
	".tsx": "tsx",
};

Bun.plugin({
	name: "kill-matrix",
	setup(build) {
		build.onLoad(
			{ filter: new RegExp(`^(?:${modules.map(escapeRegExp).join("|")})$`) },
			({ path }) => {
				appendFileSync(loaded, `${path}\n`);
				return {
					contents: readFileSync(
						path === target && source ? source : path,
						"utf8",
					),
					loader: LOADERS[extname(path)] ?? "ts",
				};
			},
		);
	},
});
