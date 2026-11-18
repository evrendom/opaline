import { oc } from "@orpc/contract";
import { z } from "zod";

/**
 * Compass (CONTEXT.md "Moment"): agent runs made noticeable by flags. Most
 * flags are deterministic rules over the run index and the transcript
 * records, so they cost nothing; "User frustrated" also asks SubQ one yes/no
 * question about the member's next prompt where the workspace allows it.
 * Each flag can be turned off and its value changed per workspace
 * (`CompassSettings`). An observation is a model's structured note about one
 * noticeable run, written only on request; patterns are observations that
 * say the same thing, grouped in process. A fix recorded against a pattern
 * compares how often it happened before and after.
 */

export const MOMENT_KINDS = [
	"search_before_edit",
	"expensive_run",
	"long_run",
	"edit_churn",
	"failing_streak",
	"repeated_command",
	"ci_failed",
	"git_reverted",
	"denied_calls",
	"interrupted",
	"compaction",
	"mid_run_redirect",
	"model_apology",
	"user_frustrated",
] as const;
export const MomentKindSchema = z.enum(MOMENT_KINDS);
export type MomentKind = z.infer<typeof MomentKindSchema>;

/** A flag's editable value: what it measures and its bounds. */
export interface CompassFlagValue {
	readonly label: string;
	readonly unit: string;
	readonly defaultValue: number;
	readonly min: number;
	readonly max: number;
}

/** Every flag Compass knows, in the order Settings lists them. */
export const COMPASS_FLAGS: readonly {
	readonly kind: MomentKind;
	readonly label: string;
	readonly description: string;
	/** Null for a flag that is only on or off. */
	readonly value: CompassFlagValue | null;
}[] = [
	{
		kind: "search_before_edit",
		label: "File searches",
		description:
			"Many reads and searches before the first edit, or without any edit.",
		value: {
			label: "Reads and searches",
			unit: "calls",
			defaultValue: 15,
			min: 1,
			max: 1000,
		},
	},
	{
		kind: "expensive_run",
		label: "Expensive run",
		description: "Among the costliest runs of the range in this workspace.",
		value: {
			label: "Costliest",
			unit: "% of runs",
			defaultValue: 10,
			min: 1,
			max: 100,
		},
	},
	{
		kind: "long_run",
		label: "Long run",
		description: "Among the longest runs of the range in this workspace.",
		value: {
			label: "Longest",
			unit: "% of runs",
			defaultValue: 10,
			min: 1,
			max: 100,
		},
	},
	{
		kind: "edit_churn",
		label: "Edit churn",
		description: "The same file edited again and again in one run.",
		value: {
			label: "Edits to one file",
			unit: "edits",
			defaultValue: 5,
			min: 2,
			max: 1000,
		},
	},
	{
		kind: "failing_streak",
		label: "Failing streak",
		description: "Tool results that failed in a row.",
		value: {
			label: "Failures in a row",
			unit: "results",
			defaultValue: 4,
			min: 2,
			max: 1000,
		},
	},
	{
		kind: "repeated_command",
		label: "Repeated command",
		description:
			"The same shell command run again and again, failing at least twice.",
		value: {
			label: "Runs of one command",
			unit: "runs",
			defaultValue: 3,
			min: 2,
			max: 1000,
		},
	},
	{
		kind: "ci_failed",
		label: "CI failed",
		description:
			"The agent read CI checks that failed (gh pr checks, gh run watch or view).",
		value: null,
	},
	{
		kind: "git_reverted",
		label: "Git reverted",
		description:
			"The agent threw work away with git: revert, reset --hard, restore, checkout --, clean -f.",
		value: null,
	},
	{
		kind: "denied_calls",
		label: "Calls denied",
		description: "Tool calls the member denied.",
		value: {
			label: "Denied calls",
			unit: "calls",
			defaultValue: 2,
			min: 1,
			max: 1000,
		},
	},
	{
		kind: "interrupted",
		label: "Interrupted",
		description: "The run was aborted, or a tool call was interrupted.",
		value: null,
	},
	{
		kind: "compaction",
		label: "Context compacted",
		description: "The agent's context was compacted during the run.",
		value: null,
	},
	{
		kind: "mid_run_redirect",
		label: "Redirected mid-run",
		description:
			"The member wrote while the agent was still working (Claude Code).",
		value: null,
	},
	{
		kind: "model_apology",
		label: "Model apology",
		description:
			"The agent apologized or corrected itself (the dashboard's apology phrases).",
		value: {
			label: "Apologies",
			unit: "messages",
			defaultValue: 1,
			min: 1,
			max: 1000,
		},
	},
	{
		kind: "user_frustrated",
		label: "User frustrated",
		description:
			"The member's next prompt reads frustrated: the dashboard's negative, correcting or swear words, or SubQ answering yes where the frustration check is on.",
		value: {
			label: "SubQ says yes at",
			unit: "% or more",
			defaultValue: 70,
			min: 1,
			max: 100,
		},
	},
];

export const CompassFlagSettingSchema = z
	.object({
		enabled: z.boolean(),
		/** The flag's value; null for a flag that is only on or off. */
		value: z.number().int().nullable(),
	})
	.strict();

/** A workspace's flags: each on or off, with its value. */
export const CompassSettingsSchema = z
	.object({
		flags: z.record(MomentKindSchema, CompassFlagSettingSchema),
	})
	.strict()
	.superRefine((settings, context) => {
		for (const flag of COMPASS_FLAGS) {
			const setting = settings.flags[flag.kind];
			if (!setting) continue;
			if (flag.value === null ? setting.value !== null : setting.value === null)
				context.addIssue({
					code: "custom",
					path: ["flags", flag.kind, "value"],
					message: `${flag.label} ${flag.value === null ? "takes no value" : "needs a value"}.`,
				});
			else if (
				flag.value !== null &&
				setting.value !== null &&
				(setting.value < flag.value.min || setting.value > flag.value.max)
			)
				context.addIssue({
					code: "custom",
					path: ["flags", flag.kind, "value"],
					message: `${flag.label}: ${flag.value.min} to ${flag.value.max}.`,
				});
		}
	});
export type CompassSettings = {
	flags: Record<MomentKind, z.infer<typeof CompassFlagSettingSchema>>;
};

/** Every flag on, at its default value. */
export function defaultCompassSettings(): CompassSettings {
	return {
		flags: Object.fromEntries(
			COMPASS_FLAGS.map((flag) => [
				flag.kind,
				{ enabled: true, value: flag.value?.defaultValue ?? null },
			]),
		) as CompassSettings["flags"],
	};
}

/** Stored settings over the defaults: flags added since they were saved start on, at their defaults. */
export function withCompassDefaults(stored: unknown): CompassSettings {
	const defaults = defaultCompassSettings();
	const parsed = z
		.object({
			flags: z.record(z.string(), CompassFlagSettingSchema).optional(),
		})
		.safeParse(stored);
	if (!parsed.success || !parsed.data.flags) return defaults;
	for (const flag of COMPASS_FLAGS) {
		const setting = parsed.data.flags[flag.kind];
		if (!setting) continue;
		const value =
			flag.value === null
				? null
				: setting.value === null
					? flag.value.defaultValue
					: Math.min(flag.value.max, Math.max(flag.value.min, setting.value));
		defaults.flags[flag.kind] = { enabled: setting.enabled, value };
	}
	return defaults;
}

export const CompassSettingsViewSchema = z.object({
	settings: CompassSettingsSchema,
	/** Owners and admins of the workspace may change them. */
	canEdit: z.boolean(),
	/** Whether SubQ checks this workspace's prompts for frustration. */
	frustrationCheck: z.boolean(),
});

/** Where a fix for a run's friction would go: the agent's environment, or the engineer's own practice. */
export const MOMENT_LAYERS = [
	"navigation",
	"automated_check",
	"reviewer_rule",
	"steering_file",
	"tool_economy",
	"information_access",
	"environment_workaround",
	"prompt_spec",
	"context_handoff",
	"steering_timing",
	"task_size",
	"verification",
	"other",
] as const;
export const MomentLayerSchema = z.enum(MOMENT_LAYERS);
export type MomentLayer = z.infer<typeof MomentLayerSchema>;

/** Runs one list page returns at most. */
export const MOMENTS_MAX_LIMIT = 200;

const SessionIdSchema = z.string().min(1).max(200);

/** One run's identity: enough to find it again in its session. */
export const CompassRunRefSchema = z
	.object({
		userId: z.string().min(1).max(200),
		sessionId: SessionIdSchema,
		agentId: z.string().max(200),
		turn: z.number().int().min(1),
	})
	.strict();
export type CompassRunRef = z.infer<typeof CompassRunRefSchema>;

/** A run to observe, with the range the page showed it in (cost and duration rank against it). */
export const ObserveRunInputSchema = CompassRunRefSchema.extend({
	startDate: z.string().date(),
	endDate: z.string().date(),
}).strict();

export const MomentObservationSchema = z.object({
	id: z.string(),
	layer: MomentLayerSchema,
	/** One or two sentences: what happened in the run. */
	whatHappened: z.string(),
	/** One concrete change that would have prevented it. */
	lesson: z.string(),
	/** Records of the run that show it, with a short quote each. */
	evidence: z.array(z.object({ record: z.number().int(), quote: z.string() })),
	/** The model's confidence that this is real friction, 0 to 1. */
	confidence: z.number(),
	/** The model judged the flags not to be friction at all. */
	falsePositive: z.boolean(),
	model: z.string(),
	createdAt: z.string(),
	feedback: z.object({
		useful: z.number().int(),
		notUseful: z.number().int(),
		/** The caller's own vote, null without one. */
		mine: z.boolean().nullable(),
	}),
});
export type MomentObservation = z.infer<typeof MomentObservationSchema>;

/** One flag on a run: what it saw and where. */
export const RunFlagSchema = z.object({
	kind: MomentKindSchema,
	/** The record range it points at within the run's stream, inclusive. */
	spanStart: z.number().int(),
	spanEnd: z.number().int(),
	/** The flag's measure: searches, failures in a row, edits, percent… */
	count: z.number(),
	/** What it saw, in a few words. */
	detail: z.string(),
});
export type RunFlag = z.infer<typeof RunFlagSchema>;

/** A run at least one flag made noticeable. */
export const NoticeableRunSchema = CompassRunRefSchema.extend({
	/** Stable id of the run (its ref, joined). */
	id: z.string(),
	/** ISO time the run started. */
	startedAt: z.string(),
	prompt: z.string().nullable(),
	model: z.string().nullable(),
	costUsd: z.number().nullable(),
	minutes: z.number(),
	flags: z.array(RunFlagSchema),
	observation: MomentObservationSchema.nullable(),
});
export type NoticeableRun = z.infer<typeof NoticeableRunSchema>;

/** Most records a run's detail returns; a longer run is cut, marked. */
export const RUN_RECORDS_MAX = 1_000;
/** Characters of a record's text a run's detail returns. */
export const RUN_RECORD_TEXT_MAX_CHARS = 600;

/** One record of a run, as the run's detail shows it. */
export const RunRecordSchema = z.object({
	/** The record's line in its stream, and its block within the line. */
	record: z.number().int(),
	block: z.number().int(),
	/** ISO time, when the transcript has one. */
	at: z.string().nullable(),
	/** `transcript_records` kind and subtype: user_prompt, tool_call, tool_result… */
	kind: z.string(),
	subtype: z.string(),
	tool: z.string(),
	failed: z.boolean(),
	exitCode: z.number().int().nullable(),
	filePath: z.string(),
	fileOp: z.string(),
	/** The record's text, at most `RUN_RECORD_TEXT_MAX_CHARS`. */
	text: z.string(),
	/** The record's full length, so a cut text can say so. */
	textChars: z.number().int(),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

/** Everything Compass shows about one noticeable run. */
export const RunDetailSchema = z.object({
	run: NoticeableRunSchema,
	/** Whether the run can be observed here. */
	observable: z.boolean(),
	/** The run's records in order, without meta records. */
	records: z.array(RunRecordSchema),
	/** Whether records past `RUN_RECORDS_MAX` were left out. */
	truncated: z.boolean(),
});
export type RunDetail = z.infer<typeof RunDetailSchema>;

export const MomentsInputSchema = z
	.object({
		startDate: z.string().date(),
		endDate: z.string().date(),
		/** Only runs with one of these flags; empty or missing for every flag. */
		kinds: z.array(MomentKindSchema).max(MOMENT_KINDS.length).optional(),
		/** Only the caller's own runs. */
		mine: z.boolean().default(false),
		limit: z.number().int().min(1).max(MOMENTS_MAX_LIMIT).default(100),
		offset: z.number().int().min(0).max(10_000).default(0),
	})
	.strict();
export type MomentsInput = z.input<typeof MomentsInputSchema>;

export const MomentsSchema = z.object({
	/** Whether a run can be observed here (the workspace's switch and a configured model). */
	observable: z.boolean(),
	/** Whether SubQ's frustration answers count here. */
	frustrationCheck: z.boolean(),
	/** Runs in the range, flagged or not. */
	runs: z.number().int(),
	/** Noticeable runs with each flag, for the filter. */
	counts: z.record(MomentKindSchema, z.number().int()),
	/** Noticeable runs (of the wanted flags) per UTC day they started, oldest first. */
	days: z.array(z.object({ date: z.string(), count: z.number().int() })),
	/** Newest run first. */
	noticeable: z.array(NoticeableRunSchema),
	nextOffset: z.number().int().nullable(),
});
export type Moments = z.infer<typeof MomentsSchema>;

export const MomentFeedbackInputSchema = z
	.object({
		observationId: z.string().min(1).max(100),
		/** true useful, false not useful, null to take the vote back. */
		useful: z.boolean().nullable(),
	})
	.strict();

export const MomentPatternSchema = z.object({
	/** The observation at the centre of the pattern; stable while it stays there. */
	id: z.string(),
	layer: MomentLayerSchema,
	/** The central observation's lesson. */
	label: z.string(),
	/** The central observation's account of what happened. */
	summary: z.string(),
	observations: z.number().int(),
	runs: z.number().int(),
	members: z.number().int(),
	/** Priced cost of the runs it happened in. */
	costUsd: z.number(),
	/** Moments of the pattern per ISO week (Monday), oldest first. */
	weekly: z.array(z.object({ week: z.string(), count: z.number().int() })),
	examples: z.array(
		z.object({
			observationId: z.string(),
			userId: z.string(),
			sessionId: z.string(),
			agentId: z.string(),
			turn: z.number().int(),
			startedAt: z.string(),
			whatHappened: z.string(),
		}),
	),
	/** A fix recorded against this pattern, with how often it happened before and after (per week). */
	fix: z
		.object({
			id: z.string(),
			note: z.string(),
			createdAt: z.string(),
			beforePerWeek: z.number(),
			afterPerWeek: z.number().nullable(),
		})
		.nullable(),
});
export type MomentPattern = z.infer<typeof MomentPatternSchema>;

export const MomentPatternsInputSchema = z
	.object({
		startDate: z.string().date(),
		endDate: z.string().date(),
	})
	.strict();

export const MomentPatternsSchema = z.object({
	/** Observations in the range (real friction only) that were grouped. */
	observed: z.number().int(),
	patterns: z.array(MomentPatternSchema),
});
export type MomentPatterns = z.infer<typeof MomentPatternsSchema>;

export const RecordMomentFixInputSchema = z
	.object({
		/** The pattern (its central observation). */
		patternId: z.string().min(1).max(100),
		/** What was changed: the pointer, check, standard or habit. */
		note: z.string().trim().min(3).max(500),
		/** The range the pattern was found in, to rebuild it. */
		startDate: z.string().date(),
		endDate: z.string().date(),
	})
	.strict();

export const MomentAccessSchema = z.object({
	/** The Compass page. */
	moments: z.boolean(),
	/** Observing a run with a model. */
	observations: z.boolean(),
});

export const momentsContract = {
	access: oc.output(MomentAccessSchema),
	list: oc.input(MomentsInputSchema).output(MomentsSchema),
	run: oc.input(ObserveRunInputSchema).output(RunDetailSchema),
	observe: oc.input(ObserveRunInputSchema).output(MomentObservationSchema),
	feedback: oc
		.input(MomentFeedbackInputSchema)
		.output(MomentObservationSchema.shape.feedback),
	patterns: oc.input(MomentPatternsInputSchema).output(MomentPatternsSchema),
	recordFix: oc
		.input(RecordMomentFixInputSchema)
		.output(z.object({ id: z.string() })),
	settings: oc.output(CompassSettingsViewSchema),
	updateSettings: oc.input(CompassSettingsSchema).output(CompassSettingsSchema),
};
