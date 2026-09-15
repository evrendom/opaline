import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// Exercise the complete derivation in V8 (the production runtime), with an
// enforced heap ceiling. Small parser fixtures do not expose this failure.
test("large member and model messages open within a bounded Node heap", async () => {
	const directory = await mkdtemp(join(tmpdir(), "opaline-detail-memory-"));
	try {
		const build = await Bun.build({
			entrypoints: [
				new URL("./fixtures/session-detail-memory.fixture.ts", import.meta.url)
					.pathname,
			],
			target: "node",
			outdir: directory,
		});
		expect(build.success).toBe(true);
		const artifact = build.outputs[0];
		expect(artifact).toBeDefined();
		for (const [megabytes, turns, role] of [
			["30", "1", "user"],
			["30", "1", "assistant"],
			["60", "150", "user"],
			["30", "1", "codex"],
		]) {
			const child = Bun.spawn(
				[
					"node",
					"--max-old-space-size=512",
					artifact?.path ?? "",
					megabytes ?? "",
					turns ?? "",
					role ?? "",
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const [stdout, stderr, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			expect(code, stderr.slice(0, 2000)).toBe(0);
			const result = z
				.object({
					turns: z.number(),
					rawBytes: z.number(),
					responseBytes: z.number(),
				})
				.parse(JSON.parse(stdout));
			expect(result.turns).toBe(Number(turns));
			expect(result.rawBytes).toBeGreaterThanOrEqual(
				Number(megabytes) * 1024 * 1024,
			);
			expect(result.responseBytes).toBeLessThan(1_500_000);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 30_000);
