export type ClickHouseFlavorSetting = "auto" | "oss" | "cloud";

export interface ClickHouseCapabilities {
	readonly flavor: "oss" | "cloud";
	readonly sharedEngines: boolean;
	readonly storagePolicy: "s3" | "default";
}

export type ClickHouseQuery = (
	sql: string,
) => Promise<ReadonlyArray<Record<string, unknown>>>;

export const CLOUD_CAPABILITIES: ClickHouseCapabilities = {
	flavor: "cloud",
	sharedEngines: true,
	storagePolicy: "s3",
};

export function readClickHouseFlavorSetting(
	env: Readonly<Record<string, string | undefined>>,
): ClickHouseFlavorSetting {
	const value = env.CLICKHOUSE_FLAVOR?.trim().toLowerCase() || "auto";
	if (value === "auto" || value === "oss" || value === "cloud") return value;
	throw new Error(
		`CLICKHOUSE_FLAVOR must be auto, oss or cloud, not ${JSON.stringify(env.CLICKHOUSE_FLAVOR)}`,
	);
}

export async function probeClickHouseCapabilities(
	query: ClickHouseQuery,
	env: Readonly<Record<string, string | undefined>>,
): Promise<ClickHouseCapabilities> {
	const setting = readClickHouseFlavorSetting(env);
	if (setting === "cloud") return CLOUD_CAPABILITIES;
	const count = async (sql: string) =>
		Number((await query(sql))[0]?.n ?? 0) > 0;
	const sharedEngines =
		setting === "auto" &&
		(await count(
			"SELECT count() AS n FROM system.table_engines WHERE name = 'SharedMergeTree' SETTINGS max_execution_time = 10",
		));
	const s3 = await count(
		"SELECT count() AS n FROM system.storage_policies WHERE policy_name = 's3' SETTINGS max_execution_time = 10",
	);
	return {
		flavor: sharedEngines ? "cloud" : "oss",
		sharedEngines,
		storagePolicy: s3 ? "s3" : "default",
	};
}

export function expectedEngine<Base extends string>(
	capabilities: ClickHouseCapabilities,
	base: Base,
): Base | `Shared${Base}` {
	return capabilities.sharedEngines ? `Shared${base}` : base;
}

export function needsAdaptation(capabilities: ClickHouseCapabilities): boolean {
	return !capabilities.sharedEngines || capabilities.storagePolicy !== "s3";
}

const SHARED_ENGINE = /\b(ENGINE\s*=\s*)Shared(\w*MergeTree)\s*\(([^()]*)\)/giu;
const QUOTED = /^'(?:[^'\\]|\\.)*'$/u;

export function adaptSql(
	sql: string,
	capabilities: ClickHouseCapabilities,
): string {
	let adapted = sql;
	if (!capabilities.sharedEngines)
		adapted = adapted.replace(
			SHARED_ENGINE,
			(_match, engine: string, base: string, args: string) => {
				const parts = args
					.split(",")
					.map((part) => part.trim())
					.filter(Boolean);
				const rest =
					parts.length >= 2 &&
					QUOTED.test(parts[0] ?? "") &&
					QUOTED.test(parts[1] ?? "")
						? parts.slice(2)
						: parts;
				return `${engine}${base}(${rest.join(", ")})`;
			},
		);
	if (capabilities.storagePolicy !== "s3")
		adapted = adapted
			.replace(
				/\bstorage_policy\s*=\s*'s3'/gu,
				`storage_policy = '${capabilities.storagePolicy}'`,
			)
			.replace(
				/\bposition\(create_table_query,\s*'s3'\)/gu,
				`position(create_table_query, '${capabilities.storagePolicy}')`,
			);
	return adapted;
}

export function adaptStatement(
	statement: string,
	capabilities: ClickHouseCapabilities,
): string | null {
	const code = statement
		.split("\n")
		.filter((line) => !line.trim().startsWith("--"))
		.join("\n")
		.trim();
	if (!capabilities.sharedEngines && /^SYSTEM\s+SYNC\s+REPLICA\b/iu.test(code))
		return null;
	if (
		capabilities.storagePolicy !== "s3" &&
		/^ALTER\s+TABLE\s+\S+\s+MODIFY\s+SETTING\s+storage_policy\s*=\s*'s3'\s*;?$/iu.test(
			code,
		)
	)
		return null;
	return adaptSql(statement, capabilities);
}

export interface StatementExecutor {
	execute(sql: string): Promise<void>;
	query<T>(sql: string): Promise<T[]>;
}

export function adaptExecutor<T extends StatementExecutor>(
	executor: T,
	capabilities: ClickHouseCapabilities,
): T {
	if (!needsAdaptation(capabilities)) return executor;
	const journalProbe = /^SELECT name FROM ([A-Za-z_][A-Za-z0-9_]*) LIMIT 0$/u;
	return {
		...executor,
		async execute(sql: string) {
			const statement = adaptStatement(sql, capabilities);
			if (statement !== null) await executor.execute(statement);
		},
		async query<Row>(sql: string): Promise<Row[]> {
			const probe = journalProbe.exec(sql.trim());
			if (probe) {
				const [found] = await executor.query<{ n: number | string }>(
					`SELECT count() AS n FROM system.tables WHERE database = currentDatabase() AND name = '${probe[1]}'`,
				);
				if (Number(found?.n ?? 0) === 0)
					throw new Error(`Table ${probe[1]} does not exist yet`);
			}
			return executor.query<Row>(sql);
		},
	} as T;
}
