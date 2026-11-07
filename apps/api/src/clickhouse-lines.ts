import { createClient } from "@clickhouse/client-web";
import { resolveClickHouseUsername } from "@rudel/ch-schema/connection";
import {
	assertDateQueryParams,
	type ClickHouseStatement,
	fetchWithClickHouseHttpStatus,
} from "./clickhouse.js";

export type ClickHouseLineFormat =
	| "JSONEachRow"
	| "JSONCompactEachRowWithNames";

export type OpenClickHouseLines = (
	statement: ClickHouseStatement,
	format: ClickHouseLineFormat,
) => Promise<AsyncIterable<readonly string[]>>;

export function createClickHouseLineReader(config: {
	url: string;
	username?: string;
	password?: string;
	database?: string;
}): OpenClickHouseLines {
	const client = createClient({
		url: config.url,
		username: config.username,
		password: config.password,
		database: config.database,
		fetch: fetchWithClickHouseHttpStatus,
		request_timeout: 120_000,
		clickhouse_settings: {
			timeout_before_checking_execution_speed: 0,
			wait_end_of_query: 1,
			output_format_json_quote_64bit_integers: 0,
		},
	});
	return async (statement, format) => {
		statement.abortSignal?.throwIfAborted();
		assertDateQueryParams(statement);
		const result = await client.query({
			abort_signal:
				statement.abortSignal === undefined
					? undefined
					: AbortSignal.any([statement.abortSignal]),
			clickhouse_settings: statement.clickhouse_settings,
			query: statement.query,
			query_params: statement.query_params,
			query_id: statement.query_id,
			format,
		});
		const stream = result.stream();
		return {
			async *[Symbol.asyncIterator]() {
				const reader = stream.getReader();
				let finished = false;
				try {
					for (;;) {
						const { done, value } = await reader.read();
						if (done) {
							finished = true;
							return;
						}
						yield value.map((row) => row.text);
					}
				} finally {
					if (!finished) await reader.cancel().catch(() => undefined);
					reader.releaseLock();
				}
			},
		};
	};
}

let shared: OpenClickHouseLines | null = null;

export function getClickHouseLines(): OpenClickHouseLines {
	if (!shared) {
		const url = process.env.CLICKHOUSE_URL || "http://localhost:8123";
		shared = createClickHouseLineReader({
			url,
			username: resolveClickHouseUsername(process.env, url),
			password: process.env.CLICKHOUSE_PASSWORD || "",
			database: "default",
		});
	}
	return shared;
}
