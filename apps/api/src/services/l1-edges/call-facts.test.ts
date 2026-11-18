import { describe, expect, test } from "bun:test";
import type { RudelRunIndexRow } from "@rudel/ch-schema/generated";
import { commandIdentityOf } from "../analysis/call-identity.js";
import { callTuple } from "./call-facts.fixtures.js";
import { callFactRows, setupKindOfPath, streamKind } from "./call-facts.js";

const session = { userId: "u1", source: "claude_code", sessionId: "s1" };
const context = {
	organizationId: "org",
	session,
	revision: "7",
	parserVersion: 15,
	indexVersion: 10,
	buildRevision: 41,
	builtAt: "2026-10-08 12:00:00.000",
	sessionDate: "2026-10-08 10:00:00.000",
	repository: "github.com/acme/app",
	setupRepository: "github.com/acme/app",
	threadSource: "",
};
const run = (overrides: Partial<RudelRunIndexRow>) =>
	({
		agent_id: "",
		turn_idx: 1,
		run_id: "run-1",
		model: "claude-opus-5-5",
		started_at: "2026-10-08 10:59:00.000",
		unrecorded_facts: [],
		...overrides,
	}) as RudelRunIndexRow;

describe("call facts of a build", () => {
	test("a call before the first prompt is kept, outside every run, with what its stream can record", () => {
		const [early, inRun] = callFactRows(
			[
				callTuple({ agent_id: "agent-a", turn_idx: 0, call_id: "a" }),
				callTuple({ agent_id: "agent-a", turn_idx: 1, call_id: "b" }),
			],
			[
				run({
					agent_id: "agent-a",
					run_id: "run-a",
					unrecorded_facts: ["timed_out_calls", "interrupted_calls"],
				}),
			],
			[],
			{ ...context, parserVersion: 11 },
		);
		expect(early).toMatchObject({
			run_id: "",
			turn_idx: 0,
			model: null,
			run_started_at: null,
			stream_kind: "subagent",
			interrupted: null,
			timed_out: null,
		});
		expect(inRun).toMatchObject({
			run_id: "run-a",
			model: "claude-opus-5-5",
			run_started_at: "2026-10-08 10:59:00.000",
			interrupted: null,
			timed_out: null,
			repository: "github.com/acme/app",
		});
	});

	test("a call names the model of the response that made it, else its run's, never the harness placeholder", () => {
		const rows = callFactRows(
			[
				callTuple({ call_id: "opus", record_idx: 4 }),
				callTuple({ call_id: "switched", record_idx: 12 }),
				callTuple({ call_id: "no-usage", record_idx: 21 }),
				callTuple({ call_id: "placeholder", turn_idx: 2, record_idx: 40 }),
				callTuple({ call_id: "nothing", turn_idx: 3, record_idx: 60 }),
			],
			[
				run({ model: "claude-opus-5-5" }),
				run({ turn_idx: 2, run_id: "run-2", model: "<synthetic>" }),
				run({ turn_idx: 3, run_id: "run-3", model: "" }),
			],
			[
				{
					agent_id: "",
					start_record: 3,
					end_record: 10,
					usage_model: "claude-opus-5-5",
				},
				{
					agent_id: "",
					start_record: 10,
					end_record: 20,
					usage_model: "claude-sonnet-5-5",
				},
				{ agent_id: "", start_record: 20, end_record: 30, usage_model: "" },
				{
					agent_id: "",
					start_record: 38,
					end_record: 45,
					usage_model: "claude-opus-5-5",
				},
				{
					agent_id: "agent-a",
					start_record: 55,
					end_record: 70,
					usage_model: "claude-haiku-5-5",
				},
			],
			context,
		);
		expect(rows.map((row) => [row.call_id, row.model])).toEqual([
			["opus", "claude-opus-5-5"],
			["switched", "claude-sonnet-5-5"],
			["no-usage", "claude-opus-5-5"],
			["placeholder", "claude-opus-5-5"],
			["nothing", null],
		]);
	});

	test("command identity is computed from the first stored copy, a cut copy naming none", () => {
		const text = "cd ~/repo && bun test x.test.ts && git push -q";
		const [row, cut] = callFactRows(
			[
				callTuple({
					command_rows: [
						[[1, 0], "command", text, ""],
						[[9, 0], "command", "ls", ""],
					],
				}),
				callTuple({
					call_id: "cut",
					command_rows: [[[2, 0], "command", null, "cd ~/repo && bun"]],
				}),
			],
			[run({})],
			[],
			context,
		);
		const identity = commandIdentityOf("command", text);
		expect(row).toMatchObject({
			command: text,
			command_chars: String(text.length),
			command_argv0: "bun",
			command_prefix: "bun test",
			command_programs: ["bun", "git"],
			command_prefixes: ["bun test", "git push"],
			command_fingerprint: identity.fingerprint,
			interrupted: 0,
			timed_out: 0,
		});
		expect(cut).toMatchObject({
			command: "cd ~/repo && bun",
			command_chars: null,
			command_argv0: null,
			command_fingerprint: null,
			command_programs: [],
		});
	});

	test("instruction and skill files a call read are named as received setup names them, once each", () => {
		const [row] = callFactRows(
			[
				callTuple({
					cwd: "/w/app",
					files_read: [
						"/w/app/AGENTS.md",
						"/w/app/src/a.ts",
						"/w/app/AGENTS.md",
						"/Users/me/.claude/skills/ship/SKILL.md",
					],
				}),
			],
			[run({})],
			[],
			context,
		);
		expect(row?.setup_files_read).toEqual([
			"repository:github.com/acme/app:AGENTS.md",
			"member:u1:~/.claude/skills/ship/SKILL.md",
		]);
		expect(row?.setup_paths_read).toEqual([
			"/w/app/AGENTS.md",
			"/Users/me/.claude/skills/ship/SKILL.md",
		]);
	});

	test("setup kinds and stream kinds", () => {
		expect(
			[
				"/a/CLAUDE.md",
				"/a/CLAUDE.local.md",
				"/a/AGENTS.override.md",
				"/a/skills/x/SKILL.md",
				"/a/.claude/rules/style.md",
				"/a/README.md",
				"/a/NOTCLAUDE.md",
			].map(setupKindOfPath),
		).toEqual([
			"instructions",
			"instructions",
			"agents_md",
			"skill_body",
			"instructions",
			null,
			null,
		]);
		expect([
			streamKind("", "claude_code", ""),
			streamKind("a", "claude_code", ""),
			streamKind("a", "codex", ""),
			streamKind("", "codex", "subagent"),
		]).toEqual(["main", "subagent", "codex_thread", "codex_thread"]);
	});
});
