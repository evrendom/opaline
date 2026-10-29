import { describe, expect, test } from "bun:test";
import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import {
	runFigures,
	sessionFigures,
	subagentFigures,
} from "./session-reader-summary-figures-model";

const words = (figures: ReturnType<typeof sessionFigures>) =>
	figures.map(({ detail, label, measure, note, value }) => ({
		detail: detail?.startsWith("Started ") ? "Started …" : detail,
		label,
		measure,
		note,
		value,
	}));

const turn = (overrides: Partial<SessionDetailTurnSummary>) =>
	({
		durationSeconds: 95,
		estimatedCost: 1.234,
		inputTokens: 120_000,
		outputTokens: 3_400,
		startedAt: "2026-10-10T10:00:00.000Z",
		turnId: "t1",
		usageCalls: [],
		...overrides,
	}) as unknown as SessionDetailTurnSummary;

describe("the summary's figures", () => {
	test("the entire session's: its runs' tokens once all are in", () => {
		const session = {
			durationMinutes: 42,
			estimatedCost: 12.5,
			inputTokens: 1,
			outputTokens: 2,
			sessionDate: "2026-10-10T10:00:00.000Z",
			totalTokens: 5_000_000,
		} as unknown as NormalizedSessionDetailOverview["session"];
		const turns = [turn({}), turn({ inputTokens: 80_000, turnId: "t2" })];
		expect(words(sessionFigures(session, turns, 2, 1))).toMatchInlineSnapshot(`
		  [
		    {
		      "detail": "200K in · 6.8K out",
		      "label": "Cost",
		      "measure": "cost",
		      "note": undefined,
		      "value": "$13",
		    },
		    {
		      "detail": "Started …",
		      "label": "Duration",
		      "measure": "time",
		      "note": undefined,
		      "value": "42m",
		    },
		    {
		      "detail": "Its model's window isn't known · 5M tokens in all",
		      "label": "Context window",
		      "measure": "context",
		      "note": undefined,
		      "value": "—",
		    },
		    {
		      "detail": "1 subagent",
		      "label": "Turns",
		      "measure": "runs",
		      "note": undefined,
		      "value": "2",
		    },
		  ]
		`);
		expect(words(sessionFigures(session, turns, 3, 2))).toMatchInlineSnapshot(`
		  [
		    {
		      "detail": "1 in · 2 out",
		      "label": "Cost",
		      "measure": "cost",
		      "note": undefined,
		      "value": "$13",
		    },
		    {
		      "detail": "Started …",
		      "label": "Duration",
		      "measure": "time",
		      "note": undefined,
		      "value": "42m",
		    },
		    {
		      "detail": "Its model's window isn't known · 5M tokens in all",
		      "label": "Context window",
		      "measure": "context",
		      "note": undefined,
		      "value": "—",
		    },
		    {
		      "detail": "2 subagents",
		      "label": "Turns",
		      "measure": "runs",
		      "note": undefined,
		      "value": "3",
		    },
		  ]
		`);
	});

	test("a run's", () => {
		expect(words(runFigures(turn({})))).toMatchInlineSnapshot(`
		  [
		    {
		      "detail": "120K in · 3.4K out",
		      "label": "Cost",
		      "measure": "cost",
		      "note": undefined,
		      "value": "$1.23",
		    },
		    {
		      "detail": "Started …",
		      "label": "Duration",
		      "measure": "time",
		      "note": undefined,
		      "value": "2m",
		    },
		    {
		      "detail": "Its model's window isn't known · 123.4K tokens in all",
		      "label": "Context window",
		      "measure": "context",
		      "note": undefined,
		      "value": "—",
		    },
		  ]
		`);
		expect(
			words(runFigures(turn({ durationSeconds: null, startedAt: null }))),
		).toMatchInlineSnapshot(`
		  [
		    {
		      "detail": "120K in · 3.4K out",
		      "label": "Cost",
		      "measure": "cost",
		      "note": undefined,
		      "value": "$1.23",
		    },
		    {
		      "detail": "",
		      "label": "Duration",
		      "measure": "time",
		      "note": undefined,
		      "value": "—",
		    },
		    {
		      "detail": "Its model's window isn't known · 123.4K tokens in all",
		      "label": "Context window",
		      "measure": "context",
		      "note": undefined,
		      "value": "—",
		    },
		  ]
		`);
	});

	test("a subagent's", () => {
		const subagent = {
			durationSeconds: 300,
			estimatedCost: 0.42,
			inputTokens: 9_000,
			model: "claude-opus-4-5",
			outputTokens: 900,
			subagentId: "a1",
			totalTokens: 9_900,
		} as unknown as NonNullable<
			NormalizedSessionDetailOverview["subagents"]
		>[number];
		expect(words(subagentFigures(subagent))).toMatchInlineSnapshot(`
		  [
		    {
		      "detail": "9K in · 900 out",
		      "label": "Cost",
		      "measure": "cost",
		      "note": undefined,
		      "value": "$0.42",
		    },
		    {
		      "detail": "From its launch to its answer",
		      "label": "Duration",
		      "measure": "time",
		      "note": undefined,
		      "value": "5m",
		    },
		    {
		      "detail": "Its model's window isn't known · 9.9K tokens in all",
		      "label": "Context window",
		      "measure": "context",
		      "note": undefined,
		      "value": "—",
		    },
		    {
		      "detail": "The model it ran on",
		      "label": "Model",
		      "measure": undefined,
		      "note": undefined,
		      "value": "Opus 4.5",
		    },
		  ]
		`);
		expect(
			words(
				subagentFigures({
					...subagent,
					durationSeconds: null,
					model: null,
				} as unknown as typeof subagent),
			),
		).toMatchInlineSnapshot(`
		  [
		    {
		      "detail": "9K in · 900 out",
		      "label": "Cost",
		      "measure": "cost",
		      "note": undefined,
		      "value": "$0.42",
		    },
		    {
		      "detail": "From its launch to its answer",
		      "label": "Duration",
		      "measure": "time",
		      "note": undefined,
		      "value": "—",
		    },
		    {
		      "detail": "Its model's window isn't known · 9.9K tokens in all",
		      "label": "Context window",
		      "measure": "context",
		      "note": undefined,
		      "value": "—",
		    },
		    {
		      "detail": "The model it ran on",
		      "label": "Model",
		      "measure": undefined,
		      "note": undefined,
		      "value": "—",
		    },
		  ]
		`);
	});
});
