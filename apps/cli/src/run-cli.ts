import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };
import {
	type CleanupReport,
	type Environment,
	PREVIOUS_NOTIFY_FLAG,
	parsePrevious,
	retire,
} from "@rudel/cli-retire";

export const APP_URL = "https://opaline.evren.so";

export interface CliOptions {
	readonly env?: Environment;
	readonly home?: string;
	readonly cwd?: string;
	readonly argv1?: string;
	readonly bundlePath?: string;
	readonly interactive?: boolean;
	readonly stdout?: (text: string) => void;
	readonly stderr?: (text: string) => void;
}

/**
 * Opaline's cloud has shut down. Whatever it is asked to do, this release
 * removes what earlier releases installed and makes no network request.
 * Hook invocations stay silent and always succeed.
 */
export async function runCli(
	args: readonly string[] = process.argv.slice(2),
	options: CliOptions = {},
): Promise<void> {
	const env = options.env ?? process.env;
	const stdout = options.stdout ?? ((text) => process.stdout.write(text));
	const hook = args[0] === "hooks";
	const forwarded =
		hook && args[1] === "codex" && args[2] === "turn-complete"
			? forwardCodexNotification(args.slice(3), env)
			: Promise.resolve();

	let report: CleanupReport | undefined;
	let failure: unknown;
	try {
		report = retire({
			env,
			home: options.home ?? homedir(),
			cwd: options.cwd ?? process.cwd(),
			argv1: options.argv1 ?? process.argv[1],
			bundlePath:
				"bundlePath" in options ? options.bundlePath : currentBundlePath(),
		});
	} catch (error) {
		failure = error;
	}
	await forwarded;
	process.exitCode = 0;
	if (hook) return;

	if (args.includes("--version") || args.includes("-v")) {
		stdout(`${pkg.version}\n`);
		return;
	}
	const home = options.home ?? homedir();
	const help = args.includes("--help") || args.includes("-h");
	const interactive =
		options.interactive ?? Boolean(process.stdout.isTTY && !env.CI?.trim());
	if (!help && !interactive) return;
	stdout(formatReport(report, failure, home, help));
}

export function formatReport(
	report: CleanupReport | undefined,
	failure: unknown,
	home: string,
	help: boolean,
): string {
	const lines = [
		"Opaline's cloud has shut down, and this CLI no longer uploads anything.",
		"",
	];
	if (help)
		lines.push(
			"Running npx opaline@latest removes what earlier versions set up on this",
			"computer: automatic-upload hooks, cloud MCP servers and the saved sign-in.",
			"",
		);
	const done: string[] = [];
	if (report) {
		for (const dir of report.signedOut)
			done.push(
				`Signed out and removed the saved sign-in in ${tilde(dir, home)}`,
			);
		for (const change of report.changed)
			done.push(`Removed ${change.what} from ${tilde(change.path, home)}`);
		for (const { configDir, names } of report.stateRemoved)
			done.push(
				`Removed ${names.length} upload state ${names.length === 1 ? "item" : "items"} from ${tilde(configDir, home)}`,
			);
	}
	if (done.length) lines.push(...done.map((line) => `  ✓ ${line}`), "");
	else if (!help && report && !report.busy && !report.skipped.length)
		lines.push("Nothing from Opaline was left on this computer.", "");
	for (const { path, reason } of report?.skipped ?? [])
		lines.push(
			reason === "unparseable"
				? `  ! Left ${tilde(path, home)} unchanged: it could not be parsed. Remove Opaline's hooks from it by hand.`
				: `  ! Could not update ${tilde(path, home)}. Run npx opaline@latest again to finish.`,
		);
	if (report?.busy)
		lines.push(
			"  ! Another Opaline process is busy. Run npx opaline@latest again in a moment to finish.",
		);
	if (failure)
		lines.push(
			`  ! Cleanup stopped: ${failure instanceof Error ? failure.message : String(failure)}`,
		);
	if (report?.skipped.length || report?.busy || failure) lines.push("");
	lines.push(
		"Opaline is now a free Mac app that keeps your sessions on your Mac:",
		APP_URL,
		"",
	);
	return lines.join("\n");
}

/**
 * Codex runs `notify` once per turn with the event as the last argument.
 * This turn's event still reaches the command Opaline wrapped; later turns
 * go to it directly because cleanup restores it in the Codex config.
 */
function forwardCodexNotification(
	args: readonly string[],
	env: Environment,
): Promise<void> {
	if (env.OPALINE_CODEX_NOTIFY_FORWARDED === "1") return Promise.resolve();
	const flag = args.indexOf(PREVIOUS_NOTIFY_FLAG);
	if (flag < 0) return Promise.resolve();
	const saved = args[flag + 1];
	const notification = args.length - 1 > flag + 1 ? args.at(-1) : undefined;
	if (saved === undefined || notification === undefined)
		return Promise.resolve();
	let previous: string[];
	try {
		previous = parsePrevious(saved);
	} catch {
		return Promise.resolve();
	}
	const [executable, ...rest] = previous;
	if (!executable) return Promise.resolve();
	return new Promise((resolve) => {
		const child = spawn(executable, [...rest, notification], {
			env: { ...env, OPALINE_CODEX_NOTIFY_FORWARDED: "1" },
			stdio: "ignore",
			windowsHide: true,
		});
		const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
		timer.unref();
		const done = () => {
			clearTimeout(timer);
			resolve();
		};
		child.once("error", done);
		child.once("close", done);
	});
}

/** The bundle's `cli.js`, which hook runtimes are copies of. */
function currentBundlePath(): string | undefined {
	const current = fileURLToPath(import.meta.url);
	if (extname(current) !== ".js") return undefined;
	const bundle = join(dirname(current), "cli.js");
	return existsSync(bundle) ? bundle : undefined;
}

function tilde(path: string, home: string): string {
	return home && path.startsWith(`${home}/`)
		? `~${path.slice(home.length)}`
		: path;
}
