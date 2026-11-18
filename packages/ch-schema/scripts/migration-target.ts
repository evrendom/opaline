import {
	type ClickHouseExecutor,
	createClickHouseExecutor,
} from "@chkit/clickhouse";
import { resolveClickHouseUsername } from "../src/clickhouse-connection.js";
import {
	adaptExecutor,
	type ClickHouseCapabilities,
	expectedEngine,
	probeClickHouseCapabilities,
} from "../src/clickhouse-flavor.js";

export interface MigrationTarget {
	readonly url: string;
	readonly capabilities: ClickHouseCapabilities;
	readonly executor: ClickHouseExecutor;
	engine<Base extends string>(base: Base): Base | `Shared${Base}`;
	close(): Promise<void>;
}

export async function openMigrationTarget(
	env: Readonly<Record<string, string | undefined>> = process.env,
	database = "default",
): Promise<MigrationTarget> {
	const url = env.CLICKHOUSE_URL;
	if (!url) throw new Error("CLICKHOUSE_URL is required");
	const raw = createClickHouseExecutor({
		url,
		username: resolveClickHouseUsername(env, url),
		password: env.CLICKHOUSE_PASSWORD ?? "",
		database,
	});
	try {
		const capabilities = await probeClickHouseCapabilities(
			(sql) => raw.query<Record<string, unknown>>(sql),
			env,
		);
		return {
			url,
			capabilities,
			executor: adaptExecutor(raw, capabilities),
			engine: (base) => expectedEngine(capabilities, base),
			close: () => raw.close(),
		};
	} catch (error) {
		await raw.close();
		throw error;
	}
}
