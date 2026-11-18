import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
import {
	CLICKHOUSE_MEMORY,
	clickHouseMemoryBytes,
	defaultClickHouseMemoryBytes,
	formatGiB,
	parseClickHouseMemoryGiB,
	readConfiguredClickHouseMemoryBytes,
	writeClickHouseConfig,
} from "../src/clickhouse-config.js";
import { BUN_VERSION } from "../src/pinned-runtimes.js";
import { type RuntimeContext, resolveBun } from "../src/runtimes.js";
import {
	compareServerVersions,
	INSTALL_MARKER_FILE,
	prepareServerArtifact,
	pruneServerInstalls,
	type ServerArtifactContext,
} from "../src/server-artifact.js";
import {
	prepareServerDistribution,
	type ServerDistribution,
} from "../src/server-distribution.js";
import {
	describeDowngrade,
	describeServerVersion,
	getServerEnvironment,
	needsServerSwitch,
	planServerState,
	type ServerStartFlags,
	serverRecord,
} from "../src/server-runner.js";
import type { ServerState } from "../src/server-state.js";
import { extractTarGz } from "../src/tar-extract.js";

const GIB = 1024 * 1024 * 1024;
const PACKAGE = "@opalinehq/server";

interface TarEntry {
	readonly name: string;
	readonly body?: string;
	readonly type?: string;
	readonly linkname?: string;
	readonly mode?: number;
	readonly prefix?: string;
	readonly pax?: Record<string, string>;
}

let root: string;
let artifacts: string;
let dataDir: string;
let logs: string[];

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "opaline-artifact-"));
	artifacts = join(root, "artifacts");
	dataDir = join(root, "data");
	mkdirSync(artifacts, { recursive: true });
	logs = [];
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function header(entry: TarEntry, size: number, type: string): Buffer {
	const block = Buffer.alloc(512);
	block.write(entry.name, 0, 100, "utf8");
	block.write(`${(entry.mode ?? 0o644).toString(8).padStart(7, "0")}\0`, 100);
	block.write("0000000\0", 108);
	block.write("0000000\0", 116);
	block.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
	block.write("00000000000\0", 136);
	block.write("        ", 148);
	block.write(type, 156);
	block.write(entry.linkname ?? "", 157, 100, "utf8");
	block.write("ustar\0", 257);
	block.write("00", 263);
	block.write(entry.prefix ?? "", 345, 155, "utf8");
	let sum = 0;
	for (const byte of block) sum += byte;
	block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
	return block;
}

function padded(body: Buffer): Buffer[] {
	const rest = (512 - (body.length % 512)) % 512;
	return [body, Buffer.alloc(rest)];
}

function paxRecord(key: string, value: string): string {
	const tail = ` ${key}=${value}\n`;
	let length = tail.length + 1;
	while (String(length).length + tail.length !== length)
		length = String(length).length + tail.length;
	return `${length}${tail}`;
}

function tarGz(entries: readonly TarEntry[]): Buffer {
	const parts: Buffer[] = [];
	for (const entry of entries) {
		if (entry.pax) {
			const body = Buffer.from(
				Object.entries(entry.pax)
					.map(([key, value]) => paxRecord(key, value))
					.join(""),
			);
			parts.push(
				header({ name: "PaxHeader" }, body.length, "x"),
				...padded(body),
			);
		}
		const body = Buffer.from(entry.body ?? "");
		parts.push(header(entry, body.length, entry.type ?? "0"), ...padded(body));
	}
	parts.push(Buffer.alloc(1024));
	return gzipSync(Buffer.concat(parts));
}

function serverEntries(
	version: string,
	manifest: Record<string, unknown> = {},
): TarEntry[] {
	return [
		{
			name: "package/package.json",
			body: JSON.stringify({ name: PACKAGE, version }),
		},
		{
			name: "package/opaline-server.json",
			body: JSON.stringify({
				name: PACKAGE,
				version,
				entry: "server/main.js",
				webDir: "web/dist",
				minimumBun: "1.3.8",
				builtAt: "2026-11-08T00:00:00.000Z",
				commit: "abc123",
				...manifest,
			}),
		},
		{ name: "package/server/main.js", body: `console.log("${version}");` },
		{ name: "package/server/x.worker.js", body: "postMessage(1);" },
		{ name: "package/web/dist/index.html", body: "<!doctype html>" },
	];
}

function writeArtifact(
	version: string,
	entries: readonly TarEntry[] = serverEntries(version),
	options: { manifest?: boolean; directory?: string } = {},
) {
	const directory = options.directory ?? artifacts;
	mkdirSync(directory, { recursive: true });
	const bytes = tarGz(entries);
	const tgz = join(directory, `opaline-server-${version}.tgz`);
	writeFileSync(tgz, bytes);
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
	const json = join(directory, `opaline-server-${version}.json`);
	if (options.manifest !== false)
		writeFileSync(
			json,
			JSON.stringify({
				name: PACKAGE,
				version,
				file: basename(tgz),
				size: bytes.length,
				sha256,
				integrity,
				minimumBun: "1.3.8",
				builtAt: "2026-11-08T00:00:00.000Z",
				commit: "abc123",
			}),
		);
	return { tgz, json, sha256, integrity, bytes };
}

function artifactContext(
	env: NodeJS.ProcessEnv,
	overrides: Partial<ServerArtifactContext> = {},
): ServerArtifactContext {
	return {
		dataDir,
		env,
		cliVersion: "1.2.3",
		log: (line) => logs.push(line),
		...overrides,
	};
}

function serverRoot(): string {
	return join(dataDir, "server");
}

function leftovers(): string[] {
	if (!existsSync(serverRoot())) return [];
	return readdirSync(serverRoot()).filter(
		(name) => name.startsWith(".staging-") || name.startsWith(".replaced-"),
	);
}

describe("tar extraction", () => {
	test("unpacks regular files under package/, long pax and ustar prefix names", async () => {
		const long = `${"d".repeat(120)}/file.txt`;
		const archive = join(root, "a.tgz");
		writeFileSync(
			archive,
			tarGz([
				{ name: "package/", type: "5" },
				{ name: "package/a.txt", body: "a" },
				{ name: "ignored", body: "pax", pax: { path: `package/${long}` } },
				{ name: "b.txt", prefix: "package/nested", body: "b" },
				{ name: "package/run.sh", body: "#!/bin/sh", mode: 0o755 },
			]),
		);
		const result = await extractTarGz(archive, {
			prefix: "package",
			destination: join(root, "out"),
		});
		expect(result.files).toBe(4);
		expect(readFileSync(join(root, "out", "a.txt"), "utf8")).toBe("a");
		expect(readFileSync(join(root, "out", long), "utf8")).toBe("pax");
		expect(readFileSync(join(root, "out", "nested", "b.txt"), "utf8")).toBe(
			"b",
		);
	});

	for (const [label, entry, message] of [
		[
			"a parent-directory escape",
			{ name: "package/../evil.js", body: "x" },
			"Refusing archive path",
		],
		[
			"an absolute path",
			{ name: "/etc/evil", body: "x" },
			"Refusing archive path",
		],
		[
			"a path outside package/",
			{ name: "other/file.js", body: "x" },
			"everything must be under package/",
		],
		[
			"a symlink",
			{ name: "package/link", type: "2", linkname: "/etc/passwd" },
			"the symlink",
		],
		[
			"a hard link",
			{ name: "package/hard", type: "1", linkname: "package/a.txt" },
			"the hard link",
		],
	] as const)
		test(`refuses ${label}`, async () => {
			const archive = join(root, "bad.tgz");
			writeFileSync(
				archive,
				tarGz([{ name: "package/a.txt", body: "a" }, entry]),
			);
			await expect(
				extractTarGz(archive, {
					prefix: "package",
					destination: join(root, "out"),
				}),
			).rejects.toThrow(message);
			expect(existsSync(join(root, "evil.js"))).toBe(false);
		});

	test("refuses a corrupt or truncated archive", async () => {
		const archive = join(root, "cut.tgz");
		const full = tarGz(serverEntries("1.0.0"));
		writeFileSync(archive, gzipSync(Buffer.from("not a tar file at all")));
		await expect(
			extractTarGz(archive, {
				prefix: "package",
				destination: join(root, "o1"),
			}),
		).rejects.toThrow();
		writeFileSync(archive, full.subarray(0, Math.floor(full.length / 2)));
		await expect(
			extractTarGz(archive, {
				prefix: "package",
				destination: join(root, "o2"),
			}),
		).rejects.toThrow();
	});
});

describe("a server artifact on disk", () => {
	test("installs from the .tgz with its sibling manifest", async () => {
		const { tgz, sha256 } = writeArtifact("1.0.0");
		const prepared = await prepareServerArtifact(
			artifactContext({ OPALINE_SERVER_ARTIFACT: tgz }),
		);
		expect(prepared).toMatchObject({
			version: "1.0.0",
			sha256,
			source: `artifact ${tgz}`,
			installDir: join(serverRoot(), "1.0.0"),
			entry: join(serverRoot(), "1.0.0", "server", "main.js"),
			webDir: join(serverRoot(), "1.0.0", "web", "dist"),
			hasWebBuild: true,
			minimumBun: "1.3.8",
			reused: false,
		});
		expect(existsSync(prepared.installDir)).toBe(false);
		prepared.install();
		prepared.discard();
		expect(readFileSync(prepared.entry, "utf8")).toContain("1.0.0");
		const marker = JSON.parse(
			readFileSync(join(prepared.installDir, INSTALL_MARKER_FILE), "utf8"),
		);
		expect(marker).toMatchObject({ version: "1.0.0", sha256 });
		expect(leftovers()).toEqual([]);
	});

	test("accepts the manifest path itself", async () => {
		const { json } = writeArtifact("1.0.0");
		const prepared = await prepareServerArtifact(
			artifactContext({ OPALINE_SERVER_ARTIFACT: json }),
		);
		expect(prepared.version).toBe("1.0.0");
		prepared.discard();
	});

	test("refuses an artifact without any checksum", async () => {
		const { tgz } = writeArtifact("1.0.0", undefined, { manifest: false });
		await expect(
			prepareServerArtifact(artifactContext({ OPALINE_SERVER_ARTIFACT: tgz })),
		).rejects.toThrow("OPALINE_SERVER_ARTIFACT_SHA256");
	});

	test("takes the checksum from OPALINE_SERVER_ARTIFACT_SHA256", async () => {
		const { tgz, sha256 } = writeArtifact("1.0.0", undefined, {
			manifest: false,
		});
		const prepared = await prepareServerArtifact(
			artifactContext({
				OPALINE_SERVER_ARTIFACT: tgz,
				OPALINE_SERVER_ARTIFACT_SHA256: sha256.toUpperCase(),
			}),
		);
		expect(prepared.sha256).toBe(sha256);
		prepared.discard();
		await expect(
			prepareServerArtifact(
				artifactContext({
					OPALINE_SERVER_ARTIFACT: tgz,
					OPALINE_SERVER_ARTIFACT_SHA256: "0".repeat(64),
				}),
			),
		).rejects.toThrow("does not match its checksum");
	});

	test("refuses a tampered artifact and a manifest that disagrees", async () => {
		const { tgz, bytes, sha256 } = writeArtifact("1.0.0");
		const tampered = Buffer.from(bytes);
		tampered.writeUInt8(
			tampered.readUInt8(tampered.length - 20) ^ 0xff,
			tampered.length - 20,
		);
		writeFileSync(tgz, tampered);
		await expect(
			prepareServerArtifact(artifactContext({ OPALINE_SERVER_ARTIFACT: tgz })),
		).rejects.toThrow(/its manifest says|does not match its checksum/u);
		writeFileSync(tgz, bytes);
		await expect(
			prepareServerArtifact(
				artifactContext({
					OPALINE_SERVER_ARTIFACT: tgz,
					OPALINE_SERVER_ARTIFACT_SHA256: `${sha256.slice(0, 63)}0`,
				}),
			),
		).rejects.toThrow("disagrees with the artifact manifest");
	});

	test("refuses contents that escape, link or lie about the version", async () => {
		for (const [version, entries, message] of [
			[
				"2.0.0",
				[...serverEntries("2.0.0"), { name: "package/../../x.js", body: "x" }],
				"Refusing archive path",
			],
			[
				"2.0.1",
				[
					...serverEntries("2.0.1"),
					{ name: "package/server/l", type: "2", linkname: "/bin/sh" },
				],
				"the symlink",
			],
			[
				"2.0.2",
				serverEntries("2.0.2", { version: "2.0.3" }),
				"does not match opaline-server.json",
			],
			[
				"2.0.4",
				serverEntries("2.0.4", { entry: "../outside.js" }),
				"is not inside the artifact",
			],
			[
				"2.0.5",
				serverEntries("2.0.5", { entry: "server/missing.js" }),
				"has no server/missing.js",
			],
		] as const) {
			const { tgz } = writeArtifact(version, entries);
			await expect(
				prepareServerArtifact(
					artifactContext({ OPALINE_SERVER_ARTIFACT: tgz }),
				),
			).rejects.toThrow(message);
		}
		expect(leftovers()).toEqual([]);
		expect(existsSync(join(root, "x.js"))).toBe(false);
	});

	test("refuses a manifest whose version differs from the package inside", async () => {
		const entries = serverEntries("3.0.0");
		const { tgz, json } = writeArtifact("3.0.0", entries);
		const manifest = JSON.parse(readFileSync(json, "utf8"));
		writeFileSync(json, JSON.stringify({ ...manifest, version: "3.0.1" }));
		await expect(
			prepareServerArtifact(artifactContext({ OPALINE_SERVER_ARTIFACT: tgz })),
		).rejects.toThrow("contains server 3.0.0, expected 3.0.1");
	});

	test("reuses an installed copy of the same artifact", async () => {
		const { tgz } = writeArtifact("1.0.0");
		const first = await prepareServerArtifact(
			artifactContext({ OPALINE_SERVER_ARTIFACT: tgz }),
		);
		first.install();
		const second = await prepareServerArtifact(
			artifactContext({ OPALINE_SERVER_ARTIFACT: tgz }),
		);
		expect(second).toMatchObject({
			reused: true,
			version: "1.0.0",
			installDir: first.installDir,
		});
		expect(leftovers()).toEqual([]);
	});

	test("replaces a rebuilt artifact of the same version atomically", async () => {
		const first = writeArtifact("1.0.0");
		const prepared = await prepareServerArtifact(
			artifactContext({ OPALINE_SERVER_ARTIFACT: first.tgz }),
		);
		prepared.install();
		const rebuilt = writeArtifact(
			"1.0.0",
			serverEntries("1.0.0", { commit: "def456" }),
			{ directory: join(root, "rebuilt") },
		);
		const replacement = await prepareServerArtifact(
			artifactContext({ OPALINE_SERVER_ARTIFACT: rebuilt.tgz }),
		);
		expect(replacement.reused).toBe(false);
		expect(replacement.sha256).not.toBe(first.sha256);
		replacement.install();
		const marker = JSON.parse(
			readFileSync(join(replacement.installDir, INSTALL_MARKER_FILE), "utf8"),
		);
		expect(marker.sha256).toBe(rebuilt.sha256);
		expect(
			JSON.parse(
				readFileSync(
					join(replacement.installDir, "opaline-server.json"),
					"utf8",
				),
			).commit,
		).toBe("def456");
		expect(leftovers()).toEqual([]);
	});

	test("an installed version directory can be selected again", async () => {
		const { tgz } = writeArtifact("1.0.0");
		const prepared = await prepareServerArtifact(
			artifactContext({ OPALINE_SERVER_ARTIFACT: tgz }),
		);
		prepared.install();
		const again = await prepareServerArtifact(
			artifactContext({ OPALINE_SERVER_ARTIFACT: prepared.installDir }),
		);
		expect(again).toMatchObject({
			reused: true,
			version: "1.0.0",
			source: `artifact ${tgz}`,
		});
		await expect(
			prepareServerArtifact(artifactContext({ OPALINE_SERVER_ARTIFACT: root })),
		).rejects.toThrow("is a directory");
	});

	test("a checkout wins over an artifact", async () => {
		const checkout = join(root, "athena");
		mkdirSync(join(checkout, "apps", "api", "src", "selfhost"), {
			recursive: true,
		});
		writeFileSync(
			join(checkout, "apps", "api", "src", "selfhost", "main.ts"),
			"",
		);
		const { tgz } = writeArtifact("1.0.0");
		const distribution = await prepareServerDistribution(
			artifactContext({
				OPALINE_SERVER_DIR: checkout,
				OPALINE_SERVER_ARTIFACT: tgz,
			}),
		);
		expect(distribution).toMatchObject({
			kind: "checkout",
			source: `checkout ${checkout}`,
		});
	});
});

describe("a server artifact over HTTP", () => {
	let server: ReturnType<typeof Bun.serve>;
	let files: Map<string, Buffer | string>;
	let requests: string[];

	beforeAll(() => {
		server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch(request) {
				const path = new URL(request.url).pathname;
				requests.push(path);
				const body = files.get(path);
				return body === undefined
					? new Response("not found", { status: 404 })
					: new Response(
							typeof body === "string" ? body : new Uint8Array(body),
						);
			},
		});
	});

	afterAll(() => server.stop(true));

	beforeEach(() => {
		files = new Map();
		requests = [];
	});

	const base = () => `http://127.0.0.1:${server.port}`;

	test("downloads a URL artifact and verifies it against its manifest", async () => {
		const { bytes, json } = writeArtifact("1.1.0");
		files.set("/dl/opaline-server-1.1.0.tgz", bytes);
		files.set("/dl/opaline-server-1.1.0.json", readFileSync(json, "utf8"));
		const prepared = await prepareServerArtifact(
			artifactContext({
				OPALINE_SERVER_ARTIFACT: `${base()}/dl/opaline-server-1.1.0.tgz`,
			}),
		);
		expect(prepared).toMatchObject({
			version: "1.1.0",
			source: `artifact ${base()}/dl/opaline-server-1.1.0.tgz`,
		});
		prepared.install();
		expect(existsSync(join(serverRoot(), ".downloads"))).toBe(true);
		expect(readdirSync(join(serverRoot(), ".downloads"))).toEqual([]);
	});

	test("refuses a URL artifact without a checksum and plain http off this machine", async () => {
		files.set("/dl/x.tgz", tarGz(serverEntries("1.1.0")));
		await expect(
			prepareServerArtifact(
				artifactContext({ OPALINE_SERVER_ARTIFACT: `${base()}/dl/x.tgz` }),
			),
		).rejects.toThrow("No checksum");
		await expect(
			prepareServerArtifact(
				artifactContext({
					OPALINE_SERVER_ARTIFACT: "http://192.168.2.10/opaline-server.tgz",
				}),
			),
		).rejects.toThrow("must be an https:// URL");
	});

	test("says clearly when the npm package is not published", async () => {
		const error = await prepareServerArtifact(
			artifactContext({ OPALINE_NPM_REGISTRY: base() }),
		).catch((caught: Error) => caught);
		expect(String(error)).toContain(
			"@opalinehq/server@1.2.3 is not published on npm yet",
		);
		expect(String(error)).toContain("OPALINE_SERVER_ARTIFACT");
		expect(String(error)).toContain("OPALINE_SERVER_DIR");
		expect(requests).toEqual(["/@opalinehq%2fserver/1.2.3"]);
	});

	test("keeps the installed server when the CLI's version is not on npm", async () => {
		const { tgz } = writeArtifact("1.0.0");
		const installed = await prepareServerArtifact(
			artifactContext({ OPALINE_SERVER_ARTIFACT: tgz }),
		);
		installed.install();
		const prepared = await prepareServerArtifact(
			artifactContext(
				{ OPALINE_NPM_REGISTRY: base() },
				{ currentInstall: installed.installDir },
			),
		);
		expect(prepared).toMatchObject({
			reused: true,
			version: "1.0.0",
			source: `artifact ${tgz}`,
		});
		expect(logs.join("\n")).toContain(
			"@opalinehq/server@1.2.3 is not published on npm yet; starting the installed Opaline server 1.0.0",
		);
		await expect(
			prepareServerArtifact(
				artifactContext(
					{ OPALINE_NPM_REGISTRY: base() },
					{ currentInstall: join(root, "elsewhere") },
				),
			),
		).rejects.toThrow("is not published on npm yet, so this CLI");
	});

	function publish(version: string, dist: Record<string, unknown> = {}) {
		const bytes = tarGz(serverEntries(version));
		files.set(`/tarballs/server-${version}.tgz`, bytes);
		files.set(
			`/@opalinehq%2fserver/${version}`,
			JSON.stringify({
				name: PACKAGE,
				version,
				dist: {
					tarball: `${base()}/tarballs/server-${version}.tgz`,
					integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
					shasum: createHash("sha1").update(bytes).digest("hex"),
					...dist,
				},
			}),
		);
		return bytes;
	}

	test("installs the npm package at the CLI's version, verified by integrity and shasum", async () => {
		const bytes = publish("1.2.3");
		const prepared = await prepareServerArtifact(
			artifactContext({ OPALINE_NPM_REGISTRY: base() }),
		);
		expect(prepared).toMatchObject({
			version: "1.2.3",
			source: "npm @opalinehq/server@1.2.3",
			sha256: createHash("sha256").update(bytes).digest("hex"),
		});
		prepared.install();
		const reused = await prepareServerArtifact(
			artifactContext({ OPALINE_NPM_REGISTRY: base() }),
		);
		expect(reused.reused).toBe(true);
		expect(
			requests.filter((path) => path.startsWith("/tarballs/")),
		).toHaveLength(1);
		const offline = await prepareServerArtifact(
			artifactContext(
				{ OPALINE_NPM_REGISTRY: base() },
				{
					fetchImpl: (async () => {
						throw new Error("offline");
					}) as unknown as typeof fetch,
				},
			),
		);
		expect(offline).toMatchObject({ reused: true, version: "1.2.3" });
		expect(logs.join("\n")).toContain(
			"(offline); starting the installed Opaline server 1.2.3",
		);
	});

	test("refuses an npm tarball that does not match its integrity or shasum", async () => {
		publish("1.2.3", { integrity: `sha512-${"A".repeat(86)}==` });
		await expect(
			prepareServerArtifact(artifactContext({ OPALINE_NPM_REGISTRY: base() })),
		).rejects.toThrow("does not match its published checksum");
		publish("1.2.3", { shasum: "0".repeat(40) });
		await expect(
			prepareServerArtifact(artifactContext({ OPALINE_NPM_REGISTRY: base() })),
		).rejects.toThrow("does not match its published shasum");
		publish("1.2.3", { integrity: undefined });
		await expect(
			prepareServerArtifact(artifactContext({ OPALINE_NPM_REGISTRY: base() })),
		).rejects.toThrow("no sha512 integrity");
		expect(leftovers()).toEqual([]);
	});
});

describe("keeping versions", () => {
	test("prunes everything but the current and previous version", async () => {
		for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
			const { tgz } = writeArtifact(version);
			(
				await prepareServerArtifact(
					artifactContext({ OPALINE_SERVER_ARTIFACT: tgz }),
				)
			).install();
		}
		mkdirSync(join(serverRoot(), "not-ours"), { recursive: true });
		mkdirSync(join(serverRoot(), ".staging-old"), { recursive: true });
		expect(pruneServerInstalls(dataDir, ["1.2.0", "1.1.0"])).toEqual(["1.0.0"]);
		expect(readdirSync(serverRoot()).sort()).toEqual([
			"1.1.0",
			"1.2.0",
			"not-ours",
		]);
	});

	test("versions compare numerically with pre-releases first", () => {
		expect(compareServerVersions("0.18.0", "0.17.9")).toBeGreaterThan(0);
		expect(compareServerVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
		expect(compareServerVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
		expect(compareServerVersions("1.0.0", "1.0.0")).toBe(0);
	});

	const packaged = (
		version: string,
		overrides: Partial<ServerDistribution> = {},
	): ServerDistribution => ({
		kind: "packaged",
		root: `/data/server/${version}`,
		entry: `/data/server/${version}/server/main.js`,
		webDir: `/data/server/${version}/web/dist`,
		hasWebBuild: true,
		source: `artifact /tmp/opaline-server-${version}.tgz`,
		version,
		sha256: "a".repeat(64),
		...overrides,
	});

	test("the state remembers the previous version across upgrades", () => {
		const first = serverRecord(packaged("1.0.0"), undefined);
		expect(first).not.toHaveProperty("previousVersion");
		const second = serverRecord(packaged("1.1.0"), first);
		expect(second).toMatchObject({
			version: "1.1.0",
			previousVersion: "1.0.0",
		});
		const rebuilt = serverRecord(
			packaged("1.1.0", { sha256: "b".repeat(64) }),
			second,
		);
		expect(rebuilt).toMatchObject({
			version: "1.1.0",
			sha256: "b".repeat(64),
			previousVersion: "1.0.0",
		});
		const back = serverRecord(packaged("1.0.0"), rebuilt);
		expect(back).toMatchObject({ version: "1.0.0", previousVersion: "1.1.0" });
	});

	test("an older version is a downgrade that needs confirmation", () => {
		const state = { server: serverRecord(packaged("1.1.0"), undefined) };
		expect(
			describeDowngrade(state as ServerState, packaged("1.0.0")),
		).toContain("Migrations only go forward");
		expect(
			describeDowngrade(state as ServerState, packaged("1.1.0")),
		).toBeUndefined();
		expect(
			describeDowngrade(state as ServerState, packaged("1.2.0")),
		).toBeUndefined();
	});

	test("a running server is switched when the entry or the build changes", () => {
		const record = {
			pid: 1,
			marker: "/data/server/1.0.0/server/main.js",
			startedAt: "",
		};
		const prior = serverRecord(packaged("1.0.0"), undefined);
		expect(needsServerSwitch(record, prior, packaged("1.0.0"))).toBe(false);
		expect(needsServerSwitch(record, prior, packaged("1.1.0"))).toBe(true);
		expect(
			needsServerSwitch(
				record,
				prior,
				packaged("1.0.0", { sha256: "c".repeat(64) }),
			),
		).toBe(true);
	});

	test("status names the version, where it came from and what runs", () => {
		const record = serverRecord(packaged("1.1.0"), undefined);
		expect(describeServerVersion(record)).toBe(
			"1.1.0 from artifact /tmp/opaline-server-1.1.0.tgz, installed in /data/server/1.1.0",
		);
		expect(describeServerVersion(record, "1.0.0")).toContain(
			"1.1.0 (running 1.0.0)",
		);
		expect(
			describeServerVersion({
				kind: "checkout",
				root: "/srv/athena",
				source: "checkout /srv/athena",
			}),
		).toBe("dev from checkout /srv/athena");
	});

	test("the server gets its version in the environment", () => {
		const environment = getServerEnvironment(
			dataDir,
			stateFixture(),
			packaged("1.1.0"),
		);
		expect(environment).toMatchObject({
			OPALINE_VERSION: "1.1.0",
			OPALINE_WEB_DIR: "/data/server/1.1.0/web/dist",
		});
	});
});

describe("Bun for the server", () => {
	function bunContext(versions: Record<string, string>): RuntimeContext {
		return {
			dataDir,
			env: { PATH: join(root, "path") },
			home: join(root, "home"),
			platform: "darwin-arm64",
			downloadCacheDir: join(root, "cache"),
			sharedDownloadCache: true,
			useSystemRuntimes: true,
			cpuHasAvx2: () => true,
			probe: async (command) => versions[command],
			progress: () => ({ update: () => {}, finish: () => {} }),
			log: (line) => logs.push(line),
			fetchImpl: (async () =>
				new Response("unavailable", {
					status: 503,
				})) as unknown as typeof fetch,
			postgresDirectories: [],
		};
	}

	function systemBun(): string {
		const path = join(root, "path", "bun");
		mkdirSync(join(root, "path"), { recursive: true });
		writeFileSync(path, "#!/bin/sh\n");
		chmodSync(path, 0o755);
		return path;
	}

	test("a system Bun older than the server's minimum is skipped", async () => {
		const path = systemBun();
		await expect(
			resolveBun(bunContext({ [path]: "1.3.1" }), "1.3.8"),
		).rejects.toThrow("HTTP 503");
		expect(logs.join("\n")).toContain(
			`Skipping Bun 1.3.1 at ${path}: need Bun 1.3.8 or newer.`,
		);
		expect(
			await resolveBun(bunContext({ [path]: "1.3.9" }), "1.3.8"),
		).toMatchObject({ source: "system", version: "1.3.9" });
		expect(await resolveBun(bunContext({ [path]: "1.3.1" }))).toMatchObject({
			source: "system",
			version: "1.3.1",
		});
	});

	test("a minimum above the pinned Bun names the way out", async () => {
		await expect(resolveBun(bunContext({}), "99.0.0")).rejects.toThrow(
			`needs Bun 99.0.0 or newer; this CLI downloads Bun ${BUN_VERSION}`,
		);
	});
});

describe("ClickHouse memory", () => {
	test("defaults to a quarter of RAM between 3 and 8 GiB in 256 MiB steps", () => {
		expect(defaultClickHouseMemoryBytes(4 * GIB)).toBe(3 * GIB);
		expect(defaultClickHouseMemoryBytes(16 * GIB)).toBe(4 * GIB);
		expect(defaultClickHouseMemoryBytes(14.5 * GIB)).toBe(3.5 * GIB);
		expect(defaultClickHouseMemoryBytes(64 * GIB)).toBe(8 * GIB);
		expect(CLICKHOUSE_MEMORY.floorBytes).toBe(3 * GIB);
		expect(clickHouseMemoryBytes(undefined, 16 * GIB)).toBe(4 * GIB);
		expect(clickHouseMemoryBytes(2.5, 16 * GIB)).toBe(2.5 * GIB);
	});

	test("--clickhouse-memory takes GiB, auto, and refuses nonsense", () => {
		expect(parseClickHouseMemoryGiB("4", 16 * GIB)).toBe(4);
		expect(parseClickHouseMemoryGiB("2.5", 16 * GIB)).toBe(2.5);
		expect(parseClickHouseMemoryGiB("AUTO", 16 * GIB)).toBe("auto");
		for (const value of ["1.5", "16", "32", "four", "-3", "4GiB", ""])
			expect(String(parseClickHouseMemoryGiB(value, 16 * GIB))).toContain(
				"--clickhouse-memory takes GiB from 2",
			);
		expect(formatGiB(3.5 * GIB)).toBe("3.5");
		expect(formatGiB(4 * GIB)).toBe("4");
	});

	test("the configured limit is read back from the overlay", () => {
		expect(readConfiguredClickHouseMemoryBytes(dataDir)).toBeUndefined();
		writeClickHouseConfig(dataDir, {
			httpPort: 1,
			tcpPort: 2,
			password: "p",
			maxServerMemoryBytes: 5 * GIB,
		});
		expect(readConfiguredClickHouseMemoryBytes(dataDir)).toBe(5 * GIB);
	});

	const flags: ServerStartFlags = {
		noAgentSetup: false,
		noBrowser: true,
		yes: false,
	};
	const planContext = {
		env: {},
		interactive: false,
		confirm: async () => false,
	};

	test("the flag is kept in the state until auto clears it", async () => {
		const first = await planServerState(
			undefined,
			{ ...flags, clickhouseMemory: "2.5" },
			planContext,
		);
		if (first instanceof Error) throw first;
		expect(first.state.clickhouse).toMatchObject({
			mode: "local",
			memoryGiB: 2.5,
		});
		expect(first.changed).toBe(false);
		const later = await planServerState(first.state, flags, planContext);
		if (later instanceof Error) throw later;
		expect(later.state.clickhouse).toMatchObject({ memoryGiB: 2.5 });
		expect(later.changed).toBe(false);
		const auto = await planServerState(
			first.state,
			{ ...flags, clickhouseMemory: "auto" },
			planContext,
		);
		if (auto instanceof Error) throw auto;
		expect(auto.state.clickhouse).not.toHaveProperty("memoryGiB");
	});

	test("the flag does not apply to an external ClickHouse", async () => {
		const result = await planServerState(
			undefined,
			{
				...flags,
				clickhouseUrl: "http://nas.local:8123",
				clickhouseMemory: "4",
			},
			planContext,
		);
		expect(String(result)).toContain(
			"--clickhouse-memory sets the memory limit",
		);
	});
});

function stateFixture(): ServerState {
	return {
		version: 1,
		createdAt: "2026-11-08T00:00:00.000Z",
		updatedAt: "2026-11-08T00:00:00.000Z",
		port: 4100,
		host: "127.0.0.1",
		publicUrl: "http://localhost:4100",
		secrets: {
			betterAuthSecret: "b".repeat(43),
			cronSecret: "c".repeat(43),
			setupToken: "s".repeat(43),
		},
		clickhouse: {
			mode: "local",
			httpPort: 18123,
			tcpPort: 19000,
			user: "default",
			password: "pw",
		},
		postgres: {
			port: 15432,
			user: "opaline",
			password: "pg",
			database: "opaline",
		},
	};
}
