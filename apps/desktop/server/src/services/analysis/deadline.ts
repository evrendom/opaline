import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { TRANSCRIPT_READ_DEADLINE_MS } from "../transcript-records-reader.service.js";

export async function withAnalysisDeadline<T>(
	name: string,
	operation: (executor: ClickHouseExecutor) => Promise<T>,
	env: { executor: ClickHouseExecutor; deadlineMs?: number },
): Promise<T> {
	const controller = new AbortController();
	const signal = controller.signal;
	const deadlineMs = env.deadlineMs ?? TRANSCRIPT_READ_DEADLINE_MS;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const executor: ClickHouseExecutor = {
		close: () => env.executor.close(),
		execute: (statement) => {
			signal.throwIfAborted();
			return env.executor.execute({ ...statement, abortSignal: signal });
		},
		insert: (params) => {
			signal.throwIfAborted();
			return env.executor.insert({ ...params, abortSignal: signal });
		},
		async query<T>(statement: ClickHouseStatement): Promise<T[]> {
			signal.throwIfAborted();
			try {
				return await env.executor.query<T>({
					...statement,
					abortSignal: signal,
					clickhouse_settings: {
						...statement.clickhouse_settings,
						cancel_http_readonly_queries_on_client_close: 1,
					},
				});
			} catch (error) {
				controller.abort(error);
				throw error;
			}
		},
	};
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			const error = new Error(`${name} exceeded its ${deadlineMs} ms deadline`);
			controller.abort(error);
			reject(error);
		}, deadlineMs);
	});
	try {
		return await Promise.race([operation(executor), deadline]);
	} catch (error) {
		controller.abort(error);
		throw error;
	} finally {
		clearTimeout(timer);
	}
}
