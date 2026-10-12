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

/**
 * What a call's command text is (find source=calls): `command` a shell
 * command (a command Codex ran inside a code-mode script is a call of its own
 * from parser 5; before that, a script that runs exactly one stands for it),
 * `script` a whole Codex code-mode script, `written` the content of a script
 * file the call wrote.
 */
export const COMMAND_FROM = ["command", "script", "written"] as const;
/** Bits two command simhashes (32 bits) may differ in to count as near-duplicates. */
export const COMMAND_SIMHASH_NEAR_BITS = 3;
const RUN_GROUP_BY = [
	"week",
	"model",
	"repository",
	"agent",
	"session",
] as const;
const CALL_GROUP_BY = [
	"commandFingerprint",
	"commandArgv0",
	"commandPrefix",
] as const;
const UInt64Schema = z
	.string()
	.regex(/^\d{1,20}$/u)
	.refine((value) => BigInt(value) <= 18_446_744_073_709_551_615n, {
		message: "must be a UInt64 in decimal",
	});

/** The find arguments without cross-field checks; Zod 4 cannot derive a partial from a refined object. */
export const AnalysisFindInputBaseSchema = z
	.object({
		source: z.enum(["runs", "tool", "user", "git", "weekly", "calls"]),
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
		/** source=calls: only calls whose command text is of this kind. */
		commandFrom: z.enum(COMMAND_FROM).optional(),
		/** source=calls: only calls whose command runs this program. */
		commandArgv0: z.string().min(1).max(200).optional(),
		/** source=calls: only calls whose command starts with these words. */
		commandPrefix: z.string().min(1).max(200).optional(),
		/** source=calls: only calls with this fingerprint (a UInt64 in decimal). */
		commandFingerprint: UInt64Schema.optional(),
		/** source=calls: only calls whose simhash is within `COMMAND_SIMHASH_NEAR_BITS` bits of this one. */
		commandSimhash: UInt64Schema.optional(),
		reaction: z
			.array(z.enum(["negative", "swear", "apology"]))
			.default(["negative", "swear", "apology"]),
		/**
		 * source=runs: `session` is one group per session, a Codex session with
		 * its subagent threads. source=weekly: `week`, `member`, `agent`.
		 * source=calls: the command identity columns.
		 */
		groupBy: z.enum([...RUN_GROUP_BY, "member", ...CALL_GROUP_BY]).optional(),
		refs: z.array(RunRefInputSchema).max(200).optional(),
		/** Absent: `findLimit` picks a default per source. */
		limit: z.number().int().min(1).max(200).optional(),
		sort: z
			.enum(["startedAt", "minutes", "costUsd", "failedCalls", "rawChars"])
			.default("startedAt"),
		/** Opaque position from a previous page's header; the other arguments must match that call. */
		cursor: z.string().min(1).max(4_096).optional(),
		/**
		 * source=git only: the events of every session that named, listed,
		 * pushed the head branch of, or created, pushed, captured or mentioned a
		 * commit of this pull request (`owner/name#number` or its GitHub URL).
		 */
		pullRequest: z.string().min(1).max(300).optional(),
		...traceInput,
	})
	.strict();

/**
 * The repository (`owner/name`) and number of a `pullRequest` argument:
 * `owner/name#133`, or a GitHub pull request URL with or without its scheme
 * (`https://github.com/owner/name/pull/133/files`). Null when it is neither.
 */
export function parsePullRequestRef(
	value: string,
): { fullName: string; number: number } | null {
	const trimmed = value.trim();
	const match =
		/^([\w.-]+)\/([\w.-]+)#(\d{1,9})$/u.exec(trimmed) ??
		/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/pulls?\/(\d{1,9})(?:[/?#].*)?$/iu.exec(
			trimmed,
		);
	if (!match) return null;
	const [, owner, name, number] = match;
	const parsed = Number(number);
	return owner && name && parsed >= 1
		? { fullName: `${owner}/${name}`, number: parsed }
		: null;
}

const WEEKLY_GROUP_BY: ReadonlySet<string> = new Set([
	"week",
	"member",
	"agent",
]);
/** Arguments that select within weeks; weekly totals are whole weeks per member and agent. */
const WEEKLY_UNSUPPORTED = [
	"latest",
	"repository",
	"model",
	"sessionId",
	"toolGroup",
	"commandClass",
	"kind",
	"cause",
	"detail",
	"refs",
] as const satisfies readonly (keyof z.infer<
	typeof AnalysisFindInputBaseSchema
>)[];

export const AnalysisFindInputSchema = AnalysisFindInputBaseSchema.superRefine(
	(input, context) => {
		if (input.from && input.to && input.from > input.to) {
			context.addIssue({
				code: "custom",
				path: ["to"],
				message: "to must be on or after from",
			});
		}
		if (
			input.groupBy &&
			!(input.source === "runs"
				? (RUN_GROUP_BY as readonly string[]).includes(input.groupBy)
				: input.source === "weekly"
					? WEEKLY_GROUP_BY.has(input.groupBy)
					: input.source === "calls" &&
						(CALL_GROUP_BY as readonly string[]).includes(input.groupBy))
		) {
			context.addIssue({
				code: "custom",
				path: ["groupBy"],
				message: `groupBy is ${RUN_GROUP_BY.join(", ")} for runs, week, member, agent for weekly and ${CALL_GROUP_BY.join(", ")} for calls`,
			});
		}
		for (const key of [
			"commandFrom",
			"commandArgv0",
			"commandPrefix",
			"commandFingerprint",
			"commandSimhash",
		] as const)
			if (input[key] !== undefined && input.source !== "calls")
				context.addIssue({
					code: "custom",
					path: [key],
					message: `${key} is only valid for source=calls`,
				});
		if (input.model !== undefined && input.source === "calls") {
			context.addIssue({
				code: "custom",
				path: ["model"],
				message:
					"model is not valid for source=calls; find the runs with source=runs model=… and pass them as refs",
			});
		}
		if (input.source === "weekly")
			for (const key of WEEKLY_UNSUPPORTED)
				if (input[key] !== undefined)
					context.addIssue({
						code: "custom",
						path: [key],
						message: `${key} is not valid for source=weekly, which sums whole weeks per member and agent`,
					});
		if (input.pullRequest !== undefined && input.source !== "git") {
			context.addIssue({
				code: "custom",
				path: ["pullRequest"],
				message: "pullRequest is only valid for source=git",
			});
		} else if (
			input.pullRequest !== undefined &&
			!parsePullRequestRef(input.pullRequest)
		) {
			context.addIssue({
				code: "custom",
				path: ["pullRequest"],
				message:
					"pullRequest must be owner/name#number or a GitHub pull request URL",
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
	/**
	 * Reads and searches whose result records that they found nothing; null
	 * where the agent version or stream cannot record it (Claude Code before
	 * parser 6 and its subagent streams).
	 */
	notFound: z.number().nullable(),
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
/** Characters of a call's command text a find result shows. */
export const CALL_COMMAND_CHARS = 300;
/**
 * One call of `find source=calls`: the command it carried and the command
 * identity derived from it. The identity columns are computed by Opaline from
 * the stored text at query time (they change with the rules for every call at
 * once); null when they do not apply or only part of the text is stored.
 */
export const AnalysisCallSchema = z.object({
	ref: RunRefSchema,
	record: z.number().int(),
	block: z.number().int(),
	at: z.string(),
	agent: z.enum(["claude_code", "codex"]),
	tool: z.string(),
	/** The file a `written` script was written to; empty otherwise. */
	filePath: z.string(),
	commandFrom: z.enum(COMMAND_FROM),
	/** The command text, its first `CALL_COMMAND_CHARS` characters (the stored head when only part of it is stored). */
	command: z.string(),
	/** Characters of the whole command text; null when only part of it is stored. */
	commandChars: z.number().int().nullable(),
	/** The program a shell command runs; null for scripts. */
	commandArgv0: z.string().nullable(),
	/** The program and its subcommand (`git push`, `gh pr`); null for scripts. */
	commandPrefix: z.string().nullable(),
	/** cityHash64 of the normalized command text, in decimal. */
	commandFingerprint: z.string().nullable(),
	/** 32-bit word-shingle simhash of the normalized text, in decimal; null under 20 words. */
	commandSimhash: z.string().nullable(),
	/** Whether the call's result was an error or a non-zero exit; null without a result. */
	failed: z.boolean().nullable(),
	exitCode: z.number().int().nullable(),
	parentSessionId: ParentSessionIdSchema,
});
const CallGroupSchema = z.object({
	key: z.string(),
	calls: z.number(),
	sessions: z.number(),
	/** Calls whose result was an error or a non-zero exit. */
	failedCalls: z.number(),
	firstSeen: z.string(),
	lastSeen: z.string(),
	/** groupBy=commandFingerprint: the normalized text it hashes, its first `CALL_COMMAND_CHARS` characters. */
	normalized: z.string().nullable(),
	/** Newest calls of up to three different command texts in the group. */
	examples: z
		.array(
			z.object({
				ref: RunRefSchema,
				record: z.number().int(),
				block: z.number().int(),
				commandFrom: z.enum(COMMAND_FROM),
				command: z.string(),
				parentSessionId: ParentSessionIdSchema,
			}),
		)
		.max(3),
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
	/**
	 * End (exclusive) of the history `ciRunCount` covers: the earliest
	 * `coveredThrough` of the repositories its runs come from, and, for links
	 * from edges, of the coverage those edges were built against; null with
	 * the count.
	 */
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
	/**
	 * Where the event's links come from: `edges` (the stored L1 edges of its
	 * session, `current` for the evidence find reads, or `frozen` after its
	 * transcript expired) or `query` (computed at query time because its
	 * session's edges are `stale` or `not_built`, or a repository it touches
	 * has none built). Absent while no session of the page has edge build
	 * records (the edge worker off), when links are not looked up (GitHub
	 * outcomes not visible) and in results stored before it existed; null in
	 * results stored while it defaulted to null.
	 */
	edges: z
		.object({
			linkedBy: z.enum(["edges", "query"]),
			status: z.enum(["current", "frozen", "stale", "not_built"]),
			/** When the session's edges were last built; null when never. */
			builtAt: z.string().nullable(),
		})
		.nullable()
		.optional(),
});
/**
 * `find pullRequest=…`: a retained edge whose evidence row cannot be shown
 * as an event, as the worker recorded it. `transcript_unavailable`: the
 * session's transcript is no longer indexed (its edges were kept);
 * `other_generation`: find reads a newer observation generation than the
 * edge came from, whose row at that place may say something else.
 */
const GitWitnessSchema = z.object({
	sessionId: z.string(),
	agentId: z.string(),
	/** The run the evidence belongs to; null for evidence of no run. */
	turn: z.number().int().nullable(),
	relation: z.string(),
	/** The literal value the edge matched (SHA, branch, PR number). */
	matchedValue: z.string(),
	at: z.string(),
	evidenceId: z.string(),
	generation: z.object({
		revision: z.string(),
		parserVersion: z.number().int(),
	}),
	reason: z.enum(["transcript_unavailable", "other_generation"]),
});
/**
 * `find source=weekly` measures that are always known: counts and sums every
 * run records (docs/l1-literal-schema.md, "Weekly totals").
 */
export const WEEKLY_MEASURES = [
	"runs",
	"sessionsStarted",
	"genuinePrompts",
	"minutes",
	"activeMinutes",
	"toolCalls",
	"failedCalls",
	"edits",
	"reads",
	"searches",
	"compactions",
	"interruptMarkers",
	"notFoundKnownRuns",
	"editOutcomesKnownRuns",
	"deniedCallsKnownRuns",
	"interruptedCallsKnownRuns",
	"timedOutCallsKnownRuns",
	"mcpCallsKnownRuns",
	"apiErrorsKnownRuns",
	"retryAttemptsKnownRuns",
	"refusalsKnownRuns",
	"abortedKnownRuns",
	"turnErrorKnownRuns",
	"gitOperationsKnownRuns",
	"prUrlsKnownRuns",
	"skillsKnownRuns",
	"slashCommandsKnownRuns",
	"subagentTypesKnownRuns",
	"usageKnownRuns",
	"usageObservations",
	"usageUnpriced",
] as const;
/**
 * Measures that can be unknown: a sum over the runs its `…KnownRuns` counts,
 * null when none of them can record it; usage sums are null without usage.
 */
export const WEEKLY_NULLABLE_MEASURES = [
	"notFound",
	"failedEdits",
	"refusedEdits",
	"deniedCalls",
	"interruptedCalls",
	"timedOutCalls",
	"mcpCalls",
	"apiErrors",
	"retryAttempts",
	"refusals",
	"abortedRuns",
	"turnErrorRuns",
	"pushRuns",
	"commitRuns",
	"prRuns",
	"commitShas",
	"prUrls",
	"skillRuns",
	"skills",
	"slashCommands",
	"subagentTypeRuns",
	"costUsd",
	"unattributedCostUsd",
	"uncachedInputTokens",
	"cacheReadInputTokens",
	"cacheWrite5mInputTokens",
	"cacheWrite1hInputTokens",
	"outputTokens",
	"reasoningOutputTokens",
] as const;
export type WeeklyMeasure =
	| (typeof WEEKLY_MEASURES)[number]
	| (typeof WEEKLY_NULLABLE_MEASURES)[number];

/**
 * One row of weekly totals: a week, member and agent, or their sums per
 * `groupBy` key (the other keys null). `sessions` counts sessions with a run
 * in the week, so it is null for a row that spans several weeks; use
 * `sessionsStarted` there.
 */
export const AnalysisWeeklyTotalsSchema = z.object({
	/** Monday (UTC) of the ISO week; null when grouped by member or agent. */
	week: z.string().nullable(),
	/** The member (user id); null when grouped by week or agent. */
	member: z.string().nullable(),
	agent: z.enum(["claude_code", "codex"]).nullable(),
	/** Weeks the row adds up. */
	weeks: z.number().int(),
	sessions: z.number().nullable(),
	...(Object.fromEntries(
		WEEKLY_MEASURES.map((name) => [name, z.number()]),
	) as Record<(typeof WEEKLY_MEASURES)[number], z.ZodNumber>),
	...(Object.fromEntries(
		WEEKLY_NULLABLE_MEASURES.map((name) => [name, z.number().nullable()]),
	) as Record<
		(typeof WEEKLY_NULLABLE_MEASURES)[number],
		z.ZodNullable<z.ZodNumber>
	>),
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
		source: z.literal("calls"),
		header: HeaderSchema,
		rows: z.array(AnalysisCallSchema),
	}),
	z.object({
		source: z.literal("calls"),
		header: HeaderSchema,
		groups: z.array(CallGroupSchema),
	}),
	z.object({
		source: z.literal("git"),
		header: HeaderSchema,
		events: z.array(AnalysisGitEventSchema),
		/** `pullRequest` only, on the first page; absent otherwise and in results stored before it existed. */
		witnesses: z.array(GitWitnessSchema).optional(),
	}),
	z.object({
		source: z.literal("weekly"),
		header: HeaderSchema,
		/** The nightly snapshot read; null before the first refresh. */
		snapshot: z.object({ id: z.string(), refreshedAt: z.string() }).nullable(),
		totals: z.array(AnalysisWeeklyTotalsSchema),
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
export type AnalysisCall = z.infer<typeof AnalysisCallSchema>;
export type AnalysisEvent = z.infer<typeof AnalysisEventSchema>;
export type AnalysisGitEvent = z.infer<typeof AnalysisGitEventSchema>;
export type AnalysisWeeklyTotals = z.infer<typeof AnalysisWeeklyTotalsSchema>;
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
