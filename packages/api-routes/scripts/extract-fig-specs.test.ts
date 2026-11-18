import { expect, test } from "bun:test";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "extract-fig-specs.ts");

function run(...args: string[]) {
	const result = Bun.spawnSync([process.execPath, SCRIPT, ...args], {
		stderr: "pipe",
		stdout: "pipe",
	});
	return { code: result.exitCode, stderr: result.stderr.toString() };
}

test("with no path it prints how to run it, and fails", () => {
	const { code, stderr } = run();
	expect(code).toBe(1);
	expect(stderr).toContain(
		"Usage: bun scripts/extract-fig-specs.ts <path to @withfig/autocomplete>",
	);
});

test("with a path that isn't the package it asks for one, and fails", () => {
	const { code, stderr } = run(import.meta.dir);
	expect(code).toBe(1);
	expect(stderr).toContain(
		"Pass the path of an installed @withfig/autocomplete.",
	);
});
