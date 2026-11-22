import { describe, expect, test } from "bun:test";
import { FACT_AGENTS, FACT_CATALOG } from "@rudel/api-routes/fact-catalog";
import {
	type NO_TRANSCRIPT_RECORD_FACTS,
	splitSessionTranscript,
	TRANSCRIPT_RECORD_FACT_KEYS,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
	type TranscriptRecordDraft,
	type TranscriptSource,
} from "@rudel/api-routes/transcript-records";
import { RudelRunIndexRowSchema } from "@rudel/ch-schema/generated";
import {
	gateRunIndexRow,
	RUN_INDEX_FACT_COLUMNS,
	RUN_INDEX_NARROWED_COLUMNS,
	type RunIndexColumnGate,
	type RunIndexFactColumn,
	type RunIndexFactSource,
	unrecordedRunIndexColumns,
} from "./run-index-columns.js";

const COLUMNS = Object.entries(RUN_INDEX_FACT_COLUMNS) as [
	RunIndexFactColumn,
	RunIndexColumnGate,
][];
/** Typed fact columns arrived with parser 6. */
const TYPED_SINCE = 6;
/** Columns whose facts came later than their typed column (as in l1-facts.test.ts). */
const SINCE_OVERRIDES: Partial<Record<RunIndexFactColumn, number>> = {
	duration_ms: 7,
	refused_edits: 9,
	permission_profile: 9,
	denied_calls: 9,
};
const NARROWED: Partial<
	Record<RunIndexFactColumn, Partial<Record<TranscriptSource, string>>>
> = RUN_INDEX_NARROWED_COLUMNS;
/** Facts the parser fixtures cannot show (a budget overflow). */
const NOT_IN_FIXTURES: ReadonlySet<RunIndexFactSource> = new Set([
	"facts_truncated",
]);
const FIXTURES: Record<Exclude<TranscriptSource, "gemini">, string> = {
	claude_code: "claude-2.1.jsonl",
	codex: "codex-0.156.jsonl",
};

async function split(
	source: Exclude<TranscriptSource, "gemini">,
): Promise<TranscriptRecordDraft[]> {
	const content = await Bun.file(
		new URL(
			`../../../../../../packages/api-routes/src/session-transcript/__fixtures__/l1-facts/${FIXTURES[source]}`,
			import.meta.url,
		),
	).text();
	const v9 = await Bun.file(
		new URL(
			`../../../../../../packages/api-routes/src/session-transcript/__fixtures__/l1-facts/${source === "codex" ? "codex" : "claude"}-v9.jsonl`,
			import.meta.url,
		),
	).text();
	return [
		...splitSessionTranscript({
			content: `${content}\n${v9}`,
			sessionDate: "2026-10-01T09:00:00.000Z",
			source,
		}),
	];
}

/** Whether a draft carries a fact, typed or keyed. */
function carries(draft: TranscriptRecordDraft, fact: RunIndexFactSource) {
	if (fact in TRANSCRIPT_RECORD_FACT_KEYS)
		return (
			draft.facts.extra[fact as keyof typeof TRANSCRIPT_RECORD_FACT_KEYS] !==
			undefined
		);
	const value = draft.facts[fact as keyof typeof NO_TRANSCRIPT_RECORD_FACTS];
	return Array.isArray(value)
		? value.length > 0
		: value !== "" && value !== null;
}

describe("run index columns", () => {
	test("each column's version is the newest parser version of the facts it reads", () => {
		for (const [column, gate] of COLUMNS) {
			if (gate.facts.length === 0) continue;
			const since =
				SINCE_OVERRIDES[column] ??
				Math.max(
					...gate.facts.map((fact) =>
						fact in TRANSCRIPT_RECORD_FACT_KEYS
							? TRANSCRIPT_RECORD_FACT_KEYS[
									fact as keyof typeof TRANSCRIPT_RECORD_FACT_KEYS
								]
							: TYPED_SINCE,
					),
				);
			expect(`${column}: ${gate.since}`).toBe(`${column}: ${since}`);
			expect(gate.since).toBeLessThanOrEqual(TRANSCRIPT_RECORDS_PARSER_VERSION);
		}
	});

	test("each column names exactly the agents whose transcripts record its facts", async () => {
		const drafts = {
			claude_code: await split("claude_code"),
			codex: await split("codex"),
		};
		for (const [column, gate] of COLUMNS) {
			for (const source of ["claude_code", "codex"] as const) {
				const facts = (gate.factsBy?.[source] ?? gate.facts).filter(
					(fact) => !NOT_IN_FIXTURES.has(fact),
				);
				if (facts.length === 0) continue;
				const recorded = drafts[source].some((draft) =>
					facts.some((fact) => carries(draft, fact)),
				);
				if (gate.agents.includes(source))
					expect(`${column} ${source}: ${recorded}`).toBe(
						`${column} ${source}: true`,
					);
				else if (!NARROWED[column]?.[source])
					expect(`${column} ${source}: ${recorded}`).toBe(
						`${column} ${source}: false`,
					);
			}
		}
	});

	test("a column that can be unknown can hold unknown: NULL, or an array or map named in unrecorded_facts", () => {
		const shape = RudelRunIndexRowSchema.shape as Record<
			string,
			{ safeParse(value: unknown): { success: boolean } }
		>;
		for (const [column] of COLUMNS) {
			const schema = shape[column];
			expect(schema).toBeDefined();
			expect(
				`${column}: ${[null, [], {}].some((value) => schema?.safeParse(value).success)}`,
			).toBe(`${column}: true`);
		}
	});

	test("a parser 5 generation knows only its prompt subtypes; parser 8 knows its agent's", () => {
		const all = COLUMNS.filter(
			([, gate]) => gate.rows !== "receipt" && gate.since > 5,
		).map(([column]) => column);
		const v5 = unrecordedRunIndexColumns("run", 5, "claude_code");
		for (const column of all) expect(v5).toContain(column);
		// Parser 5 recorded queued prompts; parser 4 did not.
		expect(v5).not.toContain("prompt_subtype");
		expect(unrecordedRunIndexColumns("run", 4, "claude_code")).toContain(
			"prompt_subtype",
		);
		expect(
			unrecordedRunIndexColumns("run", 10, "claude_code", "agent-a"),
		).toContain("prompt_subtype");
		expect(unrecordedRunIndexColumns("run", 8, "claude_code")).toEqual(
			COLUMNS.filter(
				([, gate]) =>
					gate.rows !== "receipt" &&
					(!gate.agents.includes("claude_code") ||
						(gate.sinceBy?.claude_code ?? gate.since) > 8),
			)
				.map(([column]) => column)
				.sort(),
		);
		expect(unrecordedRunIndexColumns("receipt", 8, "codex")).toEqual([
			"api_errors",
			"cost_state",
			"denied_calls",
			"skills",
			"slash_commands",
			"subagent_types",
			"title",
		]);
	});

	test("gating nulls unknown scalars and keeps counts every generation has", () => {
		const row = {
			...RudelRunIndexRowSchema.partial().parse({}),
			row_kind: "run",
			source: "codex",
			parser_version: 5,
			tool_calls: 7,
			failed_calls: 2,
			not_found: 3,
			agent_version: "",
			approval_policy: "",
			denied_calls: 0,
			models: [],
			cost_state: {},
		} as unknown as Parameters<typeof gateRunIndexRow>[0];
		const gated = gateRunIndexRow(row);
		expect(gated.tool_calls).toBe(7);
		expect(gated.failed_calls).toBe(2);
		// Codex exit codes and output are in every generation, so are its not-found calls.
		expect(gated.not_found).toBe(3);
		expect(gated.unrecorded_facts).not.toContain("not_found");
		expect(gateRunIndexRow({ ...row, agent_id: "thread-2" }).not_found).toBe(3);
		expect(gated.agent_version).toBeNull();
		expect(gated.approval_policy).toBeNull();
		expect(gated.denied_calls).toBeNull();
		expect(gated.models).toEqual([]);
		expect(gated.unrecorded_facts).toContain("models");
		expect(gated.unrecorded_facts).toContain("approval_policy");
		// Receipt-only facts are no run's.
		expect(gated.unrecorded_facts).not.toContain("title");
		const current = gateRunIndexRow({
			...row,
			parser_version: TRANSCRIPT_RECORDS_PARSER_VERSION,
		});
		expect(current.approval_policy).toBe("");
		// Codex refusals are read from its output since parser 8.
		expect(current.denied_calls).toBe(0);
		expect(current.unrecorded_facts).not.toContain("denied_calls");
		expect(current.unrecorded_facts).toContain("timed_out_calls");
		expect(current.unrecorded_facts).not.toContain("approval_policy");
		const parser7 = gateRunIndexRow({ ...row, parser_version: 7 });
		expect(parser7.denied_calls).toBeNull();
		expect(parser7.unrecorded_facts).toContain("denied_calls");
	});
});

describe("run index columns on Claude Code subagent streams", () => {
	const RESULT_DETAILS: RunIndexFactColumn[] = [
		"commit_shas",
		"git_operations",
		"not_found",
		"pr_urls",
		"pushed_branches",
	];

	test("facts only toolUseResult records are unknown on a subagent stream, never 0", () => {
		const current = unrecordedRunIndexColumns(
			"run",
			TRANSCRIPT_RECORDS_PARSER_VERSION,
			"claude_code",
			"a5ab0000000000001",
		);
		for (const column of RESULT_DETAILS) expect(current).toContain(column);
		// Their denial kind, interrupt text, timeout hand-off and classifier
		// notice are in subagent transcripts too.
		for (const column of [
			"denied_calls",
			"interrupted_calls",
			"timed_out_calls",
			"refusals",
		] as const)
			expect(current).not.toContain(column);
		const main = unrecordedRunIndexColumns(
			"run",
			TRANSCRIPT_RECORDS_PARSER_VERSION,
			"claude_code",
		);
		for (const column of [
			...RESULT_DETAILS,
			"timed_out_calls",
			"refusals",
		] as const)
			expect(main).not.toContain(column);
	});

	test("a subagent stream's timeouts and refusals are known from parser 11, its interruptions from 12", () => {
		const subagent = (parserVersion: number) =>
			unrecordedRunIndexColumns(
				"run",
				parserVersion,
				"claude_code",
				"a5ab0000000000001",
			);
		expect(subagent(10)).toEqual(
			expect.arrayContaining([
				"interrupted_calls",
				"refusals",
				"timed_out_calls",
			]),
		);
		expect(subagent(11)).toContain("interrupted_calls");
		expect(subagent(11)).not.toContain("timed_out_calls");
		expect(subagent(11)).not.toContain("refusals");
		// The main stream keeps its own versions.
		expect(unrecordedRunIndexColumns("run", 10, "claude_code")).not.toContain(
			"refusals",
		);
		// Codex subagent threads are unaffected.
		expect(
			unrecordedRunIndexColumns(
				"run",
				TRANSCRIPT_RECORDS_PARSER_VERSION,
				"codex",
				"thread-2",
			),
		).not.toContain("pr_urls");
	});

	test("gating a subagent run nulls what it cannot record and keeps its counts", () => {
		const row = {
			...RudelRunIndexRowSchema.partial().parse({}),
			row_kind: "run",
			source: "claude_code",
			agent_id: "a5ab0000000000001",
			parser_version: TRANSCRIPT_RECORDS_PARSER_VERSION,
			timed_out_calls: 1,
			refusals: 1,
			interrupted_calls: 0,
			git_operations: [],
			commit_shas: [],
			pushed_branches: [],
			pr_urls: [],
			not_found: 0,
		} as unknown as Parameters<typeof gateRunIndexRow>[0];
		const gated = gateRunIndexRow(row);
		expect(gated).toMatchObject({
			timed_out_calls: 1,
			refusals: 1,
			interrupted_calls: 0,
			not_found: null,
		});
		expect(gated.unrecorded_facts).toEqual(
			expect.arrayContaining(RESULT_DETAILS),
		);
	});
});

describe("run index columns and the L1 fact catalog", () => {
	test("skills links invocation and attribution meanings, including Codex's different key", () => {
		expect(
			FACT_CATALOG.filter((entry) => entry.runIndex?.includes("skills")).map(
				(entry) => `${entry.view}/${entry.id}`,
			),
		).toEqual(["calls/attribution_skill", "calls/skill"]);
		expect(RUN_INDEX_FACT_COLUMNS.skills.factsBy?.codex).toEqual([
			"skill_components",
		]);
		expect(unrecordedRunIndexColumns("run", 8, "codex")).toContain("skills");
		expect(unrecordedRunIndexColumns("run", 9, "codex")).not.toContain(
			"skills",
		);
	});

	test("every stored semantic counterpart is read, regardless of its storage key", () => {
		const problems: string[] = [];
		for (const [column, gate] of COLUMNS) {
			for (const entry of FACT_CATALOG.filter((entry) =>
				entry.runIndex?.includes(column),
			)) {
				for (const agent of FACT_AGENTS) {
					if (
						entry.agents[agent].status === "stored" &&
						!gate.agents.includes(agent) &&
						!NARROWED[column]?.[agent]
					)
						problems.push(
							`${column}: ${entry.view}/${entry.id} stores ${agent}`,
						);
				}
			}
		}
		expect(problems).toEqual([]);
	});

	test("every column links semantic catalog facts and reads supported per-agent fields and versions", () => {
		const problems: string[] = [];
		for (const [column, gate] of COLUMNS) {
			const entries = FACT_CATALOG.filter((entry) =>
				entry.runIndex?.includes(column),
			);
			if (entries.length === 0) {
				problems.push(`${column}: named by ${entries.length} catalog entries`);
				continue;
			}
			for (const agent of FACT_AGENTS) {
				const stored = entries.flatMap((entry) => {
					const fact = entry.agents[agent];
					return fact.status === "stored" || fact.status === "wrong"
						? [fact]
						: [];
				});
				const facts = stored.flatMap((fact) => fact.stores.facts ?? []);
				const sources = gate.factsBy?.[agent] ?? gate.facts;
				const reads = sources.filter((source) => facts.includes(source));
				if (gate.agents.includes(agent)) {
					if (stored.length === 0)
						problems.push(`${column}: no linked fact is stored for ${agent}`);
					else if (
						sources.length > 0 &&
						reads.length !== sources.length &&
						column !== "failed_edits" &&
						column !== "refused_edits"
					)
						problems.push(
							`${column}: catalog does not store ${sources.join(", ")} for ${agent}`,
						);
					else if (
						sources.length > 0 &&
						Math.max(
							...reads.map((source) =>
								source in TRANSCRIPT_RECORD_FACT_KEYS
									? TRANSCRIPT_RECORD_FACT_KEYS[
											source as keyof typeof TRANSCRIPT_RECORD_FACT_KEYS
										]
									: TYPED_SINCE,
							),
						) > (gate.sinceBy?.[agent] ?? gate.since)
					)
						problems.push(
							`${column}: ${agent} sources are newer than the column's version ${gate.sinceBy?.[agent] ?? gate.since}`,
						);
				}
			}
		}
		expect(problems).toEqual([]);
	});

	test("every semantic narrowing has a reason for an excluded stored counterpart", () => {
		for (const [column, reasons] of Object.entries(NARROWED)) {
			const gate: RunIndexColumnGate =
				RUN_INDEX_FACT_COLUMNS[column as RunIndexFactColumn];
			for (const [agent, reason] of Object.entries(reasons)) {
				expect(reason.length).toBeGreaterThan(40);
				expect(gate.agents).not.toContain(agent);
				expect(
					FACT_CATALOG.some(
						(entry) =>
							entry.runIndex?.includes(column) &&
							entry.agents[agent as Exclude<TranscriptSource, "gemini">]
								.status === "stored",
					),
				).toBe(true);
			}
		}
	});

	test("every run_index column a catalog entry names exists", () => {
		const columns = new Set<string>(COLUMNS.map(([column]) => column));
		expect(
			FACT_CATALOG.flatMap((entry) => entry.runIndex ?? []).filter(
				(column) => !columns.has(column),
			),
		).toEqual([]);
	});
});
