import { describe, expect, test } from "bun:test";
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
};
/**
 * Columns read from a fact the other agent also writes, on records the column
 * does not read: Claude tool results have a duration, but only Codex tasks
 * time a run.
 */
const NARROWED: ReadonlySet<RunIndexFactColumn> = new Set(["duration_ms"]);
/** Facts the parser fixtures cannot show (a budget overflow). */
const NOT_IN_FIXTURES: ReadonlySet<RunIndexFactSource> = new Set([
	"facts_truncated",
]);
const FIXTURES: Record<TranscriptSource, string> = {
	claude_code: "claude-2.1.jsonl",
	codex: "codex-0.156.jsonl",
};

async function split(
	source: TranscriptSource,
): Promise<TranscriptRecordDraft[]> {
	const content = await Bun.file(
		new URL(
			`../../../../../packages/api-routes/src/session-transcript/__fixtures__/l1-facts/${FIXTURES[source]}`,
			import.meta.url,
		),
	).text();
	return [
		...splitSessionTranscript({
			content,
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
			const facts = gate.facts.filter((fact) => !NOT_IN_FIXTURES.has(fact));
			if (facts.length === 0) continue;
			for (const source of ["claude_code", "codex"] as const) {
				const recorded = drafts[source].some((draft) =>
					facts.some((fact) => carries(draft, fact)),
				);
				if (gate.agents.includes(source))
					expect(`${column} ${source}: ${recorded}`).toBe(
						`${column} ${source}: true`,
					);
				else if (!NARROWED.has(column))
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

	test("a parser 5 generation knows no fact column; parser 8 knows its agent's", () => {
		const all = COLUMNS.filter(
			([, gate]) => gate.rows !== "receipt" && gate.since > 1,
		).map(([column]) => column);
		const v5 = unrecordedRunIndexColumns("run", 5, "claude_code");
		for (const column of all) expect(v5).toContain(column);
		expect(unrecordedRunIndexColumns("run", 8, "claude_code")).toEqual(
			COLUMNS.filter(
				([, gate]) =>
					gate.rows !== "receipt" && !gate.agents.includes("claude_code"),
			)
				.map(([column]) => column)
				.sort(),
		);
		expect(unrecordedRunIndexColumns("receipt", 8, "codex")).toEqual([
			"api_errors",
			"cost_state",
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
			agent_version: "",
			approval_policy: "",
			denied_calls: 0,
			models: [],
			cost_state: {},
		} as unknown as Parameters<typeof gateRunIndexRow>[0];
		const gated = gateRunIndexRow(row);
		expect(gated.tool_calls).toBe(7);
		expect(gated.failed_calls).toBe(2);
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
