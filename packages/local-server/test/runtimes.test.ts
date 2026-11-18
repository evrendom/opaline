import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readlinkSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	cpuInfoHasAvx2,
	detectHostPlatform,
	getBunAsset,
	getClickHouseAsset,
	getPostgresAsset,
	minimumClickHouseVersion,
} from "../src/pinned-runtimes.js";
import {
	compareVersions,
	getRuntimeInstallDir,
	hydratePostgresSymlinks,
	parseVersion,
	RUNTIME_SOURCE_ORDER,
	type RuntimeContext,
	resolveBun,
	resolveClickHouse,
	resolvePostgres,
} from "../src/runtimes.js";

let root: string;
let dataDir: string;
let pathDir: string;
let logs: string[];
let probed: string[];
let fetched: string[];

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "opaline-runtimes-"));
	dataDir = join(root, "data");
	pathDir = join(root, "path");
	mkdirSync(pathDir, { recursive: true });
	logs = [];
	probed = [];
	fetched = [];
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function executable(path: string): string {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, "#!/bin/sh\n");
	chmodSync(path, 0o755);
	return path;
}

function context(
	versions: Record<string, string>,
	overrides: Partial<RuntimeContext> = {},
): RuntimeContext {
	return {
		dataDir,
		env: { PATH: pathDir },
		home: join(root, "home"),
		platform: "darwin-arm64",
		downloadCacheDir: join(root, "cache"),
		sharedDownloadCache: true,
		useSystemRuntimes: true,
		cpuHasAvx2: () => true,
		probe: async (command, args) => {
			probed.push([command, ...args].join(" "));
			return versions[command];
		},
		progress: () => ({ update: () => {}, finish: () => {} }),
		log: (line) => logs.push(line),
		fetchImpl: (async (url: string | URL | Request) => {
			fetched.push(String(url));
			return new Response("unavailable", { status: 503 });
		}) as typeof fetch,
		postgresDirectories: [],
		...overrides,
	};
}

describe("runtime resolution order", () => {
	test("is explicit, data directory, system, download", () => {
		expect(RUNTIME_SOURCE_ORDER).toEqual([
			"explicit",
			"data-dir",
			"system",
			"download",
		]);
	});

	test("an explicit binary wins over everything else", async () => {
		const explicit = executable(join(root, "explicit", "clickhouse"));
		executable(join(pathDir, "clickhouse"));
		const installed = executable(
			join(getRuntimeInstallDir(dataDir, "clickhouse"), "clickhouse"),
		);
		const runtime = await resolveClickHouse(
			context(
				{
					[explicit]: "ClickHouse local version 26.7.1.1 (official build).",
					[installed]: "ClickHouse local version 26.10.2.103",
				},
				{ env: { PATH: pathDir, OPALINE_CLICKHOUSE_BIN: explicit } },
			),
		);
		expect(runtime).toEqual({
			name: "clickhouse",
			source: "explicit",
			version: "26.7.1.1",
			path: explicit,
		});
	});

	test("an unusable explicit binary is an error, not a silent fallback", async () => {
		const explicit = executable(join(root, "explicit", "clickhouse"));
		const resolving = resolveClickHouse(
			context(
				{ [explicit]: "ClickHouse local version 24.3.1.1" },
				{ env: { PATH: pathDir, OPALINE_CLICKHOUSE_BIN: explicit } },
			),
		);
		await expect(resolving).rejects.toThrow("OPALINE_CLICKHOUSE_BIN=");
		await expect(resolving).rejects.toThrow("found 24.3.1.1");
	});

	test("the data directory comes before the system", async () => {
		const installed = executable(
			join(getRuntimeInstallDir(dataDir, "bun"), "bun"),
		);
		const system = executable(join(pathDir, "bun"));
		const runtime = await resolveBun(
			context({ [installed]: "1.3.14", [system]: "1.3.1" }),
		);
		expect(runtime.source).toBe("data-dir");
		expect(runtime.path).toBe(installed);
	});

	test("the system comes before a download, and old versions are skipped", async () => {
		const system = executable(join(pathDir, "bun"));
		const runtime = await resolveBun(context({ [system]: "1.3.1" }));
		expect(runtime).toMatchObject({ source: "system", version: "1.3.1" });

		const old = await resolveBun(context({ [system]: "1.2.9" })).catch(
			(error: Error) => error,
		);
		expect(logs[0]).toContain("Skipping Bun 1.2.9");
		expect(old).toBeInstanceOf(Error);
		expect(fetched).toEqual([getBunAsset("darwin-arm64", true).url]);
		expect(String(old)).toContain("HTTP 503");
	});

	test("OPALINE_SERVER_RUNTIMES=download skips system runtimes", async () => {
		const system = executable(join(pathDir, "bun"));
		await resolveBun(
			context({ [system]: "1.3.1" }, { useSystemRuntimes: false }),
		).catch(() => undefined);
		expect(probed).toEqual([]);
		expect(fetched).toHaveLength(1);
	});

	test("clickhousectl's default version counts as a system ClickHouse", async () => {
		const binary = executable(join(root, "chctl", "clickhouse"));
		const clickhousectl = executable(join(pathDir, "clickhousectl"));
		const runtime = await resolveClickHouse(
			context({
				[clickhousectl]: JSON.stringify({
					version: "26.9.16.10",
					binary_path: binary,
				}),
				[binary]: "ClickHouse local version 26.9.16.10 (official build).",
			}),
		);
		expect(runtime).toEqual({
			name: "clickhouse",
			source: "system",
			version: "26.9.16.10",
			path: binary,
		});
		expect(probed).toContain(`${clickhousectl} local which --json`);
	});

	test("Postgres needs initdb next to postgres and the data directory's major", async () => {
		const pg16 = join(root, "pg16", "bin");
		const pg17 = join(root, "pg17", "bin");
		executable(join(pg16, "postgres"));
		executable(join(pg16, "initdb"));
		executable(join(pg17, "postgres"));
		const versions = {
			[join(pg16, "postgres")]: "postgres (PostgreSQL) 16.4",
			[join(pg17, "postgres")]: "postgres (PostgreSQL) 17.6",
		};
		const fresh = await resolvePostgres(
			context(versions, { postgresDirectories: [pg17, pg16] }),
		);
		expect(fresh).toMatchObject({
			source: "system",
			path: pg16,
			version: "16.4",
		});

		executable(join(pg17, "initdb"));
		const matching = await resolvePostgres(
			context(versions, { postgresDirectories: [pg16, pg17] }),
			17,
		);
		expect(matching).toMatchObject({ path: pg17, version: "17.6" });

		await expect(
			resolvePostgres(context(versions, { postgresDirectories: [] }), 16),
		).rejects.toThrow("created by Postgres 16");
	});
});

describe("pinned downloads", () => {
	test("pick the platform asset and Bun's baseline build without AVX2", () => {
		expect(getClickHouseAsset("darwin-arm64").url).toEndWith(
			"/v26.10.2.103-stable/clickhouse-macos-aarch64",
		);
		expect(getClickHouseAsset("linux-x64")).toMatchObject({
			format: "tgz",
			entry: "clickhouse-common-static-26.10.2.103/usr/bin/clickhouse",
		});
		expect(getPostgresAsset("linux-arm64").url).toBe(
			"https://registry.npmjs.org/@embedded-postgres/linux-arm64/-/linux-arm64-17.11.0-beta.19.tgz",
		);
		expect(getPostgresAsset("darwin-x64").integrity).toStartWith("sha512-");
		expect(getBunAsset("linux-x64", true).url).toEndWith("bun-linux-x64.zip");
		expect(getBunAsset("linux-x64", false).url).toEndWith(
			"bun-linux-x64-baseline.zip",
		);
		expect(getBunAsset("linux-arm64", false).url).toEndWith(
			"bun-linux-aarch64.zip",
		);
	});

	test("every pinned asset has a size and an SRI checksum", () => {
		for (const platform of [
			"darwin-arm64",
			"darwin-x64",
			"linux-x64",
			"linux-arm64",
		] as const)
			for (const asset of [
				getClickHouseAsset(platform),
				getPostgresAsset(platform),
				getBunAsset(platform, true),
				getBunAsset(platform, false),
			]) {
				expect(asset.size).toBeGreaterThan(1_000_000);
				expect(asset.integrity).toMatch(/^sha(256|512)-[A-Za-z0-9+/]+=*$/u);
			}
	});

	test("AVX2 is read from the cpuinfo flags line", () => {
		expect(
			cpuInfoHasAvx2("processor : 0\nflags : fpu sse4_2 avx avx2 bmi2\n"),
		).toBe(true);
		expect(cpuInfoHasAvx2("processor : 0\nflags : fpu sse4_2 avx\n")).toBe(
			false,
		);
	});

	test("unsupported platforms get a clear error", () => {
		expect(detectHostPlatform("darwin", "arm64")).toBe("darwin-arm64");
		expect(detectHostPlatform("linux", "x64")).toBe("linux-x64");
		expect(String(detectHostPlatform("win32", "x64"))).toContain(
			"macOS and Linux",
		);
	});
});

describe("version helpers", () => {
	test("parse common version banners", () => {
		expect(
			parseVersion("ClickHouse local version 26.9.16.10 (official build)."),
		).toBe("26.9.16.10");
		expect(parseVersion("postgres (PostgreSQL) 17.10 (Homebrew)")).toBe(
			"17.10",
		);
		expect(parseVersion("1.3.14")).toBe("1.3.14");
		expect(parseVersion(undefined)).toBeUndefined();
	});

	test("compare numerically, not as strings", () => {
		expect(compareVersions("26.10.2", "26.9.16")).toBeGreaterThan(0);
		expect(compareVersions("1.3", "1.3.0")).toBe(0);
		expect(compareVersions("25.7.9", "25.8")).toBeLessThan(0);
	});

	test("macOS needs a ClickHouse with 8 MiB query thread stacks", () => {
		expect(minimumClickHouseVersion("darwin-arm64")).toBe("26.6");
		expect(minimumClickHouseVersion("darwin-x64")).toBe("26.6");
		expect(minimumClickHouseVersion("linux-x64")).toBe("25.8");
		expect(
			compareVersions("26.3.17.56", minimumClickHouseVersion("darwin-arm64")),
		).toBeLessThan(0);
		expect(
			compareVersions("26.9.16.10", minimumClickHouseVersion("darwin-arm64")),
		).toBeGreaterThan(0);
	});
});

describe("embedded Postgres symlinks", () => {
	test("are recreated relative to their directory", () => {
		const packageRoot = join(root, "package");
		mkdirSync(join(packageRoot, "native", "lib"), { recursive: true });
		writeFileSync(join(packageRoot, "native", "lib", "libpq.so.5.17"), "");
		writeFileSync(
			join(packageRoot, "native", "pg-symlinks.json"),
			JSON.stringify([
				{ source: "native/lib/libpq.so.5.17", target: "native/lib/libpq.so.5" },
				{ source: "native/lib/libpq.so.5.17", target: "native/lib/libpq.so" },
			]),
		);
		expect(hydratePostgresSymlinks(packageRoot)).toBe(2);
		const link = join(packageRoot, "native", "lib", "libpq.so.5");
		expect(lstatSync(link).isSymbolicLink()).toBe(true);
		expect(readlinkSync(link)).toBe("libpq.so.5.17");
		expect(hydratePostgresSymlinks(packageRoot)).toBe(0);
	});

	test("refuse entries that point outside the package", () => {
		const packageRoot = join(root, "package");
		mkdirSync(join(packageRoot, "native"), { recursive: true });
		for (const entry of [
			{ source: "../../etc/passwd", target: "native/lib/x" },
			{ source: "native/lib/a", target: "../outside" },
			{ source: "/etc/passwd", target: "native/lib/y" },
		]) {
			writeFileSync(
				join(packageRoot, "native", "pg-symlinks.json"),
				JSON.stringify([entry]),
			);
			expect(() => hydratePostgresSymlinks(packageRoot)).toThrow("Refusing");
		}
		expect(existsSync(join(root, "outside"))).toBe(false);
	});
});
