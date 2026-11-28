import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type postgres from "postgres";
import {
	handleSelfHostRoute,
	type SelfHostAuth,
	type SelfHostDependencies,
} from "../handlers/selfhost-http.js";
import {
	mcpInstructions,
	SERVER_INSTRUCTIONS,
} from "../mcp/server-instructions.js";
import {
	createRetiredCli,
	RETIRED_CLI_MCP_INSTRUCTION,
} from "./retired-cli.js";

// Every test runs against a throwaway home built here from scratch. Nothing
// is copied from the machine running the tests: a copied hook would name the
// real ~/.rudel, and the cleanup follows it.
let root: string;
let home: string;

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "opaline-retired-cli-")));
	home = join(root, "home");
	mkdirSync(home, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, content: string | object): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		typeof content === "string"
			? content
			: `${JSON.stringify(content, null, 2)}\n`,
	);
}

const read = (path: string) => readFileSync(path, "utf8");
const sandbox = () => ({ HOME: home });

const APP_HOOK = () => ({
	type: "command",
	command: `"${join(home, ".opaline", "hook.sh")}" claude`,
});

/** The app's own data and local plugin, which must survive any removal. */
function seedApp(): string[] {
	const files = [
		join(home, ".opaline", "server", "postgres", "PG_VERSION"),
		join(
			home,
			".opaline",
			"marketplace",
			"opaline-claude",
			"hooks",
			"hooks.json",
		),
		join(home, ".opaline", "marketplace", "opaline-claude", ".mcp.json"),
	];
	for (const file of files) write(file, `${file}\n`);
	return files;
}

/** What a 0.17 CLI left: hooks, the Codex wrapper, a cloud MCP, its sign-in. */
function seedCli(): void {
	const configDir = join(home, ".rudel");
	write(join(configDir, "credentials.json"), { token: "secret" });
	write(join(configDir, "projects.json"), "{}");
	write(join(home, ".claude", "settings.json"), {
		enabledPlugins: { "opaline@opaline-local": true },
		hooks: {
			SessionEnd: [
				{
					hooks: [
						APP_HOOK(),
						{
							type: "command",
							command: `'/usr/local/bin/node' '${join(configDir, "runtime", "cli.js")}' hooks claude session-end`,
						},
					],
				},
			],
		},
	});
	write(
		join(home, ".codex", "config.toml"),
		`notify = ${JSON.stringify(["opaline", "hooks", "codex", "turn-complete"])}\n`,
	);
	write(join(home, ".claude.json"), {
		mcpServers: {
			opaline: { url: "https://opaline.so/api/mcp" },
			local: { url: "http://127.0.0.1:4100/api/mcp" },
		},
	});
}

describe("the retired CLI on this Mac", () => {
	test("is reported only while something the CLI installed remains", () => {
		seedApp();
		const cli = createRetiredCli({ env: sandbox });
		expect(cli.present()).toBe(false);
		seedCli();
		expect(createRetiredCli({ env: sandbox }).present()).toBe(true);
	});

	test("is looked up at most once a minute", () => {
		let now = 0;
		const cli = createRetiredCli({ env: sandbox, now: () => now });
		expect(cli.present()).toBe(false);
		write(join(home, ".rudel", "credentials.json"), { token: "secret" });
		now = 59_999;
		expect(cli.present()).toBe(false);
		now = 60_000;
		expect(cli.present()).toBe(true);
	});

	test("remove runs the CLI's cleanup, says what it removed and leaves the app alone", () => {
		const appFiles = seedApp();
		seedCli();
		const cli = createRetiredCli({ env: sandbox });
		expect(cli.present()).toBe(true);

		expect(cli.remove()).toEqual({
			removed: [
				"The CLI's saved sign-in from ~/.rudel",
				"1 automatic-upload hook from ~/.claude/settings.json",
				"The notify hook from ~/.codex/config.toml",
				"1 Opaline cloud MCP server from ~/.claude.json",
				"1 cloud upload file from ~/.rudel",
			],
			skipped: [],
			busy: false,
			present: false,
		});
		for (const file of appFiles) expect(read(file)).toBe(`${file}\n`);
		const settings = JSON.parse(read(join(home, ".claude", "settings.json")));
		expect(settings).toEqual({
			enabledPlugins: { "opaline@opaline-local": true },
			hooks: { SessionEnd: [{ hooks: [APP_HOOK()] }] },
		});
		expect(JSON.parse(read(join(home, ".claude.json"))).mcpServers).toEqual({
			local: { url: "http://127.0.0.1:4100/api/mcp" },
		});
		expect(existsSync(join(home, ".rudel", "credentials.json"))).toBe(false);

		expect(cli.remove()).toEqual({
			removed: [],
			skipped: [],
			busy: false,
			present: false,
		});
	});

	test("remove waits for a live CLI holding its settings lock, after signing it out", () => {
		seedCli();
		const lock = join(home, ".rudel", ".auto-upload-lock");
		write(
			join(lock, `${process.pid}-00000000-0000-4000-8000-000000000000`),
			"",
		);
		const result = createRetiredCli({ env: sandbox }).remove();
		expect(result.removed).toEqual(["The CLI's saved sign-in from ~/.rudel"]);
		expect(result.busy).toBe(true);
		expect(result.present).toBe(true);
		expect(read(join(home, ".codex", "config.toml"))).toContain("opaline");
	});
});

describe("MCP instructions", () => {
	const desktop = { OPALINE_SELF_HOSTED: "1", OPALINE_DESKTOP_APP: "1" };

	test("stay exactly as they were without the retired CLI", () => {
		seedApp();
		expect(mcpInstructions(desktop, createRetiredCli({ env: sandbox }))).toBe(
			SERVER_INSTRUCTIONS,
		);
	});

	test("add one line about the retired CLI while it is installed", () => {
		seedCli();
		expect(mcpInstructions(desktop, createRetiredCli({ env: sandbox }))).toBe(
			`${SERVER_INSTRUCTIONS}\n${RETIRED_CLI_MCP_INSTRUCTION}`,
		);
	});

	test("never look outside the Mac app", () => {
		const cli = {
			present: () => {
				throw new Error("looked for the CLI");
			},
		};
		expect(mcpInstructions({ OPALINE_SELF_HOSTED: "1" }, cli)).toBe(
			SERVER_INSTRUCTIONS,
		);
		expect(mcpInstructions(desktop, cli)).toBe(SERVER_INSTRUCTIONS);
	});
});

describe("the retired CLI routes", () => {
	const ENV = {
		OPALINE_SELF_HOSTED: "1",
		OPALINE_DESKTOP_APP: "1",
		APP_URL: "http://localhost:4100",
	};
	const OWNER = { cookie: "better-auth.session_token=owner.sig" };
	const MEMBER = { cookie: "better-auth.session_token=member.sig" };

	function deps(env: Record<string, string> = ENV): SelfHostDependencies {
		const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
			Promise.resolve(
				strings.join("?").includes("FROM member m")
					? [{ admin: values[0] === "owner" }]
					: [],
			)) as unknown as postgres.Sql;
		const auth = {
			api: {
				verifyApiKey: async ({ body }: { body: { key: string } }) =>
					body.key === "plugin-key"
						? { valid: true, key: { referenceId: "owner" } }
						: { valid: false, key: null },
				getSession: async ({ headers }: { headers: Headers }) => {
					const cookie = headers.get("cookie") ?? "";
					if (cookie.includes("session_token=owner"))
						return { user: { id: "owner" } };
					if (cookie.includes("session_token=member"))
						return { user: { id: "member" } };
					return null;
				},
			},
			handler: async () => new Response(null, { status: 404 }),
		} as unknown as SelfHostAuth;
		return {
			auth,
			sql,
			env,
			socialProviders: [],
			retiredCli: createRetiredCli({ env: sandbox }),
		};
	}

	const call = (
		d: SelfHostDependencies,
		method: string,
		path: string,
		headers: Record<string, string> = {},
	) => {
		const url = new URL(`http://localhost:4100${path}`);
		return handleSelfHostRoute(
			new Request(url.toString(), { method, headers }),
			url,
			d,
		) as Promise<Response>;
	};

	test("report whether the CLI is still installed", async () => {
		const d = deps();
		const before = await call(d, "GET", "/api/selfhost/retired-cli", OWNER);
		expect(await before.json()).toEqual({ present: false });
		seedCli();
		const after = await call(deps(), "GET", "/api/selfhost/retired-cli", {
			"x-api-key": "plugin-key",
		});
		expect(await after.json()).toEqual({ present: true });
	});

	test("remove it for the app's owner and leave the app's data and plugin alone", async () => {
		const appFiles = seedApp();
		seedCli();
		const response = await call(
			deps(),
			"POST",
			"/api/selfhost/retired-cli/remove",
			OWNER,
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { removed: string[] };
		expect(body.removed).toContain("The CLI's saved sign-in from ~/.rudel");
		for (const file of appFiles) expect(read(file)).toBe(`${file}\n`);
		expect(existsSync(join(home, ".rudel", "credentials.json"))).toBe(false);
	});

	test("refuse agents, members, signed-out callers and servers without the app", async () => {
		seedCli();
		const settings = read(join(home, ".claude", "settings.json"));
		const path = "/api/selfhost/retired-cli/remove";
		expect(
			(await call(deps(), "POST", path, { "x-api-key": "plugin-key" })).status,
		).toBe(401);
		expect((await call(deps(), "POST", path)).status).toBe(401);
		expect((await call(deps(), "POST", path, MEMBER)).status).toBe(403);
		const nas = deps({ OPALINE_SELF_HOSTED: "1" });
		expect((await call(nas, "POST", path, OWNER)).status).toBe(404);
		expect(
			(await call(nas, "GET", "/api/selfhost/retired-cli", OWNER)).status,
		).toBe(404);
		expect(read(join(home, ".claude", "settings.json"))).toBe(settings);
		expect(existsSync(join(home, ".rudel", "credentials.json"))).toBe(true);
	});
});
