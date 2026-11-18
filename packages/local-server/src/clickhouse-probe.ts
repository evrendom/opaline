import { sanitizeForTerminalDisplay } from "./safe-url.js";

export const OPALINE_CLICKHOUSE_DATABASE = "rudel";

export interface ClickHouseConnection {
	readonly url: string;
	readonly user: string;
	readonly password: string;
}

export type ClickHouseProbeFailure =
	| "invalid-url"
	| "unreachable"
	| "not-clickhouse"
	| "authentication"
	| "permission"
	| "query";

export type ClickHouseProbeResult =
	| { readonly ok: true; readonly version: string; readonly warnings: string[] }
	| {
			readonly ok: false;
			readonly failure: ClickHouseProbeFailure;
			readonly message: string;
	  };

interface QueryResult {
	readonly status: number;
	readonly body: string;
}

const AUTHENTICATION_ERROR_CODES = new Set([192, 194, 516]);
const SYNTAX_ERROR_CODES = new Set([46, 62]);

export async function probeClickHouse(
	connection: ClickHouseConnection,
	options: {
		readonly timeoutMs?: number;
		readonly fetchImpl?: typeof fetch;
	} = {},
): Promise<ClickHouseProbeResult> {
	const timeoutMs = options.timeoutMs ?? 5_000;
	const fetchImpl = options.fetchImpl ?? fetch;
	let base: URL;
	try {
		base = new URL(connection.url);
		if (base.protocol !== "http:" && base.protocol !== "https:")
			throw new Error("not http");
	} catch {
		return {
			ok: false,
			failure: "invalid-url",
			message: `--clickhouse-url ${display(connection.url)} is not an http:// or https:// URL. Use the ClickHouse HTTP interface, e.g. http://nas.local:8123 or https://abc.clickhouse.cloud:8443.`,
		};
	}
	const where = display(base.origin);
	try {
		const ping = await fetchImpl(new URL("/ping", base), {
			signal: AbortSignal.timeout(timeoutMs),
		});
		const text = (await ping.text()).trim();
		if (!ping.ok || text !== "Ok.")
			return {
				ok: false,
				failure: "not-clickhouse",
				message: `${where} answered /ping with HTTP ${ping.status}, not ClickHouse's "Ok.". Point --clickhouse-url at the ClickHouse HTTP port (8123, or 8443 with TLS).`,
			};
	} catch (error) {
		return {
			ok: false,
			failure: "unreachable",
			message: `Cannot reach ClickHouse at ${where}: ${describeNetworkError(error, timeoutMs)}. Check the host, the port (HTTP is 8123, or 8443 with TLS) and that ClickHouse listens on the network, not only on 127.0.0.1.`,
		};
	}

	const query = (sql: string) =>
		runQuery(base, connection, sql, timeoutMs, fetchImpl);
	let version: QueryResult;
	try {
		version = await query("SELECT version()");
	} catch (error) {
		return {
			ok: false,
			failure: "unreachable",
			message: `ClickHouse at ${where} stopped answering: ${describeNetworkError(error, timeoutMs)}.`,
		};
	}
	if (version.status !== 200) {
		const code = readErrorCode(version.body);
		if (
			version.status === 401 ||
			version.status === 403 ||
			(code !== undefined && AUTHENTICATION_ERROR_CODES.has(code))
		)
			return {
				ok: false,
				failure: "authentication",
				message: `ClickHouse at ${where} rejected user "${display(connection.user)}": wrong user name or password. Pass --clickhouse-user and --clickhouse-password (or OPALINE_CLICKHOUSE_PASSWORD).`,
			};
		return {
			ok: false,
			failure: "query",
			message: `ClickHouse at ${where} failed a test query: ${summarize(version.body)}`,
		};
	}

	const warnings: string[] = [];
	try {
		const exists = await query(
			`SELECT count() FROM system.databases WHERE name = '${OPALINE_CLICKHOUSE_DATABASE}'`,
		);
		const databaseExists = exists.status === 200 && exists.body.trim() === "1";
		const required = databaseExists
			? ["CREATE TABLE", "INSERT", "SELECT", "ALTER"]
			: ["CREATE DATABASE", "CREATE TABLE", "INSERT", "SELECT", "ALTER"];
		for (const privilege of required) {
			const check = await query(
				`CHECK GRANT ${privilege} ON ${OPALINE_CLICKHOUSE_DATABASE}.*`,
			);
			if (check.status !== 200) {
				const code = readErrorCode(check.body);
				if (code !== undefined && SYNTAX_ERROR_CODES.has(code)) {
					warnings.push(
						`ClickHouse ${version.body.trim()} cannot CHECK GRANT; skipped the permission check.`,
					);
					break;
				}
				return {
					ok: false,
					failure: "query",
					message: `ClickHouse at ${where} failed the permission check: ${summarize(check.body)}`,
				};
			}
			if (check.body.trim() !== "1")
				return {
					ok: false,
					failure: "permission",
					message: `ClickHouse user "${display(connection.user)}" lacks ${privilege} on ${OPALINE_CLICKHOUSE_DATABASE}.*${privilege === "CREATE DATABASE" ? ` and the ${OPALINE_CLICKHOUSE_DATABASE} database does not exist yet` : ""}. Run as an admin: GRANT ${privilege} ON ${OPALINE_CLICKHOUSE_DATABASE}.* TO ${display(connection.user)}`,
				};
		}
	} catch (error) {
		return {
			ok: false,
			failure: "unreachable",
			message: `ClickHouse at ${where} stopped answering: ${describeNetworkError(error, timeoutMs)}.`,
		};
	}
	return { ok: true, version: version.body.trim(), warnings };
}

async function runQuery(
	base: URL,
	connection: ClickHouseConnection,
	sql: string,
	timeoutMs: number,
	fetchImpl: typeof fetch,
): Promise<QueryResult> {
	const response = await fetchImpl(base, {
		method: "POST",
		headers: {
			"X-ClickHouse-User": connection.user,
			"X-ClickHouse-Key": connection.password,
			"Content-Type": "text/plain; charset=utf-8",
		},
		body: sql,
		signal: AbortSignal.timeout(timeoutMs),
	});
	return { status: response.status, body: await response.text() };
}

function readErrorCode(body: string): number | undefined {
	const match = body.match(/Code:\s*(\d+)/u);
	return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

function summarize(body: string): string {
	return display(body.trim().split("\n")[0]?.slice(0, 300) ?? "");
}

function describeNetworkError(error: unknown, timeoutMs: number): string {
	if (error instanceof Error && error.name === "TimeoutError")
		return `no answer within ${Math.round(timeoutMs / 1000)} s`;
	const cause = (error as { cause?: { code?: string; message?: string } })
		?.cause;
	if (cause?.code === "ECONNREFUSED") return "connection refused";
	if (cause?.code === "ENOTFOUND" || cause?.code === "EAI_AGAIN")
		return "host name not found";
	if (cause?.code === "EHOSTUNREACH" || cause?.code === "ENETUNREACH")
		return "host unreachable";
	if (cause?.code) return cause.code;
	if (cause?.message) return cause.message;
	return error instanceof Error ? error.message : String(error);
}

function display(value: string): string {
	return sanitizeForTerminalDisplay(value);
}
