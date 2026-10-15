import { describe, expect, test } from "bun:test";
import {
	CompassSettingsSchema,
	defaultCompassSettings,
	withCompassDefaults,
} from "@rudel/api-routes";
import { frustrationState } from "../services/moments/frustration.js";
import {
	type FlagContext,
	flagsOfRun,
	isCiCheck,
	isGitRevert,
	longestFailingStreak,
	mostEditedFile,
	mostRepeatedFailingCommand,
	type RunEvidence,
	topPercentCutoff,
} from "../services/moments/moment-rules.js";
import { observationsDailyLimit } from "../services/moments/moments.service.js";
import type { StoredObservation } from "../services/moments/observation-store.js";
import {
	capBlocks,
	normalizeObservation,
} from "../services/moments/observer.js";
import {
	groupObservations,
	weeklyCounts,
} from "../services/moments/patterns.js";

function run(overrides: Partial<RunEvidence> = {}): RunEvidence {
	return {
		user_id: "u1",
		session_id: "s1",
		agent_id: "",
		turn_idx: 1,
		revision: "7",
		parser_version: 5,
		started_ms: Date.UTC(2026, 9, 1),
		start_record: 10,
		end_record: 200,
		prompt_head: "fix the login redirect",
		model: "claude-opus-5-5",
		cost_usd: 1.5,
		minutes: 12,
		compactions: 0,
		aborted: null,
		interrupted_calls: 0,
		denied_calls: 0,
		has_final_message: 1,
		next_reactions: [],
		first_edit: null,
		explore_records: [],
		result_records: [],
		failed_records: [],
		shell_calls: [],
		failed_call_ids: [],
		first_queued: null,
		edit_files: [],
		ci_calls: [],
		pending_call_ids: [],
		git_calls: [],
		apology_records: [],
		...overrides,
	};
}

const QUIET: FlagContext = {
	costCutoff: null,
	minutesCutoff: null,
	frustration: null,
};

function kinds(
	evidence: RunEvidence,
	context: Partial<FlagContext> = {},
	settings = defaultCompassSettings(),
) {
	return flagsOfRun(evidence, settings, { ...QUIET, ...context }).map(
		(flag) => flag.kind,
	);
}

describe("flags", () => {
	test("a quiet run has no flags", () => {
		expect(kinds(run())).toEqual([]);
	});

	test("searching counts the reads before the first edit, or all of them without an edit", () => {
		const reads = Array.from({ length: 16 }, (_, index) => 11 + index);
		const [flag] = flagsOfRun(
			run({ first_edit: 26, explore_records: [...reads, 40, 41] }),
			defaultCompassSettings(),
			QUIET,
		);
		expect(flag).toMatchObject({
			kind: "search_before_edit",
			spanStart: 10,
			spanEnd: 26,
			count: 15,
		});
		expect(kinds(run({ first_edit: 25, explore_records: reads }))).toEqual([]);
		expect(
			flagsOfRun(
				run({ explore_records: reads }),
				defaultCompassSettings(),
				QUIET,
			)[0],
		).toMatchObject({ count: 16, detail: "16 reads and searches, no edit" });
	});

	test("a flag turned off or set higher in settings no longer fires", () => {
		const evidence = run({
			first_edit: 30,
			explore_records: Array.from({ length: 16 }, (_, index) => 11 + index),
		});
		const off = defaultCompassSettings();
		off.flags.search_before_edit.enabled = false;
		const higher = defaultCompassSettings();
		higher.flags.search_before_edit.value = 20;
		expect(kinds(evidence, {}, off)).toEqual([]);
		expect(kinds(evidence, {}, higher)).toEqual([]);
	});

	test("expensive and long rank against the range; too few runs rank nothing", () => {
		const costs = Array.from({ length: 20 }, (_, index) => index + 1);
		expect(topPercentCutoff(costs, 10)).toBe(19);
		expect(topPercentCutoff(costs.slice(0, 19), 10)).toBeNull();
		expect(
			kinds(run({ cost_usd: 19, minutes: 5 }), {
				costCutoff: 19,
				minutesCutoff: 6,
			}),
		).toEqual(["expensive_run"]);
	});

	test("edit churn names the file edited most, from its first to its last edit", () => {
		const edits: [number, string][] = [
			[20, "src/a.ts"],
			[30, "src/b.ts"],
			[40, "src/a.ts"],
			[50, "src/a.ts"],
			[60, "src/a.ts"],
			[70, "src/a.ts"],
		];
		expect(mostEditedFile(edits)).toEqual({
			path: "src/a.ts",
			edits: 5,
			first: 20,
			last: 70,
		});
		expect(
			flagsOfRun(
				run({ edit_files: edits }),
				defaultCompassSettings(),
				QUIET,
			)[0],
		).toMatchObject({ kind: "edit_churn", detail: "src/a.ts edited 5 times" });
	});

	test("CI failed needs a failed check read that was not merely pending", () => {
		expect(isCiCheck("cd app && gh pr checks 42")).toBe(true);
		expect(isCiCheck("gh run view 123 --log")).toBe(true);
		expect(isCiCheck("gh pr view 42")).toBe(false);
		const calls: [number, string, string][] = [
			[20, "c1", "gh pr checks 42"],
			[40, "c2", "gh pr checks 42"],
		];
		expect(
			kinds(
				run({
					ci_calls: calls,
					failed_call_ids: ["c1"],
					pending_call_ids: ["c1"],
				}),
			),
		).toEqual([]);
		expect(
			kinds(
				run({
					ci_calls: calls,
					failed_call_ids: ["c1", "c2"],
					pending_call_ids: ["c1"],
				}),
			),
		).toEqual(["ci_failed"]);
	});

	test("git reverts are the commands that throw work away, not unstaging", () => {
		expect(isGitRevert("git reset --hard HEAD~1")).toBe(true);
		expect(isGitRevert("git checkout -- src/a.ts")).toBe(true);
		expect(isGitRevert("git restore src/a.ts")).toBe(true);
		expect(isGitRevert("git clean -fd")).toBe(true);
		expect(isGitRevert("git revert abc123")).toBe(true);
		expect(isGitRevert("git restore --staged src/a.ts")).toBe(false);
		expect(isGitRevert("git reset HEAD src/a.ts")).toBe(false);
		expect(isGitRevert("git checkout main")).toBe(false);
	});

	test("user frustrated fires on the negative words or on SubQ at the set percentage", () => {
		expect(kinds(run({ next_reactions: ["negative"] }))).toEqual([
			"user_frustrated",
		]);
		expect(
			kinds(run({ next_reactions: ["negative"], has_final_message: 0 })),
		).toEqual([]);
		expect(kinds(run(), { frustration: 0.7 })).toEqual(["user_frustrated"]);
		expect(kinds(run(), { frustration: 0.69 })).toEqual([]);
	});

	test("one run can carry several flags, each with its own span", () => {
		const flags = flagsOfRun(
			run({
				first_queued: 55,
				aborted: "true",
				compactions: 2,
				denied_calls: 2,
				apology_records: [80, 120],
			}),
			defaultCompassSettings(),
			QUIET,
		);
		expect(
			flags.map((flag) => [flag.kind, flag.spanStart, flag.spanEnd]),
		).toEqual([
			["denied_calls", 10, 199],
			["interrupted", 10, 199],
			["compaction", 10, 199],
			["mid_run_redirect", 10, 55],
			["model_apology", 80, 120],
		]);
	});

	test("the longest failing streak is found by record order and broken by a success", () => {
		expect(longestFailingStreak([1, 2, 3, 4, 5, 6], [1, 2, 4, 5, 6])).toEqual({
			length: 3,
			first: 4,
			last: 6,
		});
		expect(longestFailingStreak([1, 2], [])).toBeNull();
	});

	test("a repeated command needs at least two failures", () => {
		const calls = [
			[20, "a", "bun test"],
			[30, "b", "bun test"],
			[40, "c", "bun test"],
			[50, "d", "ls"],
		] as const;
		expect(
			mostRepeatedFailingCommand(calls, new Set(["a", "b"])),
		).toMatchObject({
			command: "bun test",
			runs: 3,
			failures: 2,
			first: 20,
			last: 40,
		});
		expect(mostRepeatedFailingCommand(calls, new Set(["a"]))).toBeNull();
	});
});

describe("settings", () => {
	test("stored settings keep their choices, clamp values and fill in flags added since", () => {
		const settings = withCompassDefaults({
			flags: {
				failing_streak: { enabled: false, value: 9 },
				edit_churn: { enabled: true, value: 1 },
				retired_flag: { enabled: true, value: 3 },
			},
		});
		expect(settings.flags.failing_streak).toEqual({ enabled: false, value: 9 });
		expect(settings.flags.edit_churn).toEqual({ enabled: true, value: 2 });
		expect(settings.flags.ci_failed).toEqual({ enabled: true, value: null });
		expect(withCompassDefaults("garbage")).toEqual(defaultCompassSettings());
	});

	test("a value out of range, or on a flag that takes none, is refused", () => {
		const settings = defaultCompassSettings();
		settings.flags.expensive_run.value = 0;
		expect(CompassSettingsSchema.safeParse(settings).success).toBe(false);
		const onOff = defaultCompassSettings();
		onOff.flags.git_reverted.value = 3;
		expect(CompassSettingsSchema.safeParse(onOff).success).toBe(false);
		expect(
			CompassSettingsSchema.safeParse(defaultCompassSettings()).success,
		).toBe(true);
	});
});

describe("frustration check", () => {
	test("SubQ reads the agent's last message, then the member's reply", () => {
		expect(
			frustrationState({ finalMessage: "", prompt: "still broken!!" }),
		).toBe(
			"The agent's last message before the member wrote:\n<agent>\n(the run ended without a message)\n</agent>\n\nThe member's next message:\n<member>\nstill broken!!\n</member>",
		);
	});
});

describe("observations", () => {
	test("the model's evidence is kept only near the span, at most three, clipped", () => {
		const observation = normalizeObservation(
			{
				false_positive: false,
				what_happened: "  It looped.  ",
				layer: "automated_check",
				lesson: "Add a pre-commit type check.",
				evidence: [
					{ record: 3, quote: "far before" },
					{ record: 9, quote: "x".repeat(300) },
					{ record: 12, quote: "b" },
					{ record: 14, quote: "c" },
					{ record: 15, quote: "d" },
				],
				confidence: 1.4,
			},
			{ start: 11, end: 14 },
		);
		expect(observation.whatHappened).toBe("It looped.");
		expect(observation.confidence).toBe(1);
		expect(observation.evidence.map((item) => item.record)).toEqual([
			9, 12, 14,
		]);
		expect(observation.evidence[0]?.quote).toHaveLength(200);
	});

	test("a long span keeps its first and last records and says how many were cut", () => {
		const blocks = Array.from({ length: 10 }, (_, index) =>
			`${index}`.repeat(10),
		);
		const text = capBlocks(blocks, 50);
		expect(text.startsWith("0000000000")).toBe(true);
		expect(text.endsWith("9999999999")).toBe(true);
		expect(text).toContain("[… 6 records cut for length …]");
		expect(capBlocks(["a", "b"], 50)).toBe("a\n\nb");
	});

	test("the daily limit falls back to the default for anything but a non-negative integer", () => {
		expect(observationsDailyLimit("25")).toBe(25);
		expect(observationsDailyLimit("0")).toBe(0);
		expect(observationsDailyLimit("-1")).toBe(100);
		expect(observationsDailyLimit("lots")).toBe(100);
		expect(observationsDailyLimit(undefined)).toBe(100);
	});
});

function stored(
	id: string,
	layer: StoredObservation["layer"],
	lesson: string,
	runStartedAt: string,
): StoredObservation {
	return {
		id,
		layer,
		whatHappened: lesson,
		lesson,
		evidence: [],
		confidence: 0.8,
		falsePositive: false,
		model: "m",
		createdAt: runStartedAt,
		feedback: { useful: 0, notUseful: 0, mine: null },
		runStartedAt,
		userId: "u1",
		sessionId: `s-${id}`,
		agentId: "",
		turn: 1,
	};
}

describe("patterns", () => {
	test("observations saying the same thing group within a layer, never across layers", () => {
		const groups = groupObservations([
			stored(
				"a",
				"navigation",
				"Point CLAUDE.md at packages/ch-schema migrations",
				"2026-10-01T00:00:00Z",
			),
			stored(
				"b",
				"navigation",
				"Add a CLAUDE.md pointer to packages/ch-schema migrations",
				"2026-10-02T00:00:00Z",
			),
			stored(
				"c",
				"automated_check",
				"Point CLAUDE.md at packages/ch-schema migrations",
				"2026-10-03T00:00:00Z",
			),
			stored(
				"d",
				"navigation",
				"Run biome before pushing frontend changes",
				"2026-10-04T00:00:00Z",
			),
		]);
		expect(
			groups.map((group) => group.members.map((member) => member.id)),
		).toEqual([["a", "b"], ["c"], ["d"]]);
	});

	test("weekly counts cover every week of the range, quiet weeks as zero", () => {
		expect(
			weeklyCounts(
				[
					{ runStartedAt: "2026-10-01T10:00:00Z" },
					{ runStartedAt: "2026-10-04T10:00:00Z" },
					{ runStartedAt: "2026-10-14T10:00:00Z" },
				],
				{ startDate: "2026-09-30", endDate: "2026-10-15" },
			),
		).toEqual([
			{ week: "2026-09-28", count: 2 },
			{ week: "2026-10-05", count: 0 },
			{ week: "2026-10-12", count: 1 },
		]);
	});
});
