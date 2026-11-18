export type HostPlatform =
	| "darwin-arm64"
	| "darwin-x64"
	| "linux-x64"
	| "linux-arm64";

export type ArchiveFormat = "binary" | "tgz" | "zip";

export interface PinnedAsset {
	readonly id: string;
	readonly url: string;
	readonly size: number;
	readonly integrity: string;
	readonly format: ArchiveFormat;
	readonly entry: string;
}

export const CLICKHOUSE_VERSION = "26.10.2.103";
export const POSTGRES_PACKAGE_VERSION = "17.11.0-beta.19";
export const POSTGRES_VERSION = "17.11";
export const BUN_VERSION = "1.3.14";

export const MINIMUM_CLICKHOUSE_VERSION = "25.8";
export const MINIMUM_CLICKHOUSE_VERSION_MACOS = "26.6";

export function minimumClickHouseVersion(platform: HostPlatform): string {
	return platform.startsWith("darwin-")
		? MINIMUM_CLICKHOUSE_VERSION_MACOS
		: MINIMUM_CLICKHOUSE_VERSION;
}
export const MINIMUM_POSTGRES_MAJOR = 16;
export const MINIMUM_BUN_VERSION = "1.3.0";

const CLICKHOUSE_RELEASE = `https://github.com/ClickHouse/ClickHouse/releases/download/v${CLICKHOUSE_VERSION}-stable`;
const BUN_RELEASE = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}`;
const POSTGRES_REGISTRY = "https://registry.npmjs.org/@embedded-postgres";

const CLICKHOUSE_ASSETS: Record<HostPlatform, PinnedAsset> = {
	"darwin-arm64": {
		id: `clickhouse-${CLICKHOUSE_VERSION}-macos-aarch64`,
		url: `${CLICKHOUSE_RELEASE}/clickhouse-macos-aarch64`,
		size: 190_539_601,
		integrity: "sha256-f0OjxNX0HkKubsJ1wVMcpEtgGMquFSFzlP2FGByh31k=",
		format: "binary",
		entry: "clickhouse",
	},
	"darwin-x64": {
		id: `clickhouse-${CLICKHOUSE_VERSION}-macos`,
		url: `${CLICKHOUSE_RELEASE}/clickhouse-macos`,
		size: 200_810_233,
		integrity: "sha256-i9sEHCmahJ69m7unL/ypJaJEgqvsaQrmmL5jgY7s4as=",
		format: "binary",
		entry: "clickhouse",
	},
	"linux-x64": {
		id: `clickhouse-common-static-${CLICKHOUSE_VERSION}-amd64.tgz`,
		url: `${CLICKHOUSE_RELEASE}/clickhouse-common-static-${CLICKHOUSE_VERSION}-amd64.tgz`,
		size: 264_795_238,
		integrity: "sha256-7IEUeESRhN6klroXw/dv3TrrIBPdUEFna9AAQf7ZjRc=",
		format: "tgz",
		entry: `clickhouse-common-static-${CLICKHOUSE_VERSION}/usr/bin/clickhouse`,
	},
	"linux-arm64": {
		id: `clickhouse-common-static-${CLICKHOUSE_VERSION}-arm64.tgz`,
		url: `${CLICKHOUSE_RELEASE}/clickhouse-common-static-${CLICKHOUSE_VERSION}-arm64.tgz`,
		size: 238_041_607,
		integrity: "sha256-vVngcmMMiIQDdXXFna1mQzD9acQkfaM0yc8bP3mhpMQ=",
		format: "tgz",
		entry: `clickhouse-common-static-${CLICKHOUSE_VERSION}/usr/bin/clickhouse`,
	},
};

const POSTGRES_ASSETS: Record<HostPlatform, PinnedAsset> = {
	"darwin-arm64": postgresAsset(
		"darwin-arm64",
		118_897_976,
		"sha512-t7SxepOERtwqrkt0lfqLWjeDdYoOvjYRuVFVke7vYJ7XSxMq1sRLRekG6zvcN/zm46XouzXkmrd/E5/RPhlAvw==",
	),
	"darwin-x64": postgresAsset(
		"darwin-x64",
		118_897_974,
		"sha512-4p3AnzAizgUGsDt+/mCL5YmfkUubBFvWhbVjZQmjDhnE3UrxFSd6wfKQkhlv4VKMRpfNyLiTrtXWNGi76t5M3Q==",
	),
	"linux-x64": postgresAsset(
		"linux-x64",
		23_507_982,
		"sha512-Mg2SUiVf0TW9vECO8qfv41730WgJOKguOaK4acUuIB4L8HeVuiYgQzlIj2kh73Q3OLxRdeub7D8C/SkExMlqrg==",
	),
	"linux-arm64": postgresAsset(
		"linux-arm64",
		22_770_811,
		"sha512-Rl7wWkWFa8TYT9ZdMSGETq0EiE8Y4djD7oAVbaUHl/KWXpQm8rPLGgGYTYyqfHG3dg0uKhBIlN/Cs3wvP7dqew==",
	),
};

const BUN_ASSETS = {
	"darwin-arm64": bunAsset(
		"darwin-aarch64",
		23_586_433,
		"sha256-2LliIYKK1vl6x6wKt+lYcjQa92MAHogD6CZ2UsJlJiA=",
	),
	"darwin-x64": bunAsset(
		"darwin-x64",
		26_509_109,
		"sha256-QYPfM3RiPlurMVxUfPoJdFM81FfYa3O2OfeoeXTNZjM=",
	),
	"darwin-x64-baseline": bunAsset(
		"darwin-x64-baseline",
		26_509_145,
		"sha256-PjWtb1OXGpg0v55nhuKt9ytfGSHMmpxf3gc9KXKUQHY=",
	),
	"linux-x64": bunAsset(
		"linux-x64",
		35_969_274,
		"sha256-lR7iruhV8IWVruxiJSJqKY0/6oOj3NZGXAnLzN9+hI8=",
	),
	"linux-x64-baseline": bunAsset(
		"linux-x64-baseline",
		35_595_658,
		"sha256-oGOQiuCLeFLKEJObvcbO7T3avOj7lALc6D1l1zs25sc=",
	),
	"linux-arm64": bunAsset(
		"linux-aarch64",
		35_700_603,
		"sha256-on/7Y6gxA3WDbg1vZorhf6jY0YuIw3yCHGUzGXOhmjs=",
	),
} as const;

export function getClickHouseAsset(platform: HostPlatform): PinnedAsset {
	return CLICKHOUSE_ASSETS[platform];
}

export function getPostgresAsset(platform: HostPlatform): PinnedAsset {
	return POSTGRES_ASSETS[platform];
}

export function getBunAsset(
	platform: HostPlatform,
	cpuHasAvx2: boolean,
): PinnedAsset {
	if (platform === "linux-x64" && !cpuHasAvx2)
		return BUN_ASSETS["linux-x64-baseline"];
	return BUN_ASSETS[platform];
}

export function detectHostPlatform(
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch,
): HostPlatform | Error {
	const key = `${platform}-${arch}`;
	if (
		key === "darwin-arm64" ||
		key === "darwin-x64" ||
		key === "linux-x64" ||
		key === "linux-arm64"
	)
		return key;
	return new Error(
		`opaline server runs on macOS and Linux (arm64 or x64); this machine is ${key}.`,
	);
}

export function cpuInfoHasAvx2(cpuInfo: string): boolean {
	return /^flags\s*:.*\bavx2\b/mu.test(cpuInfo);
}

function postgresAsset(
	name: string,
	size: number,
	integrity: string,
): PinnedAsset {
	return {
		id: `embedded-postgres-${name}-${POSTGRES_PACKAGE_VERSION}.tgz`,
		url: `${POSTGRES_REGISTRY}/${name}/-/${name}-${POSTGRES_PACKAGE_VERSION}.tgz`,
		size,
		integrity,
		format: "tgz",
		entry: "package/native",
	};
}

function bunAsset(name: string, size: number, integrity: string): PinnedAsset {
	return {
		id: `bun-${BUN_VERSION}-${name}.zip`,
		url: `${BUN_RELEASE}/bun-${name}.zip`,
		size,
		integrity,
		format: "zip",
		entry: `bun-${name}/bun`,
	};
}
