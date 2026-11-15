import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { totalmem } from "node:os";
import { join } from "node:path";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export const CLICKHOUSE_MEMORY = {
	shareOfRam: 0.25,
	floorBytes: 3 * GIB,
	ceilingBytes: 8 * GIB,
	stepBytes: 256 * MIB,
	minimumFlagGiB: 2,
} as const;
export const CLICKHOUSE_MARK_CACHE_BYTES = 256 * MIB;
export const LOCAL_CLICKHOUSE_USER = "default";
export const CLICKHOUSE_ASYNC_INSERT_THREADS = 4;
export const CLICKHOUSE_ASYNC_INSERT_POLL_MS = 50;
export const CLICKHOUSE_MEMORY_WORKER_PERIOD_MS = 1000;

export function defaultClickHouseMemoryBytes(
	totalMemoryBytes: number = totalmem(),
): number {
	const share = Math.min(
		Math.max(
			totalMemoryBytes * CLICKHOUSE_MEMORY.shareOfRam,
			CLICKHOUSE_MEMORY.floorBytes,
		),
		CLICKHOUSE_MEMORY.ceilingBytes,
	);
	return (
		Math.floor(share / CLICKHOUSE_MEMORY.stepBytes) *
		CLICKHOUSE_MEMORY.stepBytes
	);
}

export function clickHouseMemoryBytes(
	memoryGiB: number | undefined,
	totalMemoryBytes: number = totalmem(),
): number {
	return memoryGiB === undefined
		? defaultClickHouseMemoryBytes(totalMemoryBytes)
		: Math.round((memoryGiB * GIB) / MIB) * MIB;
}

export function parseClickHouseMemoryGiB(
	value: string,
	totalMemoryBytes: number = totalmem(),
): number | "auto" | Error {
	const trimmed = value.trim().toLowerCase();
	if (trimmed === "auto") return "auto";
	const total = totalMemoryBytes / GIB;
	const gib = /^\d+(?:\.\d+)?$/u.test(trimmed) ? Number(trimmed) : Number.NaN;
	if (
		!Number.isFinite(gib) ||
		gib < CLICKHOUSE_MEMORY.minimumFlagGiB ||
		gib >= total
	)
		return new Error(
			`--clickhouse-memory takes GiB from ${CLICKHOUSE_MEMORY.minimumFlagGiB} to below this machine's ${formatGiB(totalMemoryBytes)} GiB of RAM (e.g. --clickhouse-memory 4), or auto; got ${JSON.stringify(value)}.`,
		);
	return gib;
}

export function formatGiB(bytes: number): string {
	const gib = bytes / GIB;
	return Number.isInteger(gib)
		? String(gib)
		: gib.toFixed(2).replace(/0$/u, "");
}

export function readConfiguredClickHouseMemoryBytes(
	dataDir: string,
): number | undefined {
	const { overlayPath } = getClickHouseLayout(dataDir);
	if (!existsSync(overlayPath)) return undefined;
	const match = readFileSync(overlayPath, "utf8").match(
		/<max_server_memory_usage>(\d+)<\/max_server_memory_usage>/u,
	);
	return match ? Number(match[1]) : undefined;
}

export interface ClickHouseLayout {
	readonly root: string;
	readonly configPath: string;
	readonly overlayPath: string;
	readonly usersPath: string;
}

export interface ClickHouseConfigOptions {
	readonly httpPort: number;
	readonly tcpPort: number;
	readonly password: string;
	readonly maxServerMemoryBytes: number;
}

export function getClickHouseLayout(dataDir: string): ClickHouseLayout {
	const root = join(dataDir, "clickhouse");
	return {
		root,
		configPath: join(root, "config.xml"),
		overlayPath: join(root, "config.d", "opaline.xml"),
		usersPath: join(root, "users.xml"),
	};
}

export function renderClickHouseConfig(
	layout: ClickHouseLayout,
	options: ClickHouseConfigOptions,
): string {
	return `<clickhouse>
    <logger>
        <level>warning</level>
        <console>1</console>
    </logger>
    <http_port>${options.httpPort}</http_port>
    <tcp_port>${options.tcpPort}</tcp_port>
    <path>${escapeXml(join(layout.root, "data"))}/</path>
    <tmp_path>${escapeXml(join(layout.root, "tmp"))}/</tmp_path>
    <user_files_path>${escapeXml(join(layout.root, "user_files"))}/</user_files_path>
    <format_schema_path>${escapeXml(join(layout.root, "format_schemas"))}/</format_schema_path>
    <user_directories>
        <users_xml>
            <path>${escapeXml(layout.usersPath)}</path>
        </users_xml>
        <local_directory>
            <path>${escapeXml(join(layout.root, "access"))}/</path>
        </local_directory>
    </user_directories>
    <default_profile>default</default_profile>
    <default_database>default</default_database>
    <timezone>UTC</timezone>
</clickhouse>
`;
}

export function renderClickHouseOverlay(maxServerMemoryBytes: number): string {
	return `<clickhouse>
    <listen_host>127.0.0.1</listen_host>
    <max_server_memory_usage>${maxServerMemoryBytes}</max_server_memory_usage>
    <mark_cache_size>${CLICKHOUSE_MARK_CACHE_BYTES}</mark_cache_size>
    <asynchronous_metrics_update_period_s>60</asynchronous_metrics_update_period_s>
    <asynchronous_heavy_metrics_update_period_s>600</asynchronous_heavy_metrics_update_period_s>
    <async_insert_threads>${CLICKHOUSE_ASYNC_INSERT_THREADS}</async_insert_threads>
    <memory_worker_period_ms>${CLICKHOUSE_MEMORY_WORKER_PERIOD_MS}</memory_worker_period_ms>
    <storage_configuration>
        <policies>
            <s3>
                <volumes>
                    <default>
                        <disk>default</disk>
                    </default>
                </volumes>
            </s3>
        </policies>
    </storage_configuration>
    <query_log>
        <database>system</database>
        <table>query_log</table>
        <partition_by>toYYYYMM(event_date)</partition_by>
        <ttl>event_date + INTERVAL 30 DAY DELETE</ttl>
        <flush_interval_milliseconds>7500</flush_interval_milliseconds>
    </query_log>
</clickhouse>
`;
}

export function renderClickHouseUsers(password: string): string {
	const passwordHash = createHash("sha256").update(password).digest("hex");
	return `<clickhouse>
    <profiles>
        <default>
            <log_queries>1</log_queries>
            <async_insert_poll_timeout_ms>${CLICKHOUSE_ASYNC_INSERT_POLL_MS}</async_insert_poll_timeout_ms>
            <query_plan_merge_expressions>0</query_plan_merge_expressions>
        </default>
    </profiles>
    <users>
        <${LOCAL_CLICKHOUSE_USER}>
            <password_sha256_hex>${passwordHash}</password_sha256_hex>
            <networks>
                <ip>127.0.0.1</ip>
                <ip>::1</ip>
            </networks>
            <profile>default</profile>
            <quota>default</quota>
            <access_management>1</access_management>
            <named_collection_control>1</named_collection_control>
        </${LOCAL_CLICKHOUSE_USER}>
    </users>
    <quotas>
        <default/>
    </quotas>
</clickhouse>
`;
}

export function writeClickHouseConfig(
	dataDir: string,
	options: ClickHouseConfigOptions,
): ClickHouseLayout {
	const layout = getClickHouseLayout(dataDir);
	mkdirSync(join(layout.root, "config.d"), { recursive: true, mode: 0o700 });
	writeFileSync(layout.configPath, renderClickHouseConfig(layout, options), {
		mode: 0o600,
	});
	writeFileSync(
		layout.overlayPath,
		renderClickHouseOverlay(options.maxServerMemoryBytes),
		{ mode: 0o600 },
	);
	writeFileSync(layout.usersPath, renderClickHouseUsers(options.password), {
		mode: 0o600,
	});
	return layout;
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
