export interface ClickHouseObserverConfig {
	readonly password: string;
	readonly url: URL;
	readonly user: string;
}

export interface ClickHousePartSnapshot {
	readonly activeParts: number;
	readonly bytesOnDisk: number;
	readonly rows: number;
}

const PART_SNAPSHOT_QUERY = `
SELECT
  count() AS active_parts,
  sum(rows) AS rows,
  sum(bytes_on_disk) AS bytes_on_disk
FROM system.parts
WHERE active
  AND database = 'rudel'
  AND table = 'session_language_signals'
LIMIT 1
FORMAT JSONEachRow
`;

export async function readClickHousePartSnapshot(
	config: ClickHouseObserverConfig,
): Promise<ClickHousePartSnapshot> {
	const url = new URL(config.url);
	url.searchParams.set("max_execution_time", "10");
	url.searchParams.set("max_rows_to_read", "1000000");
	url.searchParams.set("max_bytes_to_read", "100000000");
	url.searchParams.set("timeout_before_checking_execution_speed", "0");
	url.searchParams.set("max_result_rows", "1");
	const response = await fetch(url, {
		body: PART_SNAPSHOT_QUERY,
		headers: {
			"X-ClickHouse-Key": config.password,
			"X-ClickHouse-User": config.user,
		},
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(
			`ClickHouse observer failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`,
		);
	}
	const line = (await response.text()).trim();
	const value: unknown = JSON.parse(line);
	if (!isRecord(value))
		throw new Error("ClickHouse observer returned invalid JSON");
	return {
		activeParts: readFiniteNumber(value, "active_parts"),
		bytesOnDisk: readFiniteNumber(value, "bytes_on_disk"),
		rows: readFiniteNumber(value, "rows"),
	};
}

function readFiniteNumber(value: Record<string, unknown>, key: string): number {
	const field = value[key];
	const number = typeof field === "number" ? field : Number(field);
	if (!Number.isFinite(number) || number < 0) {
		throw new Error(`ClickHouse observer returned invalid ${key}`);
	}
	return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
