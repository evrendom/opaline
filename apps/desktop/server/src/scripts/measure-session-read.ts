// Reads one transcript the way the local import does and reports its peak
// memory, what stays held after a full garbage collection, and the time. Run
// it a few times: single peaks vary with when the collector runs. See
// docs/desktop-performance.md.
//
//   bun src/scripts/measure-session-read.ts <transcript .jsonl or .jsonl.zst> [claude_code|codex]
import { rmSync } from "node:fs";
import { buildLocalSessionInput } from "../selfhost/local-ingest/session-input.js";

const [sessionPath, sourceArg] = process.argv.slice(2);
if (!sessionPath) {
	console.error(
		"usage: measure-session-read.ts <transcript> [claude_code|codex]",
	);
	process.exit(2);
}
const source =
	sourceArg === "claude_code" || sourceArg === "codex"
		? sourceArg
		: sessionPath.includes("/.codex/")
			? "codex"
			: "claude_code";
process.env.OPALINE_SELF_HOSTED ??= "1";
const mb = (bytes: number) => Math.round(bytes / 1048576);
let peak = 0;
const sampler = setInterval(() => {
	peak = Math.max(peak, process.memoryUsage().rss);
}, 20);
const started = performance.now();
const prepared = await buildLocalSessionInput({
	sessionPath,
	source,
	change: null,
	organizationId: "measure",
	now: Date.now(),
});
const seconds = (performance.now() - started) / 1000;
clearInterval(sampler);
peak = Math.max(peak, process.memoryUsage().rss);
Bun.gc(true);
const { heapStats } = await import("bun:jsc");
const heap = heapStats();
console.log(
	JSON.stringify({
		kind: prepared.kind,
		seconds: Math.round(seconds * 10) / 10,
		textMB: prepared.kind === "ready" ? mb(prepared.input.content.length) : 0,
		images: prepared.kind === "ready" ? prepared.images.length : 0,
		peakMB: mb(peak),
		heldAfterGcMB: mb(heap.heapSize + heap.extraMemorySize),
	}),
);
if (prepared.kind === "ready" && prepared.imageDirectory)
	rmSync(prepared.imageDirectory, { recursive: true, force: true });
