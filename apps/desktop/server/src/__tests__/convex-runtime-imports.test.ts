import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Vercel's function file tracer does not package the `convex` npm package:
// a runtime import of it from the API crashes every function at boot. The
// API calls Convex over HTTP instead (services/analysis-log/convex-http.ts).

const SOURCE_ROOT = join(import.meta.dir, "..");
const transpiler = new Bun.Transpiler({ loader: "ts" });

test("no API source file loads the convex package at runtime", () => {
	const files = sourceFiles(SOURCE_ROOT);
	expect(files).toContain(
		join(SOURCE_ROOT, "services/analysis-log/convex-store.ts"),
	);
	const offenders = files.flatMap((file) =>
		convexRuntimeImports(readFileSync(file, "utf8")).map(
			(path) => `${relative(SOURCE_ROOT, file)} imports ${path}`,
		),
	);
	expect(offenders).toEqual([]);
});

test("the scan finds runtime convex imports and ignores erased type imports", () => {
	expect(
		convexRuntimeImports(`
			import { ConvexHttpClient } from "convex/browser";
			import "convex/values";
			export { anyApi } from "convex/server";
			const lazy = await import("convex");
			const legacy = require("convex/values");
			import type { FunctionReference } from "convex/server";
			import { type GenericId } from "convex/values";
			export type { Value } from "convex/values";
			import { convexStore } from "./convex-store.js";
			import { z } from "convex-helpers";
		`),
	).toEqual([
		"convex/browser",
		"convex/values",
		"convex/server",
		"convex",
		"convex/values",
	]);
});

/** Module paths in the `convex` package that `source` loads once Bun strips its types. */
function convexRuntimeImports(source: string): string[] {
	return transpiler
		.scanImports(source)
		.map((entry) => entry.path)
		.filter((path) => path === "convex" || path.startsWith("convex/"));
}

/** Every non-test source file under `directory`. */
function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory())
			return entry.name === "__tests__" ? [] : sourceFiles(path);
		return /\.(?:[cm]?[jt]sx?)$/.test(entry.name) &&
			!/\.(?:test|integration)\.[cm]?[jt]sx?$/.test(entry.name)
			? [path]
			: [];
	});
}
