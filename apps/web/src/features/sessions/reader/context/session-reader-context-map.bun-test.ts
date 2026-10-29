import { expect, test } from "bun:test";
import type { SessionReaderStep } from "../model/session-reader-run-steps";
import { getContextMap } from "./session-reader-context-map";
import { runSetupTexts } from "./session-reader-context-runs";

const step = (
	fields: Partial<SessionReaderStep> & Pick<SessionReaderStep, "kind">,
): SessionReaderStep =>
	({
		children: [],
		detail: null,
		endMs: 0,
		icon: null,
		id: Math.random().toString(),
		isError: false,
		name: "",
		nativeId: null,
		result: null,
		startMs: 0,
		text: null,
		toolEvent: null,
		...fields,
	}) as SessionReaderStep;

const chars = (count: number) => "x".repeat(count);

test("parts by file and command, fitted inside the measured whole", () => {
	const map = getContextMap({
		baseline: 20_000,
		earlier: "Earlier turns",
		prompt: chars(4_000),
		steps: [
			step({ kind: "message", text: chars(8_000) }),
			step({
				files: [{ operation: "read", path: "src/payment.ts" }],
				kind: "tool",
				name: "Read",
				result: chars(40_000),
			}),
			step({
				command: { chain: "bun test", kind: "test", lead: "bun test" },
				kind: "tool",
				name: "Bash",
				result: chars(20_000),
			}),
			step({
				command: { chain: "bun test", kind: "test", lead: "bun test" },
				kind: "tool",
				name: "Bash",
				result: chars(20_000),
			}),
			step({ endMs: 12, kind: "message", startMs: 10, text: chars(400_000) }),
		],
		until: 5,
		use: { model: null, tokens: 100_000, window: 200_000 },
	});
	expect(map?.used).toBe(100_000);
	expect(map?.window).toBe(200_000);
	const byKey = new Map(map?.parts.map((part) => [part.key, part]));
	expect(byKey.get("files:read")?.tokens).toBe(10_000);
	expect(byKey.get("program:bun")).toMatchObject({
		count: 2,
		tokens: 10_000,
	});
	expect(byKey.get("you")?.tokens).toBe(1_000);
	expect(byKey.get("model:messages")?.tokens).toBe(2_000);
	expect(byKey.get("files:read")?.kind).toBe("read");
	expect(byKey.get("system")?.tokens).toBe(20_000);
	expect(byKey.get("earlier")?.tokens).toBe(57_000);
	expect(map?.parts.reduce((sum, part) => sum + part.tokens, 0)).toBe(100_000);
});

test("estimates past the measured whole shrink to fit it", () => {
	const map = getContextMap({
		baseline: 10_000,
		earlier: null,
		prompt: null,
		steps: [step({ kind: "message", text: chars(400_000) })],
		until: null,
		use: { model: null, tokens: 50_000, window: 200_000 },
	});
	const byKey = new Map(map?.parts.map((part) => [part.key, part]));
	expect(byKey.get("model:messages")?.tokens).toBe(40_000);
	expect(byKey.get("system")?.tokens).toBe(10_000);
	expect(byKey.has("earlier")).toBe(false);
});

test("as granular as the reader: each program and file lane, the MCP servers together", () => {
	const git = (chain: string) =>
		step({
			command: { chain, kind: "git", lead: chain } as never,
			kind: "tool",
			name: "Bash",
			result: chars(4_000),
		});
	const map = getContextMap({
		baseline: 0,
		earlier: null,
		prompt: null,
		steps: [
			git("git status"),
			git("git diff --stat"),
			step({
				kind: "tool",
				name: "mcp__plugin_opaline_opaline__sql",
				result: chars(8_000),
			}),
			step({
				kind: "tool",
				name: "t3-code:preview_open",
				result: chars(4_000),
				toolEvent: {
					input: {},
					toolName: "mcp__t3-code__preview_open",
				} as unknown as SessionReaderStep["toolEvent"],
			}),
			step({
				files: [{ operation: "read", path: "a.ts" }],
				kind: "tool",
				name: "Read",
				result: chars(4_000),
			}),
			step({
				files: [{ operation: "read", path: "b.ts" }],
				kind: "tool",
				name: "Read",
				result: chars(4_000),
			}),
		],
		until: null,
		use: { model: null, tokens: 100_000, window: 200_000 },
	});
	const byKey = new Map(map?.parts.map((part) => [part.key, part]));
	expect(byKey.get("program:git")).toMatchObject({ count: 2, label: "git" });
	expect(byKey.get("mcp")).toMatchObject({ count: 2, label: "MCP" });
	expect(byKey.get("mcp")?.items?.map((item) => item.label)).toEqual([
		"opaline:sql",
		"t3-code:preview open",
	]);
	expect(byKey.get("files:read")).toMatchObject({ count: 2, files: 2 });
	expect(byKey.has("other")).toBe(false);
	expect(byKey.get("program:git")?.items?.map((item) => item.label)).toEqual([
		"git status",
		"git diff --stat",
	]);
	expect(byKey.get("files:read")?.items?.map((item) => item.label)).toEqual([
		"a.ts",
		"b.ts",
	]);
});

test("the system prompt by its setup texts, the tools the rest", () => {
	const map = getContextMap({
		baseline: 30_000,
		earlier: null,
		prompt: null,
		setup: [
			{ chars: 12_000, key: "harness:system_prompt", label: "System prompt" },
			{ chars: 4_000, key: "member:CLAUDE.md", label: "CLAUDE.md" },
		],
		steps: [],
		until: null,
		use: { model: null, tokens: 30_000, window: 200_000 },
	});
	const byKey = new Map(map?.parts.map((part) => [part.key, part]));
	expect(byKey.get("setup:harness:system_prompt")?.tokens).toBe(3_000);
	expect(byKey.get("setup:member:CLAUDE.md")?.tokens).toBe(1_000);
	expect(byKey.get("system")).toMatchObject({
		label: "Tool definitions & the rest",
		tokens: 26_000,
	});
});

test("the setup texts a run received: the main run's by its start", () => {
	const file = (
		setupFile: string,
		kind: string,
		scope: string,
		path: string,
	) => ({
		chars: 400,
		firstAt: "",
		kind,
		owner: "posthog",
		path,
		runs: 1,
		scope,
		setupFile,
		subagents: false,
		versions: 1,
	});
	const at = "2026-10-16T09:28:16.151Z";
	const received = (setupFile: string, agentId = "") => ({
		agentId,
		carried: false,
		compacted: false,
		setupFile,
		startedAt: at,
		version: "",
		versionName: "",
	});
	const texts = runSetupTexts(
		[
			file("mcp:posthog", "mcp_instructions", "mcp", ""),
			file(
				"member:~/.claude/CLAUDE.md",
				"instructions",
				"member",
				"~/.claude/CLAUDE.md",
			),
			file("member:skill", "skill_body", "member", "skills/x/SKILL.md"),
			file("member:other", "instructions", "member", "elsewhere/AGENTS.md"),
		],
		[
			received("mcp:posthog"),
			received("member:~/.claude/CLAUDE.md"),
			received("member:skill"),
			received("member:other", "a1"),
		],
		{ agent: null, startedAt: at },
	);
	expect(texts.map((text) => text.label)).toEqual([
		"posthog MCP instructions",
		"CLAUDE.md",
	]);
});

test("earlier turns measured from the run's first call; its own parts fill the rest", () => {
	const map = getContextMap({
		baseline: 20_000,
		earlier: "Earlier turns",
		firstInput: 61_000,
		prompt: chars(4_000),
		steps: [step({ kind: "message", text: chars(36_000) })],
		until: null,
		use: { model: null, tokens: 100_000, window: 200_000 },
	});
	const byKey = new Map(map?.parts.map((part) => [part.key, part]));
	expect(byKey.get("earlier")?.tokens).toBe(40_000);
	expect(byKey.get("system")?.tokens).toBe(20_000);
	expect(map?.estimate).toEqual({ scale: 4, text: 10_000 });
	expect(byKey.get("you")?.tokens).toBe(4_000);
	expect(byKey.get("model:messages")?.tokens).toBe(36_000);
});

test("the first run: the system measured, never the leftovers", () => {
	const map = getContextMap({
		baseline: 30_000,
		earlier: null,
		prompt: null,
		steps: [step({ kind: "message", text: chars(40_000) })],
		until: null,
		use: { model: null, tokens: 100_000, window: 200_000 },
	});
	const byKey = new Map(map?.parts.map((part) => [part.key, part]));
	expect(byKey.get("system")?.tokens).toBe(30_000);
	expect(byKey.get("model:messages")?.tokens).toBe(70_000);
});

test("the session's prompts: each one listed, together one part", () => {
	const map = getContextMap({
		baseline: 0,
		earlier: null,
		prompt: [chars(4_000), `fix it\n${chars(3_996)}`],
		steps: [],
		until: null,
		use: { model: null, tokens: 2_000, window: 200_000 },
	});
	const you = map?.parts.find((part) => part.key === "you");
	expect(you).toMatchObject({ count: 2, label: "Your prompts", tokens: 2_000 });
	expect(you?.items?.map((item) => item.tokens)).toEqual([1_000, 1_000]);
	expect(you?.items?.[1]?.label).toBe("fix it");
});

test("a command touching files is its files', however many: what it did most", () => {
	const map = getContextMap({
		baseline: 0,
		earlier: null,
		prompt: null,
		steps: [
			step({
				command: {
					chain: "python3 - <<'EOF'",
					kind: "script",
					lead: "python3 -",
				},
				files: [
					{ operation: "read", path: "src/a.ts" },
					{ operation: "edit", path: "src/b.ts" },
					{ operation: "edit", path: "src/c.ts" },
				],
				kind: "tool",
				name: "Bash",
				result: chars(8_000),
			}),
			step({
				command: { chain: "cat d.ts e.ts", kind: "read", lead: "cat d.ts" },
				files: [
					{ operation: "read", path: "d.ts" },
					{ operation: "read", path: "e.ts" },
				],
				kind: "tool",
				name: "Bash",
				result: chars(4_000),
			}),
		],
		until: null,
		use: { model: null, tokens: 100_000, window: 200_000 },
	});
	const byKey = new Map(map?.parts.map((part) => [part.key, part]));
	expect(byKey.has("program:python3")).toBe(false);
	expect(byKey.has("program:cat")).toBe(false);
	expect(byKey.get("files:edit")).toMatchObject({ count: 1, files: 2 });
	expect(byKey.get("files:read")).toMatchObject({ count: 1, files: 2 });
	const edited = byKey.get("files:edit")?.items ?? [];
	expect(edited.map((item) => item.label).sort()).toEqual([
		"src/b.ts",
		"src/c.ts",
	]);
	expect(edited[0]?.tokens).toBe(edited[1]?.tokens);
	expect(map?.trail.find((each) => each.key === "files:edit")?.items).toEqual([
		"src/b.ts",
		"src/c.ts",
	]);
});

test("the harness's tools by what they're for, each a thing in its group", () => {
	const tool = (name: string) =>
		step({
			kind: "tool",
			name,
			result: chars(400),
			toolEvent: {
				input: {},
				toolName: name,
			} as unknown as SessionReaderStep["toolEvent"],
		});
	const map = getContextMap({
		baseline: 0,
		earlier: null,
		prompt: null,
		steps: [
			tool("SendMessage"),
			tool("ListAgents"),
			tool("TaskStop"),
			tool("TodoWrite"),
			step({
				command: { chain: "sleep", kind: "wait", lead: "sleep 30" },
				kind: "tool",
				name: "Bash",
				result: chars(400),
			}),
			tool("Monitor"),
		],
		until: null,
		use: { model: null, tokens: 100_000, window: 200_000 },
	});
	const byKey = new Map(map?.parts.map((part) => [part.key, part]));
	expect(byKey.get("tools:agents")).toMatchObject({
		count: 1,
		label: "Background control",
	});
	expect(
		byKey
			.get("agents")
			?.items?.map((item) => item.label)
			.sort(),
	).toEqual(["ListAgents", "SendMessage"]);
	expect(byKey.get("tools:plan")?.label).toBe("Plans & todos");
	expect(byKey.get("tools:wait")).toMatchObject({ count: 2, label: "Waiting" });
	expect([...byKey.keys()].some((key) => key.startsWith("tool:"))).toBe(false);
});

test("earlier turns read: what came before, part by part, as measured", () => {
	const map = getContextMap({
		baseline: 20_000,
		earlier: "Earlier turns",
		earlierRuns: {
			prompts: [chars(4_000)],
			steps: [
				step({ kind: "message", text: chars(400_000) }),
				step({ harness: "compaction", kind: "tool", name: "compact" }),
				step({
					files: [{ operation: "read", path: "src/payment.ts" }],
					kind: "tool",
					name: "Read",
					result: chars(12_000),
				}),
				step({ kind: "message", text: chars(4_000) }),
			],
		},
		firstInput: 61_000,
		prompt: chars(4_000),
		steps: [step({ kind: "message", text: chars(8_000) })],
		until: null,
		use: { model: null, tokens: 100_000, window: 200_000 },
	});
	const byKey = new Map(map?.parts.map((part) => [part.key, part]));
	expect(byKey.get("earlier")).toBeUndefined();
	expect(byKey.get("earlier:files:read")).toMatchObject({
		before: "Earlier turns",
		kind: "read",
		tokens: 24_000,
	});
	expect(byKey.get("earlier:you")?.tokens).toBe(8_000);
	expect(byKey.get("earlier:model:messages")?.tokens).toBe(8_000);
	expect(byKey.get("you")?.before).toBeUndefined();
	expect(map?.parts.reduce((sum, part) => sum + part.tokens, 0)).toBe(100_000);
});

test("earlier turns not read: one block", () => {
	const map = getContextMap({
		baseline: 20_000,
		earlier: "Earlier turns",
		earlierRuns: null,
		firstInput: 61_000,
		prompt: chars(4_000),
		steps: [step({ kind: "message", text: chars(8_000) })],
		until: null,
		use: { model: null, tokens: 100_000, window: 200_000 },
	});
	const byKey = new Map(map?.parts.map((part) => [part.key, part]));
	expect(byKey.get("earlier")).toMatchObject({
		kind: "earlier",
		tokens: 40_000,
	});
});

test("the fullest call's own thinking and reply aren't in its input", () => {
	const map = getContextMap({
		baseline: 10_000,
		earlier: null,
		prompt: chars(4_000),
		steps: [
			step({ endMs: 4, kind: "thinking", startMs: 1, text: chars(4_000) }),
			step({
				endMs: 6,
				kind: "tool",
				name: "Bash",
				result: chars(4_000),
				startMs: 4,
			}),
			step({ endMs: 10, kind: "thinking", startMs: 6, text: chars(40_000) }),
			step({ endMs: 12, kind: "message", startMs: 10, text: chars(40_000) }),
		],
		until: 10,
		use: { model: null, tokens: 13_000, window: 200_000 },
	});
	const byKey = new Map(map?.parts.map((part) => [part.key, part]));
	expect(byKey.get("model:thinking")?.tokens).toBe(1_000);
	expect(byKey.get("model:messages")).toBeUndefined();
	expect(byKey.get("you")?.tokens).toBe(1_000);
});

test("what the harness put in the context has its parts", () => {
	const map = getContextMap({
		baseline: 10_000,
		earlier: null,
		prompt: chars(4_000),
		steps: [
			step({ harness: "member", kind: "tool", text: chars(4_000) }),
			step({
				harness: "notification",
				kind: "tool",
				notification: { agent: true, taskId: "a1b2c3d4e5f6", toolUseId: null },
				result: chars(4_000),
			}),
			step({
				harness: "notification",
				kind: "tool",
				notification: { agent: false, taskId: "bash-1", toolUseId: null },
				result: chars(4_000),
			}),
		],
		until: null,
		use: { model: null, tokens: 14_000, window: 200_000 },
	});
	const byKey = new Map(map?.parts.map((part) => [part.key, part]));
	expect(byKey.get("you")).toMatchObject({
		count: 2,
		label: "Your prompts",
		tokens: 2_000,
	});
	expect(byKey.get("agents")?.tokens).toBe(1_000);
	expect(byKey.get("agents")?.items?.[0]?.label).toBe("a1b2");
	expect(byKey.get("background")?.tokens).toBe(1_000);
});

test("a slash-command skill's body isn't counted again as what came before", () => {
	const map = getContextMap({
		baseline: 10_000,
		earlier: "Earlier turns",
		firstInput: 33_000,
		prompt: `${chars(4_000)}Base directory for this skill: /skills/tdd\n${chars(7_957)}`,
		steps: [],
		until: null,
		use: { model: null, tokens: 33_000, window: 200_000 },
	});
	const byKey = new Map(map?.parts.map((part) => [part.key, part]));
	expect(byKey.get("earlier")?.tokens).toBe(20_000);
	expect(byKey.get("skills")?.tokens).toBe(2_000);
});

test("setup texts measured as the run's own parts are", () => {
	const map = getContextMap({
		baseline: 30_000,
		earlier: null,
		prompt: chars(8_000),
		setup: [{ chars: 20_000, key: "user:CLAUDE.md", label: "CLAUDE.md" }],
		steps: [],
		until: null,
		use: { model: null, tokens: 34_000, window: 200_000 },
	});
	const byKey = new Map(map?.parts.map((part) => [part.key, part]));
	expect(byKey.get("setup:user:CLAUDE.md")?.tokens).toBe(10_000);
	expect(byKey.get("system")?.tokens).toBe(20_000);
});
