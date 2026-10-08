import { oc } from "@orpc/contract";
import { z } from "zod";

export const RunRefSchema = z
	.object({
		sessionId: z.string().min(1).max(200),
		agentId: z.string().max(200),
		turn: z.number().int().min(1).max(4_294_967_294),
	})
	.strict();

/** A ref as callers pass it: `agentId` defaults to the main transcript (`''`). */
const RunRefInputSchema = RunRefSchema.extend({
	agentId: z.string().max(200).default(""),
});

/**
 * Every find/read call belongs to an analysis, kept as a private draft until
 * it is saved. Without `analysis` a call starts a new draft; later calls pass
 * the returned id. Each call is its own step, labelled from its arguments.
 */
const traceInput = {
	analysis: z.string().min(1).max(40).optional(),
};

/** Ids under which the server stored this call. */
export const AnalysisTraceSchema = z.object({
	analysis: z.string(),
	step: z.string(),
	query: z.string(),
});

/** The find arguments without cross-field checks; Zod 4 cannot derive a partial from a refined object. */
export const AnalysisFindInputBaseSchema = z
	.object({
		source: z.enum(["runs", "tool", "user", "git"]),
		from: z.string().date().optional(),
		to: z.string().date().optional(),
		latest: z.number().int().min(1).max(200).optional(),
		repository: z.string().min(1).optional(),
		agent: z.enum(["claude_code", "codex"]).optional(),
		model: z.string().min(1).optional(),
		sessionId: z.string().min(1).max(200).optional(),
		userId: z.string().min(1).optional(),
		toolGroup: z
			.enum([
				"shell",
				"edit",
				"read",
				"search",
				"browser",
				"web",
				"mcp",
				"subagent",
				"other",
			])
			.optional(),
		commandClass: z.string().min(1).optional(),
		kind: z
			.enum([
				"friction",
				"mistake",
				"validation",
				"environment",
				"noise",
				"other",
			])
			.optional(),
		cause: z.string().min(1).optional(),
		detail: z.string().min(1).optional(),
		includeNoise: z.boolean().default(false),
		reaction: z
			.array(z.enum(["negative", "swear", "apology"]))
			.default(["negative", "swear", "apology"]),
		/** `session`: one group per session, a Codex session with its subagent threads. */
		groupBy: z
			.enum(["week", "model", "repository", "agent", "session"])
			.optional(),
		refs: z.array(RunRefInputSchema).max(200).optional(),
		/** Absent: `findLimit` picks a default per source. */
		limit: z.number().int().min(1).max(200).optional(),
		sort: z
			.enum(["startedAt", "minutes", "costUsd", "failedCalls", "rawChars"])
			.default("startedAt"),
		/** Opaque position from a previous page's header; the other arguments must match that call. */
		cursor: z.string().min(1).max(4_096).optional(),
		...traceInput,
	})
	.strict();

export const AnalysisFindInputSchema = AnalysisFindInputBaseSchema.superRefine(
	(input, context) => {
		if (input.from && input.to && input.from > input.to) {
			context.addIssue({
				code: "custom",
				path: ["to"],
				message: "to must be on or after from",
			});
		}
		if (input.groupBy && input.source !== "runs") {
			context.addIssue({
				code: "custom",
				path: ["groupBy"],
				message: "groupBy is only valid for runs",
			});
		}
	},
);

/** The read arguments without cross-field checks; Zod 4 cannot derive a partial from a refined object. */
export const AnalysisReadInputBaseSchema = z
	.object({
		refs: z.array(RunRefInputSchema).min(1).max(10),
		depth: z.enum(["exchange", "turn", "record"]).default("exchange"),
		maxChars: z.number().int().min(1).max(40_000).default(12_000),
		record: z.number().int().min(1).max(4_294_967_294).optional(),
		block: z.number().int().min(0).max(65_535).optional(),
		fromChar: z
			.number()
			.int()
			.nonnegative()
			.max(Number.MAX_SAFE_INTEGER - 1)
			.optional(),
		toChar: z
			.number()
			.int()
			.nonnegative()
			.max(Number.MAX_SAFE_INTEGER)
			.optional(),
		...traceInput,
	})
	.strict();

export const AnalysisReadInputSchema = AnalysisReadInputBaseSchema.superRefine(
	(input, context) => {
		if (
			input.depth === "record" &&
			(input.refs.length !== 1 || input.record === undefined)
		) {
			context.addIssue({
				code: "custom",
				path: ["record"],
				message: "record depth requires exactly one ref and a record index",
			});
		}
		if (
			input.depth !== "record" &&
			[input.record, input.block, input.fromChar, input.toChar].some(
				(value) => value !== undefined,
			)
		) {
			context.addIssue({
				code: "custom",
				message: "record slicing is only valid at record depth",
			});
		}
		if (input.toChar !== undefined && input.toChar <= (input.fromChar ?? 0)) {
			context.addIssue({
				code: "custom",
				path: ["toChar"],
				message: "toChar must be greater than fromChar",
			});
		}
	},
);

const ReactionSchema = z.enum(["negative", "swear", "apology"]);
/**
 * The session that spawned this one when it is a Codex subagent thread
 * (native lineage), else null. Results stored before it existed read as null.
 */
const ParentSessionIdSchema = z.string().nullable().default(null);
const HeaderSchema = z.object({
	from: z.string(),
	to: z.string(),
	sessionsInScope: z.number(),
	indexedSessions: z.number(),
	runsInScope: z.number(),
	/** Wall-clock minutes of the runs (each from its first record to its last non-meta record). */
	minutes: z.number(),
	/** Active minutes of the runs; null in results stored before it existed. */
	activeMinutes: z.number().nullable().default(null),
	pricedCostUsd: z.number(),
	unattributedCostUsd: z.number(),
	unpricedRuns: z.number(),
	rawChars: z.number(),
	truncated: z.boolean(),
	notes: z.array(z.string()),
	classifierVersion: z.number().int(),
	/** Present when more rows, groups or events follow this page. */
	cursor: z.string().optional(),
	trace: AnalysisTraceSchema.optional(),
});
export const AnalysisRunSchema = z.object({
	ref: RunRefSchema,
	startedAt: z.string(),
	/** Wall-clock span from the run's first record to its last non-meta record. */
	minutes: z.number(),
	/**
	 * Time between the run's consecutive non-meta records, each gap capped at
	 * 5 minutes (approval waits and stalls are not work); null in results
	 * stored before it existed.
	 */
	activeMinutes: z.number().nullable().default(null),
	/** Priced cost of the run; null when none of its usage could be priced. */
	costUsd: z.number().nullable(),
	/** Model of the run's latest usage (the session's model when it has none). */
	model: z.string(),
	/** Every model the run's usage was attributed to, most expensive first. */
	models: z.array(z.string()).default([]),
	repository: z.string(),
	agent: z.enum(["claude_code", "codex"]),
	promptHead: z.string().max(160),
	edits: z.number(),
	toolCalls: z.number(),
	failedCalls: z.number(),
	readCalls: z.number(),
	searchCalls: z.number(),
	notFound: z.number(),
	nextReaction: ReactionSchema.nullable(),
	rawChars: z.number(),
	parentSessionId: ParentSessionIdSchema,
	/** Subagent-thread depth below the top session: 0 top level, 1 a child, 2 a grandchild. */
	depth: z.number().int().min(0).default(0),
});
const RunGroupSchema = z.object({
	key: z.string(),
	runs: z.number(),
	sessions: z.number(),
	minutes: z.number(),
	activeMinutes: z.number().nullable().default(null),
	costUsd: z.number().nullable(),
});
const ToolGroupSchema = z.object({
	toolGroup: z.string(),
	cause: z.string(),
	detail: z.string(),
	kind: z.string(),
	count: z.number(),
	sessions: z.number(),
	firstSeen: z.string(),
	lastSeen: z.string(),
	topCommands: z.array(z.string()).max(3),
	minutes: z.number(),
	costUsd: z.number().nullable(),
	examples: z
		.array(
			z.object({
				ref: RunRefSchema,
				record: z.number(),
				errorLine: z.string(),
				parentSessionId: ParentSessionIdSchema,
			}),
		)
		.max(5),
});
export const AnalysisEventSchema = z.object({
	type: ReactionSchema,
	terms: z.array(z.string()),
	eventRef: RunRefSchema.extend({ record: z.number() }),
	quote: z.string().max(200),
	partial: z.boolean(),
	originRef: RunRefSchema.nullable(),
	originMinutes: z.number().nullable(),
	originCostUsd: z.number().nullable(),
	parentSessionId: ParentSessionIdSchema,
});
const GitRepositorySchema = z.object({
	/** Immutable GitHub repository id of the workspace's active binding. */
	id: z.string(),
	fullName: z.string(),
	/** `event`: named by the event; `session`: the session's git remote (only when the event names none); `capture`: a CLI evidence capture. */
	basis: z.enum(["event", "session", "capture"]),
	/** The literal value it was resolved from. */
	value: z.string(),
});
/**
 * Whether GitHub facts could be looked up for the event. Only `linked` and
 * `preview` were queried; for every other state, counts are null (unknown),
 * never zero.
 */
const GitHubCoverageSchema = z.object({
	status: z.enum([
		"linked",
		"preview",
		"collecting",
		"not_visible",
		"unbound",
		"not_github",
		"no_repository",
	]),
	/** Why the repository is not (yet) included in GitHub collection. */
	reason: z.string().nullable(),
	/** Earliest PR and CI times collected for the repository; older facts are unknown. */
	prFrom: z.string().nullable(),
	ciFrom: z.string().nullable(),
	/** End (exclusive) of the history the repository's collection holds without a gap; later facts are unknown. */
	coveredThrough: z.string().nullable(),
});
const GitPullRequestSchema = z.object({
	number: z.number().int(),
	/** The repository the PR lives in (the base). */
	repositoryId: z.string(),
	/** The repository its head branch lives in; differs from `repositoryId` for a fork. */
	headRepositoryId: z.string(),
	title: z.string(),
	state: z.string(),
	draft: z.boolean(),
	createdAt: z.string(),
	mergedAt: z.string().nullable(),
	closedAt: z.string().nullable(),
	headRef: z.string(),
	headSha: z.string(),
	mergeCommitSha: z.string(),
	/**
	 * Every rule that linked it: `named` by the event, `branch` (the pushed
	 * branch in the pushed repository is its head), `commit` (the resolved SHA
	 * is one of its commits), `snapshot` (GitHub listed it for the session's
	 * captured commit).
	 */
	bases: z.array(z.enum(["named", "branch", "commit", "snapshot"])),
	/** For `commit`: whether the PR's current head still contains the commit when last collected; null when unknown. */
	commitInHead: z.boolean().nullable(),
});
const GitCiRunSchema = z.object({
	repositoryId: z.string(),
	kind: z.string(),
	runId: z.string(),
	attempt: z.number().int(),
	workflow: z.string(),
	event: z.string(),
	branch: z.string(),
	headSha: z.string(),
	status: z.string(),
	conclusion: z.string().nullable(),
	createdAt: z.string(),
	/** When this attempt started (a rerun keeps the run's `createdAt`); null when not recorded. */
	startedAt: z.string().nullable(),
	completedAt: z.string().nullable(),
	/**
	 * Every connection of the run to the event: `pushed_sha` (it ran on the
	 * event's SHA), `named_run` (the event names the run), `branch` (it ran on
	 * the branch a CI check names, created in the day before the check),
	 * `pull_request` (GitHub links it to one of the event's PRs; `linkBasis`
	 * says how), `merge_commit` (it ran on the merge commit of one of the
	 * event's PRs).
	 */
	edges: z.array(
		z.object({
			basis: z.enum([
				"pushed_sha",
				"named_run",
				"branch",
				"pull_request",
				"merge_commit",
			]),
			linkBasis: z.string().nullable(),
			prNumber: z.number().int().nullable(),
		}),
	),
});
/**
 * One git or GitHub event of a session, as the transcript or a CLI evidence
 * capture recorded it, with what GitHub holds for it. Every link names the
 * rule that made it; what could not be looked up is null, never empty.
 */
export const AnalysisGitEventSchema = z.object({
	sessionId: z.string(),
	agentId: z.string(),
	/** The run the event belongs to; null before the first prompt, for captures, or when its generation is no longer indexed. */
	turn: z.number().int().nullable(),
	/** Transcript record and block; 0 for evidence captures. */
	record: z.number().int(),
	block: z.number().int(),
	call: z.string(),
	at: z.string(),
	kind: z.enum([
		"commit_created",
		"push_range",
		"pr_url",
		"mcp_pr_created",
		"ci_check",
		"codex_session_meta",
		"evidence_capture",
		"evidence_snapshot",
	]),
	/** Evidence label: `observed`, `forced_update`, `unconfirmed` (a check the command does not show ran), or a capture lifecycle (`checkpoint`, `end`). */
	label: z.string(),
	branch: z.string(),
	sourceBranch: z.string(),
	shortSha: z.string(),
	pushFrom: z.string(),
	pushTo: z.string(),
	remote: z.string(),
	prRepo: z.string(),
	prNumber: z.number().int().nullable(),
	commitHash: z.string(),
	/** Base commit of an evidence capture. */
	baseCommit: z.string(),
	/** CI run id a CI status read names. */
	runId: z.string(),
	/** The observation generation the event comes from; `current` is false when it predates the session's indexed transcript. Null for captures. */
	generation: z
		.object({
			revision: z.string(),
			parserVersion: z.number().int(),
			transcriptParserVersion: z.number().int(),
			current: z.boolean(),
		})
		.nullable(),
	repository: GitRepositorySchema.nullable(),
	github: GitHubCoverageSchema,
	/**
	 * The full SHA an abbreviated one resolves to: `value` only when exactly one
	 * collected SHA matched; `candidates` null when not looked up; `complete`
	 * false when the repository's collection is incomplete, so the match is
	 * among what was collected.
	 */
	sha: z
		.object({
			value: z.string().nullable(),
			candidates: z.number().int().nullable(),
			complete: z.boolean(),
		})
		.nullable(),
	pullRequests: z.array(GitPullRequestSchema),
	/** CI runs found for the event, newest first, at most 200 listed. */
	ciRuns: z.array(GitCiRunSchema).max(200),
	/** Runs found (a lower bound when `ciRunCount` is null). */
	ciRunsObserved: z.number().int(),
	/**
	 * The event's CI run attempts that started before `ciRunCountThrough`: set
	 * only when every target it names was looked up and the history of each
	 * target lies within the collected coverage of every repository its runs
	 * come from; null means unknown. Runs found after the boundary are listed
	 * in `ciRuns` but not counted.
	 */
	ciRunCount: z.number().int().nullable(),
	/** End (exclusive) of the history `ciRunCount` covers: the earliest `coveredThrough` of the repositories its runs come from; null with the count. */
	ciRunCountThrough: z.string().nullable(),
	/**
	 * Why `ciRunCount` is null: `github_status` (the event's repository is not
	 * fully collected, see `github.status`), `push_without_sha` (a new-branch
	 * push), `sha_unresolved` (the abbreviated SHA matched no or several
	 * commits), `no_target` (it names no SHA, run, branch or PR),
	 * `target_not_found` (a PR or run it names was not collected),
	 * `target_history_unknown` (nothing in the session records the SHA's
	 * creation, so its earlier CI may predate collection), `repository_incomplete` (a PR's base repository is not fully
	 * collected), `before_coverage` (a target's history starts before a
	 * repository's collected history: a day before the PR was created, the
	 * SHA's creation, a named run's creation, or the branch window),
	 * `after_coverage` (the event is not
	 * before a repository's `coveredThrough`), `search_capped` (a lookup hit
	 * its ceiling).
	 */
	ciRunCountUnknown: z
		.enum([
			"github_status",
			"push_without_sha",
			"sha_unresolved",
			"no_target",
			"target_not_found",
			"target_history_unknown",
			"repository_incomplete",
			"before_coverage",
			"after_coverage",
			"search_capped",
		])
		.nullable(),
	/** Conclusions of the runs found. */
	ciConclusions: z.record(z.string(), z.number().int()),
	/**
	 * For a push: CI status reads later in the same stream (`count` those that
	 * ran, `unconfirmed` those the command does not show ran) and in the same
	 * call (`sameCall`, order within the call not known).
	 */
	checksAfter: z
		.object({
			count: z.number().int(),
			unconfirmed: z.number().int(),
			sameCall: z.number().int(),
			first: z.object({ record: z.number().int(), at: z.string() }).nullable(),
		})
		.nullable(),
	parentSessionId: ParentSessionIdSchema,
});
export const AnalysisFindOutputSchema = z.union([
	z.object({
		source: z.literal("runs"),
		header: HeaderSchema,
		rows: z.array(AnalysisRunSchema),
	}),
	z.object({
		source: z.literal("runs"),
		header: HeaderSchema,
		groups: z.array(RunGroupSchema),
	}),
	z.object({
		source: z.literal("tool"),
		header: HeaderSchema,
		groups: z.array(ToolGroupSchema),
	}),
	z.object({
		source: z.literal("user"),
		header: HeaderSchema,
		events: z.array(AnalysisEventSchema),
		groups: z.array(
			z.object({
				type: ReactionSchema,
				count: z.number(),
				sessions: z.number(),
			}),
		),
	}),
	z.object({
		source: z.literal("git"),
		header: HeaderSchema,
		events: z.array(AnalysisGitEventSchema),
	}),
]);
export const AnalysisReadOutputSchema = z.object({
	maxChars: z.number().int().min(1).max(40_000).optional(),
	trace: AnalysisTraceSchema.optional(),
	truncated: z.boolean(),
	reads: z.array(
		z.object({
			ref: RunRefSchema,
			header: z.string(),
			found: z.boolean(),
			truncated: z.boolean(),
			sections: z.array(
				z.object({
					name: z.string(),
					text: z.string(),
					record: z
						.object({
							index: z.number(),
							block: z.number(),
							kind: z.string(),
							tool: z.string(),
							callId: z.string(),
							path: z.string(),
							commandClass: z.string(),
							isError: z.boolean(),
							exitCode: z.number().nullable(),
							cut: z.boolean(),
						})
						.optional(),
				}),
			),
		}),
	),
});

export type RunRef = z.infer<typeof RunRefSchema>;
export type AnalysisTrace = z.infer<typeof AnalysisTraceSchema>;
export type AnalysisFindInput = z.infer<typeof AnalysisFindInputSchema>;
export type AnalysisFindOutput = z.infer<typeof AnalysisFindOutputSchema>;
export type AnalysisRun = z.infer<typeof AnalysisRunSchema>;
export type AnalysisEvent = z.infer<typeof AnalysisEventSchema>;
export type AnalysisGitEvent = z.infer<typeof AnalysisGitEventSchema>;
export type AnalysisReadInput = z.infer<typeof AnalysisReadInputSchema>;
export type AnalysisReadOutput = z.infer<typeof AnalysisReadOutputSchema>;

/** The page size of a find call: its `limit`, or 20 tool groups, else 50. */
export function findLimit(input: Pick<AnalysisFindInput, "limit" | "source">) {
	return input.limit ?? (input.source === "tool" ? 20 : 50);
}

export const analysisContract = {
	find: oc.input(AnalysisFindInputSchema).output(AnalysisFindOutputSchema),
	read: oc.input(AnalysisReadInputSchema).output(AnalysisReadOutputSchema),
};
