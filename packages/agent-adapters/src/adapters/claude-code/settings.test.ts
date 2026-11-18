import { afterAll, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	addHook,
	ensureSessionStartHook,
	isHookEnabled,
	removeHook,
} from "./settings.js";

const tempRoot = mkdtempSync(join(tmpdir(), "rudel-claude-settings-test-"));

afterAll(() => {
	rmSync(tempRoot, { recursive: true, force: true });
});

describe("Claude Code settings", () => {
	test("repairs invalid hooks and preserves unrelated hooks when removed", () => {
		const settingsPath = join(tempRoot, ".claude", "settings.json");
		mkdirSync(dirname(settingsPath), { recursive: true });
		writeFileSync(
			settingsPath,
			JSON.stringify(
				{
					theme: "dark",
					hooks: {
						SessionStart: [
							{
								matcher: "startup",
								hooks: [
									{
										type: "prompt",
										command: "rudel hooks claude session-start",
									},
									{ type: "command", command: "other start" },
								],
							},
						],
						SessionEnd: [
							{
								matcher: "shutdown",
								hooks: [
									{
										type: "command",
										command: "rudel hooks claude session-end",
										async: false,
									},
									{ type: "command", command: "other end" },
								],
							},
						],
						PreToolUse: [
							{
								matcher: "Bash",
								hooks: [{ type: "command", command: "other tool" }],
							},
						],
					},
				},
				null,
				2,
			),
		);

		expect(isHookEnabled(settingsPath)).toBe(true);

		addHook(settingsPath);
		addHook(settingsPath);

		expect(isHookEnabled(settingsPath)).toBe(true);
		expect(JSON.parse(readFileSync(settingsPath, "utf-8"))).toEqual({
			theme: "dark",
			hooks: {
				SessionStart: [
					{
						matcher: "startup",
						hooks: [{ type: "command", command: "other start" }],
					},
					{
						matcher: "",
						hooks: [
							{
								type: "command",
								command: "rudel hooks claude session-start",
								async: true,
							},
						],
					},
				],
				SessionEnd: [
					{
						matcher: "shutdown",
						hooks: [{ type: "command", command: "other end" }],
					},
					{
						matcher: "",
						hooks: [
							{
								type: "command",
								command: "rudel hooks claude session-end",
								async: true,
							},
						],
					},
				],
				PreToolUse: [
					{
						matcher: "Bash",
						hooks: [{ type: "command", command: "other tool" }],
					},
				],
			},
		});

		removeHook(settingsPath);

		expect(isHookEnabled(settingsPath)).toBe(false);
		expect(JSON.parse(readFileSync(settingsPath, "utf-8"))).toEqual({
			theme: "dark",
			hooks: {
				SessionStart: [
					{
						matcher: "startup",
						hooks: [{ type: "command", command: "other start" }],
					},
				],
				SessionEnd: [
					{
						matcher: "shutdown",
						hooks: [{ type: "command", command: "other end" }],
					},
				],
				PreToolUse: [
					{
						matcher: "Bash",
						hooks: [{ type: "command", command: "other tool" }],
					},
				],
			},
		});
	});

	test("treats a SessionEnd-only install as enabled", () => {
		const settingsPath = join(tempRoot, "legacy-enabled", "settings.json");
		writeSettings(settingsPath, {
			hooks: { SessionEnd: [legacySessionEndEntry()] },
		});

		expect(isHookEnabled(settingsPath)).toBe(true);
	});

	test("does not report enabled without a SessionEnd hook", () => {
		const settingsPath = join(tempRoot, "start-only", "settings.json");
		writeSettings(settingsPath, {
			hooks: {
				SessionStart: [
					{
						matcher: "",
						hooks: [
							{
								type: "command",
								command: "rudel hooks claude session-start",
								async: true,
							},
						],
					},
				],
			},
		});

		expect(isHookEnabled(settingsPath)).toBe(false);
	});

	test("adds the missing SessionStart hook to a legacy install once", () => {
		const settingsPath = join(tempRoot, "legacy-heal", "settings.json");
		writeSettings(settingsPath, {
			theme: "dark",
			hooks: {
				SessionStart: [
					{
						matcher: "startup",
						hooks: [{ type: "command", command: "other start" }],
					},
				],
				SessionEnd: [legacySessionEndEntry()],
			},
		});

		expect(ensureSessionStartHook(settingsPath)).toBe(true);

		const healed = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(healed).toEqual({
			theme: "dark",
			hooks: {
				SessionStart: [
					{
						matcher: "startup",
						hooks: [{ type: "command", command: "other start" }],
					},
					{
						matcher: "",
						hooks: [
							{
								type: "command",
								command: "rudel hooks claude session-start",
								async: true,
							},
						],
					},
				],
				SessionEnd: [legacySessionEndEntry()],
			},
		});
		expect(isHookEnabled(settingsPath)).toBe(true);

		const healedText = readFileSync(settingsPath, "utf-8");
		expect(ensureSessionStartHook(settingsPath)).toBe(false);
		expect(readFileSync(settingsPath, "utf-8")).toBe(healedText);
	});

	test("replaces a non-async SessionStart hook while healing", () => {
		const settingsPath = join(tempRoot, "start-not-async", "settings.json");
		writeSettings(settingsPath, {
			hooks: {
				SessionStart: [
					{
						matcher: "",
						hooks: [
							{ type: "command", command: "rudel hooks claude session-start" },
						],
					},
				],
				SessionEnd: [legacySessionEndEntry()],
			},
		});

		expect(ensureSessionStartHook(settingsPath)).toBe(true);

		expect(JSON.parse(readFileSync(settingsPath, "utf-8")).hooks).toEqual({
			SessionStart: [
				{
					matcher: "",
					hooks: [
						{
							type: "command",
							command: "rudel hooks claude session-start",
							async: true,
						},
					],
				},
			],
			SessionEnd: [legacySessionEndEntry()],
		});
	});

	test("leaves settings without a SessionEnd hook untouched", () => {
		const missingPath = join(tempRoot, "never-enabled", "settings.json");
		expect(ensureSessionStartHook(missingPath)).toBe(false);
		expect(existsSync(missingPath)).toBe(false);

		const unrelatedPath = join(tempRoot, "unrelated", "settings.json");
		writeSettings(unrelatedPath, {
			hooks: {
				SessionEnd: [
					{
						matcher: "",
						hooks: [{ type: "command", command: "other end" }],
					},
				],
			},
		});
		const before = readFileSync(unrelatedPath, "utf-8");

		expect(ensureSessionStartHook(unrelatedPath)).toBe(false);
		expect(readFileSync(unrelatedPath, "utf-8")).toBe(before);
	});
});

function legacySessionEndEntry() {
	return {
		matcher: "",
		hooks: [
			{
				type: "command",
				command: "rudel hooks claude session-end",
				async: true,
			},
		],
	};
}

function writeSettings(path: string, settings: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}
