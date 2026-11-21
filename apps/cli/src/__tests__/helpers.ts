import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type CleanupReport, retire } from "@rudel/cli-retire";
import { type CliOptions, runCli } from "../run-cli.js";

/** A throwaway home directory; nothing here reaches the real one. */
export function makeHome(): {
	home: string;
	cwd: string;
	cleanup: () => void;
} {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "opaline-retire-")));
	const home = join(root, "home");
	const cwd = join(root, "work");
	mkdirSync(home, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	return {
		home,
		cwd,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

/** The minimal environment for a run: never the developer's own settings. */
export function testEnv(
	home: string,
	extra: Record<string, string> = {},
): Record<string, string> {
	return {
		PATH: process.env.PATH ?? "",
		HOME: home,
		USERPROFILE: home,
		...extra,
	};
}

export function write(path: string, content: string | object): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		typeof content === "string"
			? content
			: `${JSON.stringify(content, null, 2)}\n`,
	);
}

export function read(path: string): string {
	return readFileSync(path, "utf8");
}

export function readJson(path: string): unknown {
	return JSON.parse(read(path));
}

export const NODE = "/usr/local/bin/node";

/** The hook command a 0.17.x release wrote for a runtime in `configDir`. */
export function persistentClaudeHook(configDir: string, event: string): string {
	return `'${NODE}' '${join(configDir, "runtime", "cli.js")}' hooks claude ${event}`;
}

/** A stand-in for a released bundle: what updaters read is the version marker. */
export function fakeBundle(version: string): string {
	return `#!/usr/bin/env node\nvar package_default = {\n  name: "@opalinehq/cli",\n  version: "${version}",\n};\n`;
}

export function runRetire(
	home: string,
	cwd: string,
	options: {
		env?: Record<string, string>;
		argv1?: string;
		bundlePath?: string;
	} = {},
): CleanupReport {
	return retire({
		env: options.env ?? testEnv(home),
		home,
		cwd,
		argv1: options.argv1 ?? join(cwd, "npx", "opaline.js"),
		bundlePath: options.bundlePath,
	});
}

export async function runInProcess(
	args: string[],
	home: string,
	cwd: string,
	options: Partial<CliOptions> = {},
): Promise<string> {
	let stdout = "";
	await runCli(args, {
		env: testEnv(home),
		home,
		cwd,
		argv1: join(cwd, "npx", "opaline.js"),
		bundlePath: undefined,
		interactive: false,
		stdout: (text) => {
			stdout += text;
		},
		...options,
	});
	return stdout;
}
