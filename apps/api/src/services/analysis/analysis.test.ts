import { describe, expect, test } from "bun:test";
import {
	CLASSIFIER_VERSION,
	classifyFailure,
	errorLine,
	normalize,
} from "./failure-classifier.js";
import {
	nextPromptReaction,
	originRef,
	promptReaction,
	reactionEvents,
} from "./reactions.js";
import {
	buildFailedResultsStatement,
	buildLastAssistantRecordStatement,
	buildLastEditStatement,
	buildPromptHeadStatement,
} from "./read-queries.js";
import { buildRunFactsStatement } from "./run-queries.js";
import {
	buildFailureScanStatement,
	buildOpeningPromptsStatement,
	buildTextScanStatement,
	type TextRow,
} from "./scan-queries.js";
import { batchByRecords } from "./scope.js";
import { isAnalysisWorkLimit } from "./sql.js";

describe("failure classifier v1", () => {
	const cases = [
		["ENOSPC", "bun test", "disk exhaustion", "environment"],
		[
			"cannot install or download packages",
			"bun install",
			"hook: package policy blocked an install",
			"friction",
		],
		[
			"FAIL blocked",
			"pkg-review package",
			"package review rejected",
			"friction",
		],
		[
			"PreToolUse hook error: [/repo/check.sh]",
			"bun test",
			"hook: blocked by a hook",
			"friction",
		],
		[
			"Projects (classic) is being deprecated",
			"gh pr edit",
			"gh pr edit fails on GitHub's Projects (classic) deprecation",
			"friction",
		],
		[
			"zsh:1: no matches found: app/[slug]",
			"cat app/[slug]",
			"unquoted path with [brackets] or ? expanded by zsh",
			"mistake",
		],
		[
			"Unsupported engine requires node",
			"fnm use",
			"Node version mismatch / version-manager setup",
			"environment",
		],
		[
			"Unknown process id",
			"poll 12",
			"polled a process that already exited",
			"mistake",
		],
		[
			"Invalid tool parameters",
			"",
			"tool called with invalid parameters",
			"mistake",
		],
		[
			"Failed to find expected lines in app.ts",
			"",
			"stale patch: expected lines not in file",
			"mistake",
		],
		[
			"File has been modified since read",
			"",
			"stale edit: file changed since it was read",
			"mistake",
		],
		["apply_patch verification failed", "", "invalid patch", "mistake"],
		[
			"read-only variable: status",
			"status=0",
			"zsh reserved status variable",
			"mistake",
		],
		[
			"ERR_AMBIGUOUS_MODULE_SYNTAX",
			"node script",
			"ambiguous require / top-level-await module syntax",
			"mistake",
		],
		[
			"unsettled top-level await",
			"node script",
			"unsettled top-level await",
			"mistake",
		],
		[
			"ModuleNotFoundError: No module named 'requests'",
			"python script",
			"Python module missing",
			"environment",
		],
		[
			"ERR_PACKAGE_PATH_NOT_EXPORTED",
			"bun run build",
			"unsupported package export",
			"environment",
		],
		[
			"error TS2688: Cannot find type definition file for 'node'",
			"tsc",
			"missing type declarations",
			"validation",
		],
		[
			"Cannot find module './generated/client'",
			"bun test",
			"generated artifact import unresolved",
			"environment",
		],
		[
			"Cannot find module './app'",
			"bun test",
			"relative source import unresolved",
			"mistake",
		],
		[
			"Cannot find package '@scope/pkg'",
			"bun test",
			"package import unresolved",
			"environment",
		],
		[
			"Cannot find module",
			"bun test",
			"import unresolved (target not retained)",
			"other",
		],
		[
			"error TS2322: Type 'one' is not assignable",
			"tsc",
			"typecheck error",
			"validation",
		],
		[
			"Property 'name' does not exist on type 'User'",
			"tsc",
			"typecheck error",
			"validation",
		],
		[
			"zsh: command not found: foo",
			"foo",
			"command not installed",
			"environment",
		],
		[
			"Unable to acquire lock",
			"next dev",
			"dev server already running",
			"environment",
		],
		[
			"ECONNREFUSED",
			"psql",
			"service not running (db / docker / dev server)",
			"environment",
		],
		[
			"ERR_CONNECTION_REFUSED",
			"playwright",
			"browser automation connection refused",
			"environment",
		],
		["401 Unauthorized", "gh api", "not authenticated", "environment"],
		["EADDRINUSE", "bun dev", "port already in use", "environment"],
		[
			"rg: unrecognized flag",
			"rg --wrong",
			"rg option / argument placement error",
			"mistake",
		],
		[
			"unknown option",
			"tool --wrong",
			"wrong command flags or subcommand",
			"mistake",
		],
		[
			"ENOENT: open 'src/missing.ts'",
			"cat src/missing.ts",
			"path does not exist",
			"mistake",
		],
		[
			"ENOENT: open 'node_modules/pkg/main.js'",
			"cat file",
			"node_modules filesystem path missing",
			"environment",
		],
		[
			"No projects matched the filters",
			"bun build",
			"wrong command flags or subcommand",
			"mistake",
		],
		[
			"Failed to write file",
			"",
			"could not write file (sandbox or path)",
			"environment",
		],
		["deadline exceeded", "bun test", "timed out", "other"],
		["TimeoutError", "playwright", "browser automation timed out", "other"],
		["HTTP 503", "curl", "HTTP request failed", "environment"],
		[
			"Traceback TypeError",
			"python <<EOF",
			"ad-hoc inline script crashed",
			"mistake",
		],
		[
			"CONFLICT",
			"git merge",
			"git refused (conflict / rejected / state)",
			"mistake",
		],
		["lint/style/useConst", "biome check", "lint rule", "validation"],
		[
			"Formatter would have printed",
			"biome check",
			"formatting not applied",
			"validation",
		],
		[
			"No tests found",
			"bun test",
			"test discovery found no tests",
			"environment",
		],
		["(fail) renders page [2ms]", "bun test", "test failed", "validation"],
		["2 problems", "eslint src", "lint rule", "validation"],
		["Build failed", "bun build", "build failed", "validation"],
		["^C", "bun dev", "long-running server stopped", "noise"],
		[
			"",
			"command -v foo",
			"probe answered 'not found' (exit 1 is the answer)",
			"noise",
		],
		[
			"Process exited with code 1",
			"rg absent",
			"search found nothing (exit 1)",
			"noise",
		],
		["", "bun run custom", "exit 1 without an error message", "other"],
		["unexpected failure", "custom", "other error", "other"],
	] as const;
	for (const [body, command, cause, kind] of cases) {
		test(`${cause}: ${body}`, () => {
			expect(
				classifyFailure({ tool: "Bash", command, body, tail: "", exitCode: 1 }),
			).toMatchObject({ cause, kind });
		});
	}
	test("priority, multiple lint ids, normalization and excerpts", () => {
		expect(CLASSIFIER_VERSION).toBe(1);
		expect(
			classifyFailure({
				tool: "Bash",
				command: "bun test",
				body: "ENOSPC\n(fail) test",
				tail: "",
				exitCode: 1,
			}).kind,
		).toBe("environment");
		expect(
			classifyFailure({
				tool: "Bash",
				command: "biome check",
				body: "lint/style/useConst\nassist/source/organizeImports\nlint/style/useConst",
				tail: "",
				exitCode: 1,
			}).ruleIds,
		).toEqual(["lint/style/useConst", "assist/source/organizeImports"]);
		expect(
			errorLine(
				"Process exited with code 1\nWall time: 1s",
				"\u001b[31merror: absent\u001b[0m",
			),
		).toBe("error: absent");
		expect(normalize("cat /Users/me/project/file.ts 123")).toBe("cat <path> N");
	});
});

test("SQL work ceilings include result overflow and structured ClickHouse types, never deadlines or query bugs", () => {
	for (const error of [
		new Error("Limit for result exceeded"),
		new Error("Memory limit for query exceeded"),
		Object.assign(new Error("result cap"), { type: "TOO_MANY_ROWS_OR_BYTES" }),
	])
		expect(isAnalysisWorkLimit(error)).toBe(true);
	for (const error of [
		new Error("analysis.find exceeded its deadline"),
		new Error("Unknown column session_id"),
		"Limit for result exceeded",
	])
		expect(isAnalysisWorkLimit(error)).toBe(false);
});

describe("reactions and origins", () => {
	test("origins remain in the same stream and never point at turn zero", () => {
		const ref = { sessionId: "session", agentId: "child", turn: 2 };
		expect(originRef(ref, "negative")).toEqual({ ...ref, turn: 1 });
		expect(originRef(ref, "swear")).toEqual({ ...ref, turn: 1 });
		expect(originRef(ref, "apology")).toEqual({ ...ref, turn: 1 });
		expect(originRef({ ...ref, turn: 1 }, "swear")).toBeNull();
		expect(originRef({ ...ref, turn: 1 }, "apology")).toEqual({
			...ref,
			turn: 1,
		});
	});

	test("prompts yield member reactions, assistant text yields apologies only", () => {
		const prompt = textRow({ text: "this is fucking broken ??", turn_idx: 3 });
		expect(reactionEvents(prompt).map((event) => event.type)).toEqual([
			"negative",
			"swear",
		]);
		expect(reactionEvents(prompt)[0]?.originRef).toEqual({
			sessionId: "session",
			agentId: "",
			turn: 2,
		});
		expect(promptReaction(prompt)).toBe("swear");
		const apology = textRow({
			kind: "assistant_text",
			text: "Sorry, you are right, I broke it.",
		});
		expect(reactionEvents(apology).map((event) => event.type)).toEqual([
			"apology",
		]);
		expect(promptReaction(apology)).toBeNull();
	});

	test("read labels the next prompt's reaction instead of returning its text", () => {
		expect(nextPromptReaction("fix this shit, it is broken again")).toBe(
			"unhappy (strongly worded)",
		);
		expect(nextPromptReaction("thanks, looks good")).toBe("no complaint found");
	});

	test("delegated tasks and injected instructions are not the user's words", () => {
		expect(
			reactionEvents(textRow({ subtype: "delegation", text: "fix this shit" })),
		).toEqual([]);
		expect(
			promptReaction(
				textRow({
					text: "<system_instruction>fuck</system_instruction>thanks",
				}),
			),
		).toBeNull();
	});
});

test("text scans bind the pinned generation and page with a keyset cursor", () => {
	const statement = buildTextScanStatement(
		{ organizationId: "org", userId: "user" },
		[{ sessionId: "session", revision: "9", parserVersion: 4 }],
		{ limit: 128, after: ["session", "", 7, 0] },
	);
	expect(statement.query_params).toMatchObject({
		organizationId: "org",
		userId: "user",
		sessionIds: ["session"],
		revisions: ["9"],
		parserVersions: [4],
		afterRecord: 7,
		limit: 128,
	});
	expect(statement.query).toContain(
		"(session_id, revision, parser_version) IN",
	);
	expect(statement.clickhouse_settings?.result_overflow_mode).toBe("throw");
});

describe("statements stay within the ClickHouse memory cap", () => {
	const scope = { organizationId: "org", userId: "user" };
	const generation = { sessionId: "session", revision: "9", parserVersion: 4 };
	const generations = [generation];
	const ref = { sessionId: "session", agentId: "", turn: 1 };
	const run = { scope, generation, ref };
	const finalScans = (query: string) =>
		query.match(/rudel\.transcript_records FINAL/gu)?.length ?? 0;

	test("run facts read each wide text column in one scan and deduplicate in one", () => {
		const statement = buildRunFactsStatement(scope, generations);
		expect(finalScans(statement.query)).toBe(1);
		const finalScan = statement.query.slice(
			statement.query.indexOf("work_records AS ("),
			statement.query.indexOf("run_facts AS ("),
		);
		expect(finalScans(finalScan)).toBe(1);
		// Results' tails are read once, by the per-call scan, whose max() a
		// duplicate row cannot change.
		expect(statement.query.match(/substringUTF8\(tail,/gu)).toHaveLength(1);
		const callScan = statement.query.slice(
			statement.query.indexOf("calls AS ("),
			statement.query.indexOf("work_records AS ("),
		);
		expect(callScan).toContain("substringUTF8(tail,");
		expect(finalScans(callScan)).toBe(0);
		expect(statement.clickhouse_settings).toMatchObject({
			remote_filesystem_read_prefetch: 0,
			max_memory_usage: "1073741824",
		});
		expect(statement.query_params).toMatchObject({
			sessionIds: ["session"],
			revisions: ["9"],
			parserVersions: [4],
		});
	});

	test("deduplicating scans filter in PREWHERE; first-row and set lookups skip FINAL", () => {
		const page = { limit: 64 };
		for (const statement of [
			buildFailureScanStatement(scope, generations, page),
			buildTextScanStatement(scope, generations, page),
		]) {
			expect(finalScans(statement.query)).toBe(1);
			expect(statement.query).toMatch(/FINAL\s+PREWHERE turn_idx >= 1 AND/u);
		}
		expect(
			finalScans(buildOpeningPromptsStatement(scope, generations, [ref]).query),
		).toBe(0);
		expect(finalScans(buildFailedResultsStatement(run, 5).query)).toBe(1);
		expect(buildFailedResultsStatement(run, 5).query).toMatch(
			/FINAL\s+PREWHERE kind = 'tool_result'/u,
		);
		for (const statement of [
			buildLastEditStatement(run),
			buildPromptHeadStatement(run, 160),
			buildLastAssistantRecordStatement(run),
		])
			expect(finalScans(statement.query)).toBe(0);
	});

	test("batches follow the receipt record counts and keep session order", () => {
		const generation = (sessionId: string, records: number) => ({
			sessionId,
			revision: "1",
			parserVersion: 4,
			records,
		});
		expect(
			batchByRecords(
				[
					generation("a", 60),
					generation("b", 40),
					generation("c", 1),
					generation("d", 250),
					generation("e", 10),
				],
				100,
			).map((batch) => batch.map((entry) => entry.sessionId)),
		).toEqual([["a", "b"], ["c"], ["d"], ["e"]]);
		expect(batchByRecords([generation("a", 5)], 100)).toEqual([
			[{ sessionId: "a", revision: "1", parserVersion: 4 }],
		]);
		expect(batchByRecords([], 100)).toEqual([]);
	});
});

function textRow(overrides: Partial<TextRow>): TextRow {
	return {
		session_id: "session",
		agent_id: "",
		record_idx: 1,
		block_idx: 0,
		turn_idx: 1,
		started_ms: 0,
		kind: "user_prompt",
		subtype: "",
		text: "",
		partial: false,
		...overrides,
	};
}
