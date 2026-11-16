import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeClickHouse } from "../src/clickhouse-probe.js";
import { buildSetupRequest } from "../src/first-run.js";
import {
	defaultPublicUrl,
	planServerState,
	type ServerStartFlags,
} from "../src/server-runner.js";
import {
	getServerStatePath,
	loadServerState,
	resolveServerDataDir,
	type ServerState,
	saveServerState,
} from "../src/server-state.js";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "opaline-selfhost-state-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const noFlags: ServerStartFlags = {
	noAgentSetup: false,
	noBrowser: true,
	yes: false,
};

function planContext(
	overrides: Partial<{
		env: NodeJS.ProcessEnv;
		interactive: boolean;
		confirm: (message: string) => Promise<boolean>;
	}> = {},
) {
	return {
		env: {},
		interactive: false,
		confirm: async () => false,
		...overrides,
	};
}

async function plan(
	existing: ServerState | undefined,
	flags: Partial<ServerStartFlags> = {},
	context = planContext(),
) {
	const result = await planServerState(
		existing,
		{ ...noFlags, ...flags },
		context,
	);
	if (result instanceof Error) throw result;
	return result;
}

describe("server.json", () => {
	test("defaults to ~/.opaline/server under HOME", () => {
		expect(resolveServerDataDir(undefined, {}, "/home/me")).toBe(
			"/home/me/.opaline/server",
		);
		expect(resolveServerDataDir("~/srv", {}, "/home/me")).toBe("/home/me/srv");
		expect(
			resolveServerDataDir(
				undefined,
				{ OPALINE_SERVER_DATA_DIR: "/data" },
				"/h",
			),
		).toBe("/data");
		expect(
			resolveServerDataDir("/flag", { OPALINE_SERVER_DATA_DIR: "/data" }, "/h"),
		).toBe("/flag");
	});

	test("round-trips privately and repairs loose permissions", async () => {
		const { state } = await plan(undefined);
		saveServerState(root, state);
		const path = getServerStatePath(root);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(loadServerState(root)).toMatchObject({
			port: state.port,
			secrets: state.secrets,
		});
		chmodSync(path, 0o644);
		loadServerState(root);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(loadServerState(join(root, "missing"))).toBeUndefined();
	});

	test("refuses a broken or foreign file instead of starting over", () => {
		writeFileSync(getServerStatePath(root), "{");
		expect(() => loadServerState(root)).toThrow("is not valid JSON");
		writeFileSync(getServerStatePath(root), JSON.stringify({ version: 2 }));
		expect(() => loadServerState(root)).toThrow(
			"does not look like an opaline server state file",
		);
	});
});

describe("planning a start", () => {
	test("a first run gets defaults, fresh secrets and a local ClickHouse", async () => {
		const { state, urlChanged, changed } = await plan(undefined);
		expect(state).toMatchObject({
			port: 4100,
			host: "127.0.0.1",
			publicUrl: "http://localhost:4100",
			clickhouse: { mode: "local", user: "default" },
			postgres: { user: "opaline", database: "opaline" },
		});
		expect(state.secrets.betterAuthSecret.length).toBeGreaterThanOrEqual(43);
		expect(state.secrets.setupToken).not.toBe(state.secrets.cronSecret);
		expect(urlChanged).toBe(false);
		expect(changed).toBe(false);
	});

	test("later runs keep ports, passwords and secrets", async () => {
		const first = (await plan(undefined, { port: 4555 })).state;
		const second = (await plan(first)).state;
		expect(second.port).toBe(4555);
		expect(second.secrets).toEqual(first.secrets);
		expect(second.postgres).toEqual(first.postgres);
		expect(second.clickhouse).toEqual(first.clickhouse);
	});

	test("a different port is refused without confirmation", async () => {
		const existing = (await plan(undefined)).state;
		const refused = await planServerState(
			existing,
			{ ...noFlags, port: 4200 },
			planContext(),
		);
		expect(refused).toBeInstanceOf(Error);
		expect(String(refused)).toContain(
			"http://localhost:4100/api/mcp registered",
		);
		expect(String(refused)).toContain("--yes");

		const declined = await planServerState(
			existing,
			{ ...noFlags, port: 4200 },
			planContext({ interactive: true, confirm: async () => false }),
		);
		expect(String(declined)).toContain("Kept http://localhost:4100");

		const confirmed = await plan(
			existing,
			{ port: 4200 },
			planContext({ interactive: true, confirm: async () => true }),
		);
		expect(confirmed.state.publicUrl).toBe("http://localhost:4200");
		expect(confirmed.urlChanged).toBe(true);

		const forced = await plan(existing, { port: 4200, yes: true });
		expect(forced.urlChanged).toBe(true);
		expect(forced.state.secrets).toEqual(existing.secrets);
	});

	test("--clickhouse-url switches to an external ClickHouse", async () => {
		const existing = (await plan(undefined)).state;
		const external = await plan(
			existing,
			{ clickhouseUrl: "http://nas.local:8123/", clickhouseUser: "opaline" },
			planContext({ env: { OPALINE_CLICKHOUSE_PASSWORD: "from-env" } }),
		);
		expect(external.state.clickhouse).toEqual({
			mode: "external",
			url: "http://nas.local:8123",
			user: "opaline",
			password: "from-env",
		});
		expect(external.changed).toBe(true);
		const restarted = await plan(external.state);
		expect(restarted.state.clickhouse).toEqual(external.state.clickhouse);
		expect(restarted.changed).toBe(false);
		const newPassword = await plan(external.state, {
			clickhousePassword: "rotated",
		});
		expect(newPassword.state.clickhouse).toMatchObject({ password: "rotated" });
		expect(newPassword.changed).toBe(true);
	});

	test("ClickHouse credentials without a URL are a mistake", async () => {
		const result = await planServerState(
			undefined,
			{ ...noFlags, clickhouseUser: "x" },
			planContext(),
		);
		expect(String(result)).toContain("need --clickhouse-url");
	});

	test("public URLs follow the bind address", () => {
		expect(defaultPublicUrl("127.0.0.1", 4100)).toBe("http://localhost:4100");
		expect(defaultPublicUrl("192.168.2.74", 4100)).toBe(
			"http://192.168.2.74:4100",
		);
		expect(defaultPublicUrl("0.0.0.0", 4100)).toMatch(
			/^http:\/\/[\d.]+:4100$|^http:\/\/localhost:4100$/u,
		);
	});

	test("--public-url must be an origin", async () => {
		const result = await planServerState(
			undefined,
			{ ...noFlags, publicUrl: "https://opaline.acme.lan/app" },
			planContext(),
		);
		expect(String(result)).toContain("without a path");
		const ok = await plan(undefined, {
			publicUrl: "https://opaline.acme.lan/",
		});
		expect(ok.state.publicUrl).toBe("https://opaline.acme.lan");
	});
});

describe("first admin", () => {
	test("an explicit email is used for the first admin", async () => {
		const request = await buildSetupRequest("admin@acme.test");
		expect(request.email).toBe("admin@acme.test");
		expect(request.workspaceName).toBe("Your workspace");
	});
});

describe("checking an external ClickHouse before anything starts", () => {
	const connection = {
		url: "http://nas.local:8123",
		user: "opaline",
		password: "pw",
	};

	function fakeClickHouse(
		answer: (sql: string) => { status: number; body: string },
	): typeof fetch {
		return (async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(String(input));
			if (url.pathname === "/ping") return new Response("Ok.\n");
			const { status, body } = answer(String(init?.body ?? ""));
			return new Response(body, { status });
		}) as typeof fetch;
	}

	test("unreachable hosts name the cause", async () => {
		const refused = Object.assign(new TypeError("fetch failed"), {
			cause: { code: "ECONNREFUSED" },
		});
		const result = await probeClickHouse(connection, {
			fetchImpl: (async () => {
				throw refused;
			}) as unknown as typeof fetch,
		});
		expect(result).toMatchObject({ ok: false, failure: "unreachable" });
		expect(!result.ok && result.message).toContain(
			"Cannot reach ClickHouse at http://nas.local:8123: connection refused",
		);
	});

	test("something other than ClickHouse is called out", async () => {
		const result = await probeClickHouse(connection, {
			fetchImpl: (async () =>
				new Response("<html>", { status: 404 })) as unknown as typeof fetch,
		});
		expect(result).toMatchObject({ ok: false, failure: "not-clickhouse" });
	});

	test("a wrong password is an authentication failure", async () => {
		const result = await probeClickHouse(connection, {
			fetchImpl: fakeClickHouse(() => ({
				status: 516,
				body: "Code: 516. DB::Exception: opaline: Authentication failed: password is incorrect, or there is no user with such name. (AUTHENTICATION_FAILED)",
			})),
		});
		expect(result).toMatchObject({ ok: false, failure: "authentication" });
		expect(!result.ok && result.message).toContain(
			'rejected user "opaline": wrong user name or password',
		);
	});

	test("a missing CREATE DATABASE right is named with the grant to run", async () => {
		const result = await probeClickHouse(connection, {
			fetchImpl: fakeClickHouse((sql) => {
				if (sql === "SELECT version()")
					return { status: 200, body: "26.9.1.1\n" };
				if (sql.includes("system.databases"))
					return { status: 200, body: "0\n" };
				return {
					status: 200,
					body: sql.includes("CREATE DATABASE") ? "0\n" : "1\n",
				};
			}),
		});
		expect(result).toMatchObject({ ok: false, failure: "permission" });
		expect(!result.ok && result.message).toContain(
			"GRANT CREATE DATABASE ON rudel.* TO opaline",
		);
	});

	test("an existing database does not need CREATE DATABASE", async () => {
		const asked: string[] = [];
		const result = await probeClickHouse(connection, {
			fetchImpl: fakeClickHouse((sql) => {
				asked.push(sql);
				if (sql === "SELECT version()")
					return { status: 200, body: "26.9.1.1\n" };
				return { status: 200, body: "1\n" };
			}),
		});
		expect(result).toEqual({ ok: true, version: "26.9.1.1", warnings: [] });
		expect(asked.some((sql) => sql.includes("CREATE DATABASE"))).toBe(false);
	});

	test("servers without CHECK GRANT pass with a warning", async () => {
		const result = await probeClickHouse(connection, {
			fetchImpl: fakeClickHouse((sql) => {
				if (sql === "SELECT version()")
					return { status: 200, body: "23.8.1.1\n" };
				if (sql.startsWith("CHECK GRANT"))
					return { status: 400, body: "Code: 62. DB::Exception: Syntax error" };
				return { status: 200, body: "0\n" };
			}),
		});
		expect(result.ok).toBe(true);
		expect(result.ok && result.warnings[0]).toContain("cannot CHECK GRANT");
	});

	test("non-http URLs are rejected up front", async () => {
		const result = await probeClickHouse({
			...connection,
			url: "clickhouse://nas.local:9000",
		});
		expect(result).toMatchObject({ ok: false, failure: "invalid-url" });
	});
});
