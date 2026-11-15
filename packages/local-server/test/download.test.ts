import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	expect,
	test,
} from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type DownloadProgress,
	ensureVerifiedDownload,
	matchesIntegrity,
} from "../src/download.js";
import type { PinnedAsset } from "../src/pinned-runtimes.js";

const payload = randomBytes(256 * 1024);
const integrity = `sha256-${createHash("sha256").update(payload).digest("base64")}`;
const requests: Array<{ path: string; range: string | null }> = [];
let mode: "normal" | "ignore-range" | "short" | "tampered" | "stall" = "normal";
let server: ReturnType<typeof Bun.serve>;
let cacheDir: string;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const range = request.headers.get("range");
			requests.push({ path: url.pathname, range });
			if (url.pathname === "/missing")
				return new Response("no", { status: 404 });
			if (mode === "short") return new Response(payload.subarray(0, 1000));
			if (mode === "tampered") {
				const copy = Buffer.from(payload);
				copy[10] = (copy[10] ?? 0) ^ 0xff;
				return new Response(copy);
			}
			if (mode === "stall")
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(payload.subarray(0, 100));
						},
					}),
				);
			const match = range?.match(/^bytes=(\d+)-$/u);
			if (match && mode === "normal") {
				const start = Number(match[1]);
				if (start >= payload.length) return new Response("", { status: 416 });
				return new Response(payload.subarray(start), {
					status: 206,
					headers: {
						"content-range": `bytes ${start}-${payload.length - 1}/${payload.length}`,
					},
				});
			}
			return new Response(payload);
		},
	});
});

afterAll(() => server.stop(true));

beforeEach(() => {
	cacheDir = mkdtempSync(join(tmpdir(), "opaline-download-"));
	requests.length = 0;
	mode = "normal";
});

afterEach(() => rmSync(cacheDir, { recursive: true, force: true }));

function asset(path = "/runtime.bin"): PinnedAsset {
	return {
		id: "runtime-1.0.0.bin",
		url: `http://127.0.0.1:${server.port}${path}`,
		size: payload.length,
		integrity,
		format: "binary",
		entry: "runtime",
	};
}

test("downloads, verifies and renames into the cache atomically", async () => {
	const progress: DownloadProgress[] = [];
	const path = await ensureVerifiedDownload(asset(), {
		cacheDir,
		label: "Runtime",
		onProgress: (update) => progress.push(update),
	});
	expect(path).toBe(join(cacheDir, "runtime-1.0.0.bin"));
	expect(readFileSync(path).equals(payload)).toBe(true);
	expect(readdirSync(cacheDir)).toEqual(["runtime-1.0.0.bin"]);
	expect(progress.at(-1)).toEqual({
		received: payload.length,
		total: payload.length,
		resumedFrom: 0,
	});
});

test("reuses a verified cached file without a request", async () => {
	await ensureVerifiedDownload(asset(), { cacheDir, label: "Runtime" });
	requests.length = 0;
	await ensureVerifiedDownload(asset(), { cacheDir, label: "Runtime" });
	expect(requests).toEqual([]);
});

test("replaces a corrupt cached file", async () => {
	writeFileSync(
		join(cacheDir, "runtime-1.0.0.bin"),
		Buffer.alloc(payload.length),
	);
	const path = await ensureVerifiedDownload(asset(), {
		cacheDir,
		label: "Runtime",
	});
	expect(readFileSync(path).equals(payload)).toBe(true);
	expect(requests).toHaveLength(1);
});

test("resumes a partial download with a range request", async () => {
	writeFileSync(
		join(cacheDir, "runtime-1.0.0.bin.partial"),
		payload.subarray(0, 100_000),
	);
	const progress: DownloadProgress[] = [];
	const path = await ensureVerifiedDownload(asset(), {
		cacheDir,
		label: "Runtime",
		onProgress: (update) => progress.push(update),
	});
	expect(requests).toEqual([{ path: "/runtime.bin", range: "bytes=100000-" }]);
	expect(progress[0]?.resumedFrom).toBe(100_000);
	expect(readFileSync(path).equals(payload)).toBe(true);
});

test("starts over when the server ignores the range", async () => {
	mode = "ignore-range";
	writeFileSync(
		join(cacheDir, "runtime-1.0.0.bin.partial"),
		payload.subarray(0, 100_000),
	);
	const path = await ensureVerifiedDownload(asset(), {
		cacheDir,
		label: "Runtime",
	});
	expect(readFileSync(path).equals(payload)).toBe(true);
});

test("rejects a download of the wrong size and leaves nothing behind", async () => {
	mode = "short";
	await expect(
		ensureVerifiedDownload(asset(), { cacheDir, label: "Runtime" }),
	).rejects.toThrow(
		`Runtime download is 1000 bytes, expected ${payload.length}`,
	);
	expect(readdirSync(cacheDir)).toEqual([]);
});

test("rejects a download that does not match the checksum", async () => {
	mode = "tampered";
	await expect(
		ensureVerifiedDownload(asset(), { cacheDir, label: "Runtime" }),
	).rejects.toThrow("does not match its published checksum (sha256)");
	expect(readdirSync(cacheDir)).toEqual([]);
});

test("reports HTTP failures and stalls", async () => {
	await expect(
		ensureVerifiedDownload(asset("/missing"), { cacheDir, label: "Runtime" }),
	).rejects.toThrow("HTTP 404");
	mode = "stall";
	await expect(
		ensureVerifiedDownload(asset(), {
			cacheDir,
			label: "Runtime",
			idleTimeoutMs: 300,
		}),
	).rejects.toThrow("stalled");
	expect(existsSync(join(cacheDir, "runtime-1.0.0.bin.partial"))).toBe(true);
	expect(existsSync(join(cacheDir, "runtime-1.0.0.bin"))).toBe(false);
});

test("checks sha512 integrity the way npm publishes it", async () => {
	const file = join(cacheDir, "blob");
	writeFileSync(file, payload);
	const sha512 = `sha512-${createHash("sha512").update(payload).digest("base64")}`;
	expect(await matchesIntegrity(file, sha512)).toBe(true);
	expect(await matchesIntegrity(file, `sha512-${"A".repeat(86)}==`)).toBe(
		false,
	);
	await expect(matchesIntegrity(file, "md5-abc")).rejects.toThrow(
		"Unsupported checksum algorithm md5",
	);
});
