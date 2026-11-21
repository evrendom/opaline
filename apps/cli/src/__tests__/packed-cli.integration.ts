import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CREDENTIALS_FILE } from "../retire/state.js";
import {
	makeHome,
	persistentClaudeHook,
	read,
	readJson,
	testEnv,
	write,
} from "./helpers.js";

// The installed `opaline` launcher from the packed tarballs (see ci.yml).
const packed = process.env.OPALINE_PACKED_CLI;

let home: string;
let cwd: string;
let cleanup: () => void;
beforeEach(() => {
	({ home, cwd, cleanup } = makeHome());
});
afterEach(() => cleanup());

test.skipIf(!packed)(
	"the packed launcher retires a 0.17-style installation",
	() => {
		const configDir = join(home, ".rudel");
		const runtime = join(configDir, "runtime", "cli.js");
		write(
			runtime,
			'var package_default = {\n  name: "@opalinehq/cli",\n  version: "0.0.1",\n};\n',
		);
		write(join(configDir, CREDENTIALS_FILE), {
			token: "t",
			apiBaseUrl: "https://opaline.so",
		});
		write(join(home, ".claude", "settings.json"), {
			permissions: { allow: ["Read"] },
			hooks: {
				SessionEnd: [
					{
						hooks: [
							{
								type: "command",
								command: persistentClaudeHook(configDir, "session-end"),
							},
						],
					},
				],
			},
		});
		write(
			join(home, ".codex", "config.toml"),
			'notify = ["opaline", "hooks", "codex", "turn-complete"]\n',
		);

		const result = spawnSync("node", [packed as string], {
			cwd,
			env: testEnv(home),
			encoding: "utf8",
		});

		expect({
			status: result.status,
			stdout: result.stdout,
			stderr: result.stderr,
		}).toEqual({
			status: 0,
			stdout: "",
			stderr: "",
		});
		expect(existsSync(join(configDir, CREDENTIALS_FILE))).toBe(false);
		expect(readJson(join(home, ".claude", "settings.json"))).toEqual({
			permissions: { allow: ["Read"] },
		});
		expect(read(join(home, ".codex", "config.toml"))).toBe("");
		// The runtime now holds this release, which cleans up any hook that returns.
		expect(read(runtime)).not.toContain('version: "0.0.1"');
	},
);
