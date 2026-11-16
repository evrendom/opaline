import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
	claudeHookInput,
	codexHookInput,
	type HookInput,
	notifyLocalServer,
} from "./hook.js";
import { createJsonLineSink } from "./server-events.js";
import {
	createDashboardLink,
	getServerStatusReport,
	type ServerRunnerContext,
	startServer,
	stopServer,
} from "./server-runner.js";
import { getLauncherVersion } from "./version.js";

const USAGE =
	"usage: opaline-local start|stop|open|status [--data-dir DIR] [--port N] | hook claude|codex [--data-dir DIR]";

function readStdin(): Promise<string> {
	return new Promise((resolve) => {
		if (process.stdin.isTTY) return resolve("");
		let text = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			text += chunk;
		});
		process.stdin.on("end", () => resolve(text));
		process.stdin.on("error", () => resolve(text));
	});
}

function jsonContext(): ServerRunnerContext {
	const events = createJsonLineSink(process.stdout);
	return {
		env: process.env,
		home: homedir(),
		reporter: {
			info: (message) => events({ type: "log", level: "info", message }),
			warn: (message) => events({ type: "log", level: "warning", message }),
		},
		interactive: false,
		confirm: async () => false,
		openBrowser: () => {},
		cliVersion: getLauncherVersion(),
		events,
	};
}

function print(value: unknown) {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function run(argv: readonly string[]): Promise<number> {
	const { positionals, values } = parseArgs({
		args: [...argv],
		allowPositionals: true,
		options: {
			"data-dir": { type: "string" },
			port: { type: "string" },
		},
	});
	const [command, agent] = positionals;
	const dataDir = values["data-dir"];
	const context = { env: process.env, home: homedir() };
	if (command === "start") {
		const port = values.port ? Number.parseInt(values.port, 10) : undefined;
		const events = jsonContext();
		const result = await startServer(
			{
				dataDir,
				port,
				noAgentSetup: true,
				noBrowser: true,
				yes: true,
			},
			events,
		);
		if (result instanceof Error) {
			events.events?.({ type: "error", message: result.message });
			return 1;
		}
		return 0;
	}
	if (command === "stop") {
		await stopServer(dataDir, {
			...jsonContext(),
			reporter: { info: () => {}, warn: () => {} },
		});
		return 0;
	}
	if (command === "open") {
		const created = await createDashboardLink(dataDir, {
			...context,
			reporter: { info: () => {}, warn: () => {} },
		});
		if (created instanceof Error) {
			print({ type: "error", message: created.message });
			return 1;
		}
		print(created.link);
		return 0;
	}
	if (command === "status") {
		const report = await getServerStatusReport(dataDir, context);
		if (report instanceof Error) {
			print({ type: "error", message: report.message });
			return 1;
		}
		print(report);
		return 0;
	}
	if (command === "hook" && (agent === "claude" || agent === "codex")) {
		const raw = positionals[2] ?? (await readStdin());
		const input: HookInput | null =
			agent === "claude"
				? claudeHookInput(raw)
				: codexHookInput(
						raw,
						process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"),
					);
		if (input) await notifyLocalServer(input, { dataDir });
		return 0;
	}
	process.stderr.write(`${USAGE}\n`);
	return 2;
}

run(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(error) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exit(1);
	},
);
