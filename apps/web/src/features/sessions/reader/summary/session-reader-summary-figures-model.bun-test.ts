import { describe, expect, test } from "bun:test";
import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import {
	runFigures,
	sessionFigures,
	subagentFigures,
} from "./session-reader-summary-figures-model";

const words = (figures: ReturnType<typeof sessionFigures>) =>
	figures.map(({ detail, label, measure, value, valueTip }) => ({
		detail: detail?.startsWith("Started ") ? "Started …" : detail,
		label,
		measure,
		value,
		valueTip,
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
		      "value": "$13",
		      "valueTip": undefined,
		    },
		    {
		      "detail": "Started …",
		      "label": "Duration",
		      "measure": "time",
		      "value": "42m",
		      "valueTip": undefined,
		    },
		    {
		      "detail": "Its model's window isn't known · 5M tokens in all",
		      "label": "Context window",
		      "measure": "context",
		      "value": "—",
		      "valueTip": undefined,
		    },
		    {
		      "detail": "1 subagent",
		      "label": "Turns",
		      "measure": "runs",
		      "value": "2",
		      "valueTip": undefined,
		    },
		  ]
		`);
		expect(words(sessionFigures(session, turns, 3, 2))).toMatchInlineSnapshot(`
		  [
		    {
		      "detail": "1 in · 2 out",
		      "label": "Cost",
		      "measure": "cost",
		      "value": "$13",
		      "valueTip": undefined,
		    },
		    {
		      "detail": "Started …",
		      "label": "Duration",
		      "measure": "time",
		      "value": "42m",
		      "valueTip": undefined,
		    },
		    {
		      "detail": "Its model's window isn't known · 5M tokens in all",
		      "label": "Context window",
		      "measure": "context",
		      "value": "—",
		      "valueTip": undefined,
		    },
		    {
		      "detail": "2 subagents",
		      "label": "Turns",
		      "measure": "runs",
		      "value": "3",
		      "valueTip": undefined,
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
		      "value": "$1.23",
		      "valueTip": undefined,
		    },
		    {
		      "detail": "Started …",
		      "label": "Duration",
		      "measure": "time",
		      "value": "2m",
		      "valueTip": undefined,
		    },
		    {
		      "detail": "Its model's window isn't known · 123.4K tokens in all",
		      "label": "Context window",
		      "measure": "context",
		      "value": "—",
		      "valueTip": undefined,
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
		      "value": "$1.23",
		      "valueTip": undefined,
		    },
		    {
		      "detail": "",
		      "label": "Duration",
		      "measure": "time",
		      "value": "—",
		      "valueTip": undefined,
		    },
		    {
		      "detail": "Its model's window isn't known · 123.4K tokens in all",
		      "label": "Context window",
		      "measure": "context",
		      "value": "—",
		      "valueTip": undefined,
		    },
		  ]
		`);
	});

	test("a run's fill, on its percentage", () => {
		const call = {
			at: "2026-10-10T10:00:05.000Z",
			cacheCreationInputTokens: 0,
			cacheReadInputTokens: 100_000,
			contextWindow: 258_400,
			freshInputTokens: 6_000,
			model: "gpt-6-astra",
			outputTokens: 500,
		};
		const [, , context] = words(runFigures(turn({ usageCalls: [call] })));
		expect(context).toEqual({
			detail: "106K of a 258.4K window, at its fullest · 123.4K tokens in all",
			label: "Context window",
			measure: "context",
			value: "41%",
			valueTip: "106K / 258.4K",
		});
	});

	test("a run that ended before its first model call fills none of the window its session's calls had", () => {
		const aborted = turn({
			estimatedCost: null,
			inputTokens: null,
			outputTokens: null,
			turnId: "t0",
		});
		const next = turn({
			turnId: "t1",
			usageCalls: [
				{
					at: "2026-10-10T10:00:05.000Z",
					cacheCreationInputTokens: 0,
					cacheReadInputTokens: 100_000,
					contextWindow: 258_400,
					freshInputTokens: 6_000,
					model: "gpt-6-astra",
					outputTokens: 500,
				},
			],
		});
		const [, , context] = words(runFigures(aborted, [aborted, next]));
		expect(context?.value).toBe("0%");
		expect(context?.valueTip).toBe("0 / 258.4K");
	});

	test("a run that ended before its first model call", () => {
		expect(
			words(
				runFigures(
					turn({
						durationSeconds: 2.2,
						estimatedCost: null,
						inputTokens: null,
						outputTokens: null,
					}),
				),
			).map(({ detail, label, value }) => ({ detail, label, value })),
		).toEqual([
			{ detail: "No model call", label: "Cost", value: "$0.00" },
			{ detail: "Started …", label: "Duration", value: "2s" },
			{
				detail: "It ended before its first model call",
				label: "Context window",
				value: "—",
			},
		]);
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
		      "value": "$0.42",
		      "valueTip": undefined,
		    },
		    {
		      "detail": "From its launch to its answer",
		      "label": "Duration",
		      "measure": "time",
		      "value": "5m",
		      "valueTip": undefined,
		    },
		    {
		      "detail": "Its model's window isn't known · 9.9K tokens in all",
		      "label": "Context window",
		      "measure": "context",
		      "value": "—",
		      "valueTip": undefined,
		    },
		    {
		      "detail": "The model it ran on",
		      "label": "Model",
		      "measure": undefined,
		      "value": "Opus 4.5",
		      "valueTip": undefined,
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
		      "value": "$0.42",
		      "valueTip": undefined,
		    },
		    {
		      "detail": "From its launch to its answer",
		      "label": "Duration",
		      "measure": "time",
		      "value": "—",
		      "valueTip": undefined,
		    },
		    {
		      "detail": "Its model's window isn't known · 9.9K tokens in all",
		      "label": "Context window",
		      "measure": "context",
		      "value": "—",
		      "valueTip": undefined,
		    },
		    {
		      "detail": "The model it ran on",
		      "label": "Model",
		      "measure": undefined,
		      "value": "—",
		      "valueTip": undefined,
		    },
		  ]
		`);
	});
});
