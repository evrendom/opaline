import { randomBytes } from "node:crypto";
import { getLogger } from "@logtape/logtape";
import { ORPCError } from "@orpc/server";
import type {
	AnalysisChange,
	AnalysisHistoryGetOutput,
	AnalysisHistoryQueryOutput,
	AnalysisHistorySaveInput,
	AnalysisHistorySearchInput,
	AnalysisHistorySearchOutput,
	AnalysisHost,
	AnalysisScope,
	AnalysisTrace,
} from "@rudel/api-routes";
import {
	AnalysisFindInputSchema,
	AnalysisReadInputSchema,
} from "@rudel/api-routes";
import { absenceClaims, absenceWarnings } from "./absence-claims.js";
import {
	AnalysisFullError,
	AnalysisSavedError,
	loggableError,
} from "./errors.js";
import { classifyCall } from "./evidence.js";
import { citedRuns, type FindingMirror } from "./finding-impact.js";
import { followVisibility, syncVisibility } from "./finding-visibility.js";
import {
	DRAFT_RETENTION_MS,
	MAX_QUERIES_PER_ANALYSIS,
	MAX_QUERY_ARGS_BYTES,
	MAX_SESSIONS_PER_ANALYSIS,
	MAX_STEPS_PER_ANALYSIS,
} from "./limits.js";
import type {
	AnalysisLog,
	AnalysisStore,
	AnalysisViewer,
	QuerySession,
	QuerySummary,
	StoredAnalysis,
	StoredQuery,
	StoredStep,
} from "./types.js";

const logger = getLogger(["rudel", "api", "analysis-log"]);

/** Query results expire after this; shared or pinned analyses keep them longer (ADR 0001). */
const RESULT_RETENTION_MS = 90 * 86_400_000;
const SHARED_RESULT_RETENTION_MS = 365 * 86_400_000;
/** What a draft is called until save_answer gives it the asker's question. */
const UNSAVED_QUESTION = "(unsaved answer)";
/** Longest automatic step label; steps hold at most 500 characters. */
const MAX_STEP_LABEL_CHARS = 200;
/** Revisions listed with an analysis (`updatedBy`). */
const MAX_LISTED_REVISIONS = 20;

/** What save_answer answers for a saved analysis: saving is append-only. */
export function analysisAlreadySaved(id: string): string {
	return `This analysis is already saved. To revise it, save a new analysis that passes updates=${id}.`;
}

export interface RecordedCall {
	tool: "find" | "read" | "sql";
	/** The call's arguments without the trace fields. */
	args: Record<string, unknown>;
	/** The draft this call adds to; without it the call starts a new draft. */
	trace: { analysis?: string };
	output: unknown;
	outputChars: number;
	sessions: QuerySession[];
	/** Every member whose sessions the call read, shown in its output or not. */
	owners: readonly string[];
	/**
	 * sql only: whether the rows the gateway showed carry transcript text
	 * (`rowsQuote`); the stored output keeps only the rendered table. Absent
	 * reads as quoting.
	 */
	quotes?: boolean;
}

/**
 * Stores one find/read call as its own step of a draft analysis, labelled
 * from the tool and its arguments (never from free text), and returns the ids
 * the agent passes on its next call. Without `analysis` the call starts a new
 * draft. Only drafts take calls: a saved analysis never changes, so revising
 * one means a new draft saved with `updates`. Nothing the conversation said
 * is stored or embedded here; the question arrives with `save_answer`.
 */
export async function recordQuery(
	log: AnalysisLog,
	author: { workspaceId: string; userId: string; host: AnalysisHost },
	call: RecordedCall,
): Promise<AnalysisTrace> {
	const argsBytes = Buffer.byteLength(JSON.stringify(call.args));
	if (argsBytes > MAX_QUERY_ARGS_BYTES)
		throw new ORPCError("BAD_REQUEST", {
			message: `The call's arguments are ${argsBytes} bytes; an analysis keeps at most ${MAX_QUERY_ARGS_BYTES} per query, so pass fewer or shorter refs`,
		});
	const now = log.now().toISOString();
	const analysis = await resolveAnalysis(log, author, call.trace, now);
	try {
		const trace = await recordInto(log, analysis, call, now);
		return call.trace.analysis ? trace : { ...trace, started: true };
	} catch (error) {
		// Saved by a concurrent save_answer after this call picked it.
		if (error instanceof AnalysisSavedError) throw notADraft(analysis.id);
		if (!(error instanceof AnalysisFullError)) throw error;
		throw analysisFull(analysis.id, error.child);
	}
}

/** Fails with `AnalysisFullError` when the analysis has no room for the query or a new step. */
async function recordInto(
	log: AnalysisLog,
	analysis: StoredAnalysis,
	call: RecordedCall,
	now: string,
): Promise<AnalysisTrace> {
	if (analysis.queryCount >= MAX_QUERIES_PER_ANALYSIS)
		throw new AnalysisFullError("queries");
	const step = await createCallStep(log, analysis, call, now);
	const evidence = classifyCall(call);
	const query: StoredQuery = {
		id: newId("q"),
		analysisId: analysis.id,
		stepId: step.id,
		workspaceId: analysis.workspaceId,
		authorId: analysis.authorId,
		tool: call.tool,
		args: call.args,
		output: call.output,
		outputChars: call.outputChars,
		sessions: call.sessions,
		owners: [
			...new Set([
				...call.owners,
				...call.sessions.map((session) => session.ownerId),
			]),
		].sort(),
		createdAt: now,
		removed: false,
		counts: evidence.counts,
		redaction: evidence.keptArgs && {
			args: evidence.keptArgs,
			label: stepLabel(call.tool, evidence.keptArgs),
		},
	};
	await log.store.createQuery(query);
	return { analysis: analysis.id, step: step.id, query: query.id };
}

/**
 * Publishes a draft: its question as a short title, the final answer, step
 * findings and, for a revision, how each finding changed. The analysis
 * becomes finished and visible to its author (and the workspace once shared).
 * Saving is append-only: a saved analysis is refused unchanged, and a
 * revision is a new analysis that names it in `updates`.
 */
export async function saveAnalysis(
	log: AnalysisLog,
	viewer: AnalysisViewer,
	input: AnalysisHistorySaveInput,
	mirror?: FindingMirror,
	runOpened?: (since: string) => Promise<boolean>,
): Promise<{ analysis: string; status: "finished"; warnings?: string[] }> {
	if (!input.question?.trim())
		throw new ORPCError("BAD_REQUEST", {
			message:
				"question is required: the question this answer addresses, as a short title",
		});
	const analysis = await authoredAnalysis(log, viewer, input.analysis);
	if (analysis.status === "finished")
		throw new ORPCError("CONFLICT", {
			message: analysisAlreadySaved(analysis.id),
		});
	if (input.updates && analysis.updates && input.updates !== analysis.updates)
		throw new ORPCError("BAD_REQUEST", {
			message: `Analysis ${analysis.id} was started to update ${analysis.updates}; pass updates=${analysis.updates} or leave updates out`,
		});
	const updates = input.updates ?? analysis.updates;
	if (!updates && input.changes.length > 0)
		throw new ORPCError("BAD_REQUEST", {
			message:
				"changes says how findings moved against the analysis this one updates; this analysis updates none, so leave changes out or pass updates",
		});
	const [steps, queries] = await Promise.all([
		log.store.getSteps(analysis.id),
		log.store.getQueries(analysis.id),
	]);
	// Agents name a step by its step or query id from a trace line, or by its
	// exact label; accept all three.
	const stepOf = (reference: string) => {
		const id = stepIdOf(queries, reference);
		const step = steps.find(
			(candidate) => candidate.id === id || candidate.question === id.trim(),
		);
		if (!step)
			throw new ORPCError("BAD_REQUEST", {
				message: `Step "${reference}" is not part of analysis ${analysis.id}; use the step or query id from the trace line of a find or read call`,
			});
		return step;
	};
	const findings = input.findings.map(({ step, finding }) => ({
		stepId: stepOf(step).id,
		finding,
	}));
	const changes = updates
		? await revisionChanges(
				log,
				viewer,
				analysis.id,
				updates,
				findings.map(({ stepId, finding }) => ({
					step: stepOf(stepId),
					finding,
				})),
				input.changes.map((change) => ({
					...change,
					step: stepIdOf(queries, change.step),
				})),
			)
		: [];
	// One atomic write: a refused save leaves the analysis as it was.
	try {
		// Clarification steps are no longer taken from the chat; earlier
		// analyses keep theirs.
		await log.store.saveAnalysis(analysis.id, {
			findings,
			clarifications: [],
			patch: {
				status: "finished",
				question: input.question,
				finalAnswer: input.finalAnswer,
				topics: input.topics,
				updates,
				changes,
				scope: scopeOf(queries),
			},
		});
	} catch (error) {
		// A concurrent save won: nothing was written by this one.
		if (error instanceof AnalysisSavedError)
			throw new ORPCError("CONFLICT", {
				message: analysisAlreadySaved(analysis.id),
			});
		throw error;
	}
	// Search embeddings are computed only now, for the saved answer.
	await embedText(
		log,
		analysis.workspaceId,
		analysis.id,
		null,
		"question",
		input.question,
	);
	if (input.topics.length)
		await embedText(
			log,
			analysis.workspaceId,
			analysis.id,
			null,
			"topics",
			input.topics.join(", "),
		);
	if (mirror)
		await recordFindingImpact(log, mirror, viewer, analysis, findings, queries);
	const texts = [input.finalAnswer, ...input.findings.map((f) => f.finding)];
	const warnings =
		absenceClaims(texts).length > 0
			? absenceWarnings({
					finalAnswer: input.finalAnswer,
					findings: input.findings,
					calls: queries,
					runOpened: runOpened
						? await runOpened(analysis.createdAt).catch(() => false)
						: false,
				})
			: [];
	return {
		analysis: analysis.id,
		status: "finished",
		...(warnings.length ? { warnings } : {}),
	};
}

/**
 * Hands each saved finding's cited runs to finding impact: the runs its
 * step's call cites in its stored result, and the members whose runs the
 * analysis quoted. Only results the saver may read now are cited, and only
 * runs of sessions they may read now (`onlyMember`): a saver demoted since
 * the call cites nothing they can no longer open. Best effort, like
 * embeddings: the saved analysis stands when the write fails, and the
 * failure is logged.
 */
async function recordFindingImpact(
	log: AnalysisLog,
	{ impact, syncs }: FindingMirror,
	viewer: AnalysisViewer,
	analysis: StoredAnalysis,
	findings: { stepId: string; finding: string }[],
	queries: QuerySummary[],
): Promise<void> {
	try {
		const findingSteps = new Set(findings.map((item) => item.stepId));
		const now = log.now();
		const readable = new Set(
			queries
				.filter(
					(query) => unavailableReason(query, analysis, viewer, now) === null,
				)
				.map((query) => query.id),
		);
		const needed = queries.filter(
			(query) => !query.counts || findingSteps.has(query.stepId),
		);
		const stored = await Promise.all(
			needed.map((query) => log.store.getQuery(query.id)),
		);
		// Members whose deletion deletes the analysis (and these rows): those
		// a quoting query read, and those whose sessions a finding's result names.
		const quotedOwners = new Set<string>();
		for (const query of stored) {
			if (!query) continue;
			if (!query.counts)
				for (const owner of query.owners) quotedOwners.add(owner);
			if (findingSteps.has(query.stepId))
				for (const session of query.sessions) quotedOwners.add(session.ownerId);
		}
		await impact.record({
			workspaceId: analysis.workspaceId,
			analysisId: analysis.id,
			authorId: analysis.authorId,
			// As it was saved: a draft is never shared.
			visibility: {
				shared: analysis.shared,
				revision: analysis.visibilityRevision,
			},
			savedAt: log.now().toISOString(),
			quotedOwners: [...quotedOwners].sort(),
			onlyMember: viewer.onlyMember,
			citations: findings.map(({ stepId, finding }) => ({
				stepId,
				finding,
				runs: citedRuns(
					stored
						.filter(
							(query) => query?.stepId === stepId && readable.has(query.id),
						)
						.map((query) => query?.output),
				),
			})),
		});
		// A share or unshare made while the rows were written may have found
		// none of them: they follow the analysis as it is now.
		const current = await log.store.getAnalysis(analysis.id);
		if (current && current.visibilityRevision !== analysis.visibilityRevision)
			await syncVisibility(log.store, impact, syncs, {
				workspaceId: analysis.workspaceId,
				analysisId: analysis.id,
			});
	} catch (error) {
		logger.error("Finding impact was not recorded for {analysisId}: {error}", {
			analysisId: analysis.id,
			error: loggableError(error),
		});
	}
}

/**
 * Past analyses the viewer may see: by meaning when `text` is given (question,
 * step sub-questions and topics are embedded), otherwise the most recent.
 */
export async function searchAnalyses(
	log: AnalysisLog,
	viewer: AnalysisViewer,
	input: AnalysisHistorySearchInput,
): Promise<AnalysisHistorySearchOutput> {
	const listed: AnalysisHistorySearchOutput["analyses"] = [];
	const seen = new Set<string>();
	const add = (
		analysis: StoredAnalysis,
		match: AnalysisHistorySearchOutput["analyses"][number]["match"],
	) => {
		if (seen.has(analysis.id) || listed.length >= input.limit) return;
		if (
			!canSee(analysis, viewer) ||
			(!input.includeEval && analysis.host === "eval")
		)
			return;
		seen.add(analysis.id);
		listed.push(summary(analysis, viewer, match));
	};
	if (input.text) {
		const [vector] = await log.embedder.embed([input.text]).catch((error) => {
			logger.warn("Analysis search embedding failed: {error}", {
				error: loggableError(error),
			});
			return [];
		});
		const matches = vector
			? await log.store.searchEmbeddings(
					viewer.workspaceId,
					log.embedder.model,
					vector,
					input.limit * 5,
				)
			: [];
		for (const match of matches) {
			const analysis = await log.store.getAnalysis(match.analysisId);
			if (analysis)
				add(analysis, {
					kind: match.kind === "step" ? "step" : "question",
					step: match.stepId,
					text: match.text,
				});
		}
	}
	for (const analysis of await log.store.recentAnalyses(
		viewer.workspaceId,
		viewer.userId,
		input.limit * 3,
	))
		add(analysis, { kind: "recent", step: null, text: null });
	return { analyses: listed };
}

/** The whole path: question, steps with findings and their queries (results not inlined), final answer. */
export async function getAnalysisTree(
	log: AnalysisLog,
	viewer: AnalysisViewer,
	id: string,
): Promise<AnalysisHistoryGetOutput> {
	const analysis = await visibleAnalysis(log, viewer, id);
	const [queries, chats, revisions] = await Promise.all([
		log.store.getQueries(analysis.id),
		log.store.getSessionLinks(analysis.id),
		log.store.analysesUpdating(
			analysis.workspaceId,
			analysis.id,
			MAX_LISTED_REVISIONS,
		),
	]);
	const now = log.now();
	return {
		...summaryFields(analysis, viewer),
		finalAnswer: analysis.finalAnswer,
		notes: analysis.notes,
		cost: analysis.cost,
		changes: analysis.changes,
		updatedBy: revisions
			.filter((revision) => canSee(revision, viewer))
			.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
			.map((revision) => revision.id),
		steps: (await log.store.getSteps(analysis.id)).map((step) => ({
			id: step.id,
			parent: step.parentId,
			question: step.question,
			reply: step.reply,
			finding: step.finding,
			queries: queries
				.filter((query) => query.stepId === step.id)
				.map((query) => ({
					id: query.id,
					tool: query.tool,
					args: query.args,
					outputChars: query.outputChars,
					createdAt: query.createdAt,
					unavailable: unavailableReason(query, analysis, viewer, now),
				})),
		})),
		// A restricting workspace shows a linked chat only to its owner and
		// admins, as it does stored results; otherwise to every viewer.
		chatSessions: chats
			.filter(
				(chat) =>
					!viewer.restrictResults ||
					viewer.isAdmin ||
					chat.ownerId === viewer.userId,
			)
			.map((chat) => ({
				sessionId: chat.sessionId,
				source: chat.source,
				userId: chat.ownerId,
				uploadedAt: chat.uploadedAt,
			})),
	};
}

/**
 * One stored query with its exact result. `currentGenerations` reports each
 * session's committed transcript generation now, to flag changed sessions.
 */
export async function getStoredQuery(
	log: AnalysisLog,
	viewer: AnalysisViewer,
	id: string,
	currentGenerations: (
		sessions: QuerySession[],
	) => Promise<Map<string, { revision: string; parserVersion: number }>>,
): Promise<AnalysisHistoryQueryOutput> {
	const query = await log.store.getQuery(id);
	if (!query || query.workspaceId !== viewer.workspaceId)
		throw new ORPCError("NOT_FOUND");
	const analysis = await visibleAnalysis(log, viewer, query.analysisId);
	// Every member the query read, not only those its result still names.
	const owners = [...new Set(query.owners)];
	const unavailable = unavailableReason(
		{
			...query,
			hasOutput: query.output !== null,
			ownerCount: owners.length,
			onlyOwnerId: owners.length === 1 ? (owners[0] ?? null) : null,
		},
		analysis,
		viewer,
		log.now(),
	);
	const current = await currentGenerations(query.sessions);
	const stale = query.sessions.some((session) => {
		const now = current.get(session.sessionId);
		return (
			!now ||
			now.revision !== session.revision ||
			now.parserVersion !== session.parserVersion
		);
	});
	const output = unavailable ? null : query.output;
	return {
		id: query.id,
		analysis: query.analysisId,
		step: query.stepId,
		createdAt: query.createdAt,
		stale,
		unavailable,
		call:
			query.tool === "find"
				? { tool: "find", args: query.args, output: output as never }
				: query.tool === "sql"
					? { tool: "sql", args: query.args, output: output as never }
					: { tool: "read", args: query.args, output: output as never },
	};
}

/**
 * Shares or unshares a saved analysis, and its finding impact rows with it.
 * The analysis log is authoritative: a sync of the rows is requested before
 * the change, the change advances the analysis's visibility revision, and
 * the rows take that revision's visibility (the highest revision wins). When
 * the rows cannot follow now, the change stands and the maintenance pass
 * makes them follow (`finding-visibility.ts`).
 */
export async function shareAnalysis(
	log: AnalysisLog,
	viewer: AnalysisViewer,
	id: string,
	shared: boolean,
	mirror?: FindingMirror,
): Promise<{ analysis: string; shared: boolean }> {
	const analysis = await authoredAnalysis(log, viewer, id);
	if (analysis.draft)
		throw new ORPCError("BAD_REQUEST", {
			message: `Analysis ${analysis.id} is an unsaved draft; save it with save_answer first, then share it`,
		});
	const target = { workspaceId: analysis.workspaceId, analysisId: analysis.id };
	const ticket = await mirror?.syncs.request(target);
	const revision = await log.store.setShared(analysis.id, shared);
	if (mirror && ticket !== undefined)
		await followVisibility(
			mirror.impact,
			mirror.syncs,
			target,
			ticket,
			revision === null ? null : { shared, revision },
		);
	return { analysis: analysis.id, shared };
}

async function resolveAnalysis(
	log: AnalysisLog,
	author: { workspaceId: string; userId: string; host: AnalysisHost },
	trace: RecordedCall["trace"],
	now: string,
): Promise<StoredAnalysis> {
	if (!trace.analysis) return createAnalysis(log, author, now);
	const analysis = await authoredAnalysis(
		log,
		authorViewer(author),
		trace.analysis,
	);
	if (!analysis.draft) throw notADraft(analysis.id);
	return analysis;
}

/** A new draft; it gets its question and becomes searchable only when saved. */
async function createAnalysis(
	log: AnalysisLog,
	author: { workspaceId: string; userId: string; host: AnalysisHost },
	now: string,
): Promise<StoredAnalysis> {
	const analysis: StoredAnalysis = {
		id: newId("a"),
		workspaceId: author.workspaceId,
		authorId: author.userId,
		host: author.host,
		question: UNSAVED_QUESTION,
		status: "unfinished",
		draft: true,
		shared: false,
		pinned: false,
		createdAt: now,
		cutoff: now,
		scope: { from: null, to: null, filters: {} },
		finalAnswer: null,
		topics: [],
		updates: null,
		changes: [],
		notes: [],
		cost: null,
		queryCount: 0,
		stepCount: 0,
		visibilityRevision: 0,
	};
	await log.store.createAnalysis(analysis);
	return analysis;
}

/** Every call is its own step, labelled from its tool and arguments. */
async function createCallStep(
	log: AnalysisLog,
	analysis: StoredAnalysis,
	call: RecordedCall,
	now: string,
): Promise<StoredStep> {
	const steps = await log.store.getSteps(analysis.id);
	if (steps.length >= MAX_STEPS_PER_ANALYSIS)
		throw new AnalysisFullError("steps");
	const step: StoredStep = {
		id: newId("s"),
		analysisId: analysis.id,
		parentId: null,
		ordinal: Math.max(0, ...steps.map((item) => item.ordinal)) + 1,
		question: stepLabel(call.tool, call.args),
		reply: null,
		finding: null,
		createdAt: now,
	};
	await log.store.createStep(step);
	return step;
}

/** Argument values every find or read call has unless the agent changed them; sql has none. */
const CALL_DEFAULTS = {
	find: AnalysisFindInputSchema.parse({ source: "runs" }),
	read: AnalysisReadInputSchema.parse({
		refs: [{ sessionId: "s", turn: 1 }],
	}),
	sql: {},
} as const;

/**
 * "find source=tool kind=validation from=2026-09-01", "read runs=3
 * depth=turn", "sql title=Longest runs": the call's tool and the arguments it
 * set (source always, other defaults left out), run lists as a count, and an
 * sql call's title without its SQL. Never free text from the chat.
 */
export function stepLabel(
	tool: RecordedCall["tool"],
	args: Record<string, unknown>,
): string {
	const defaults: Record<string, unknown> = CALL_DEFAULTS[tool];
	const parts: string[] = [tool];
	for (const [key, value] of Object.entries(args)) {
		if (
			key === "workspace" ||
			key === "cursor" ||
			value === undefined ||
			(tool === "sql" && key === "query")
		)
			continue;
		if (
			key !== "source" &&
			key !== "refs" &&
			JSON.stringify(value) === JSON.stringify(defaults[key])
		)
			continue;
		if (key === "refs" && Array.isArray(value)) {
			parts.push(`runs=${value.length}`);
			continue;
		}
		if (Array.isArray(value)) {
			parts.push(`${key}=${value.join(",")}`);
			continue;
		}
		if (typeof value !== "object" || value === null)
			parts.push(`${key}=${value}`);
	}
	const label = parts.join(" ");
	return label.length > MAX_STEP_LABEL_CHARS
		? `${label.slice(0, MAX_STEP_LABEL_CHARS - 1)}…`
		: label;
}

/** A query id of this analysis names its step; any other reference is kept. */
function stepIdOf(queries: QuerySummary[], reference: string): string {
	return queries.find((query) => query.id === reference)?.stepId ?? reference;
}

/** `resolveChanges` against the revised analysis, whose query ids also name its steps. */
async function revisionChanges(
	log: AnalysisLog,
	viewer: AnalysisViewer,
	analysisId: string,
	updates: string,
	findings: { step: StoredStep; finding: string }[],
	changes: AnalysisHistorySaveInput["changes"],
): Promise<AnalysisChange[]> {
	const prior = await visibleAnalysis(log, viewer, updates);
	const [priorSteps, priorQueries] = await Promise.all([
		log.store.getSteps(prior.id),
		log.store.getQueries(prior.id),
	]);
	return resolveChanges(
		analysisId,
		prior,
		priorSteps,
		findings,
		changes.map((change) =>
			findings.some((item) => item.step.id === change.step)
				? change
				: { ...change, step: stepIdOf(priorQueries, change.step) },
		),
	);
}

/**
 * A revision's change list, checked before anything is written: every
 * finding saved with the revision has exactly one change, naming its step by
 * id or exact sub-question; a `dropped` change may instead name a step of
 * the prior whose finding no longer holds, once. Refused lists name every
 * missing, repeated or unknown step.
 */
function resolveChanges(
	analysisId: string,
	prior: StoredAnalysis,
	priorSteps: StoredStep[],
	findings: { step: StoredStep; finding: string }[],
	changes: AnalysisHistorySaveInput["changes"],
): AnalysisChange[] {
	const byStep = new Map(findings.map((item) => [item.step.id, item]));
	const matches = (step: StoredStep, reference: string) =>
		step.id === reference || step.question === reference.trim();
	const counts = new Map<string, number>();
	const unknown: string[] = [];
	const resolved: AnalysisChange[] = [];
	for (const change of changes) {
		const own = findings.find((item) => matches(item.step, change.step));
		const dropped =
			own || change.change !== "dropped"
				? undefined
				: priorSteps.find((step) => matches(step, change.step));
		const step = own?.step ?? dropped;
		if (!step) {
			unknown.push(change.step);
			continue;
		}
		counts.set(step.id, (counts.get(step.id) ?? 0) + 1);
		resolved.push({
			step: step.id,
			finding: own?.finding ?? step.finding ?? step.question,
			change: change.change,
			evidence: change.evidence,
		});
	}
	const label = (id: string) => {
		const step = byStep.get(id)?.step ?? priorSteps.find((s) => s.id === id);
		return step ? `${id} ("${step.question}")` : id;
	};
	const missing = [...byStep.keys()].filter((id) => !counts.has(id));
	const repeated = [...counts]
		.filter(([, count]) => count > 1)
		.map(([id]) => id);
	if (!missing.length && !repeated.length && !unknown.length) return resolved;
	const problems = [
		missing.length &&
			`no change for the finding of ${missing.map(label).join(", ")}`,
		repeated.length &&
			`more than one change for ${repeated.map(label).join(", ")}`,
		unknown.length &&
			`no saved finding of this analysis, nor a step of ${prior.id} (allowed only with change=dropped), for ${unknown.map((reference) => `"${reference}"`).join(", ")}`,
	].filter(Boolean);
	throw new ORPCError("BAD_REQUEST", {
		message: `Analysis ${analysisId} updates ${prior.id}, so changes needs exactly one item per finding saved now, naming its step by its step or query id (plus change=dropped items for findings of ${prior.id} that no longer hold): ${problems.join("; ")}. Nothing was saved.`,
	});
}

function notADraft(analysisId: string): ORPCError<"BAD_REQUEST", unknown> {
	return new ORPCError("BAD_REQUEST", {
		message: `Analysis ${analysisId} is saved, and a saved analysis never changes; find and read add only to the unsaved draft they started. To revise it, leave out analysis to start a new draft, then save that draft with updates=${analysisId}`,
	});
}

/** The author as a viewer, for checks that only compare workspace and author. */
function authorViewer(author: {
	workspaceId: string;
	userId: string;
}): AnalysisViewer {
	return {
		workspaceId: author.workspaceId,
		userId: author.userId,
		isAdmin: false,
		restrictResults: true,
		onlyMember: author.userId,
	};
}

function analysisFull(
	analysisId: string,
	child: AnalysisFullError["child"],
): ORPCError<"BAD_REQUEST", unknown> {
	const messages = {
		queries: `Analysis ${analysisId} already has ${MAX_QUERIES_PER_ANALYSIS} queries, the most one analysis keeps; save it, or start a new analysis by leaving out analysis`,
		steps: `Analysis ${analysisId} already has ${MAX_STEPS_PER_ANALYSIS} steps, the most one analysis keeps; save it, or start a new analysis by leaving out analysis`,
		sessions: `Analysis ${analysisId} already has ${MAX_SESSIONS_PER_ANALYSIS} linked chat sessions, the most one analysis keeps`,
	} as const;
	return new ORPCError("BAD_REQUEST", { message: messages[child] });
}

async function authoredAnalysis(
	log: AnalysisLog,
	viewer: AnalysisViewer,
	id: string,
): Promise<StoredAnalysis> {
	const analysis = await log.store.getAnalysis(id);
	// Another member's draft does not exist for the viewer; an expired one
	// is gone for everyone, even before the daily cleanup deletes it.
	if (
		!analysis ||
		analysis.workspaceId !== viewer.workspaceId ||
		(analysis.draft &&
			(analysis.authorId !== viewer.userId ||
				isExpiredDraft(analysis, log.now())))
	)
		throw new ORPCError("NOT_FOUND");
	if (analysis.authorId !== viewer.userId)
		throw new ORPCError("FORBIDDEN", {
			message: "Only the author can change an analysis",
		});
	return analysis;
}

/** A saved analysis the viewer may see; drafts and everything else are NOT_FOUND. */
async function visibleAnalysis(
	log: AnalysisLog,
	viewer: AnalysisViewer,
	id: string,
): Promise<StoredAnalysis> {
	const analysis = await log.store.getAnalysis(id);
	if (!analysis || !canSee(analysis, viewer))
		throw new ORPCError("NOT_FOUND", {
			message: `No saved analysis ${id} that you can see`,
		});
	return analysis;
}

/**
 * Drafts are seen by nobody, their author included: only the author's own
 * find, read and save calls reach them.
 */
export function canSee(
	analysis: StoredAnalysis,
	viewer: Pick<AnalysisViewer, "workspaceId" | "userId">,
): boolean {
	return (
		!analysis.draft &&
		analysis.workspaceId === viewer.workspaceId &&
		(analysis.authorId === viewer.userId || analysis.shared)
	);
}

function isExpiredDraft(analysis: StoredAnalysis, now: Date): boolean {
	return (
		analysis.draft &&
		now.getTime() - Date.parse(analysis.createdAt) > DRAFT_RETENTION_MS
	);
}

/**
 * Anyone who can see the analysis reads its results, so teammates learn from
 * a shared analysis. A workspace that restricts results keeps each one
 * readable only by admins and the one member whose sessions the query read:
 * grouped counts and the few examples a result keeps can still carry other
 * members' evidence. Removed and expired results are gone.
 */
function unavailableReason(
	query: Pick<
		QuerySummary,
		"removed" | "hasOutput" | "createdAt" | "ownerCount" | "onlyOwnerId"
	>,
	analysis: StoredAnalysis,
	viewer: AnalysisViewer,
	now: Date,
): "expired" | "removed" | "restricted" | null {
	if (query.removed) return "removed";
	const retention =
		analysis.shared || analysis.pinned
			? SHARED_RESULT_RETENTION_MS
			: RESULT_RETENTION_MS;
	if (
		!query.hasOutput ||
		now.getTime() - Date.parse(query.createdAt) > retention
	)
		return "expired";
	if (
		viewer.restrictResults &&
		!viewer.isAdmin &&
		query.ownerCount > 0 &&
		query.onlyOwnerId !== viewer.userId
	)
		return "restricted";
	return null;
}

function summary(
	analysis: StoredAnalysis,
	viewer: AnalysisViewer,
	match: AnalysisHistorySearchOutput["analyses"][number]["match"],
): AnalysisHistorySearchOutput["analyses"][number] {
	return {
		...summaryFields(analysis, viewer),
		answerHead: analysis.finalAnswer?.slice(0, 280) ?? null,
		match,
	};
}

function summaryFields(analysis: StoredAnalysis, viewer: AnalysisViewer) {
	return {
		id: analysis.id,
		question: analysis.question,
		status: analysis.status,
		authorId: analysis.authorId,
		mine: analysis.authorId === viewer.userId,
		shared: analysis.shared,
		host: analysis.host,
		scope: analysis.scope,
		cutoff: analysis.cutoff,
		createdAt: analysis.createdAt,
		updates: analysis.updates,
		topics: analysis.topics,
	};
}

function scopeOf(queries: QuerySummary[]): AnalysisScope {
	const scoped = queries.flatMap(windowArgs);
	const dates = (key: "from" | "to") =>
		scoped
			.map((args) => args[key])
			.filter((value): value is string => typeof value === "string")
			.sort();
	const filters: Record<string, string> = {};
	for (const key of ["repository", "agent", "model", "userId", "sessionId"]) {
		const value = scoped.find((args) => typeof args[key] === "string")?.[key];
		if (typeof value === "string") filters[key] = value;
	}
	return {
		from: dates("from")[0] ?? null,
		to: dates("to").at(-1) ?? null,
		filters,
	};
}

function windowArgs(query: QuerySummary): Record<string, unknown>[] {
	if (query.tool === "find") return [query.args];
	const call = query.tool === "sql" ? query.args.call : undefined;
	return call && typeof call === "object" && !Array.isArray(call)
		? [call as Record<string, unknown>]
		: [];
}

/**
 * Best effort: an embedding outage must not lose the analysis itself; an
 * unembedded text is still listed by recency.
 */
async function embedText(
	log: AnalysisLog,
	workspaceId: string,
	analysisId: string,
	stepId: string | null,
	kind: "question" | "step" | "topics",
	text: string,
): Promise<void> {
	try {
		const [vector] = await log.embedder.embed([text]);
		if (vector)
			await log.store.addEmbedding(workspaceId, {
				analysisId,
				stepId,
				kind,
				text,
				vector,
				model: log.embedder.model,
			});
	} catch (error) {
		logger.warn("Analysis embedding failed for {analysisId}: {error}", {
			analysisId,
			error: loggableError(error),
		});
	}
}

function newId(prefix: "a" | "s" | "q"): string {
	return `${prefix}_${randomBytes(8).toString("base64url")}`;
}

/**
 * Account or workspace deletion (run by the durable purge, so it must be
 * idempotent; its follow-up pass repeats it): a workspace's analyses go; for
 * an account, its own analyses and every analysis, by anyone, with a result
 * that returned text from its sessions or a finding citing one of them,
 * while results that only counted its sessions are removed (with arguments
 * that may carry transcript text) and their analyses stay (ADR 0001 as
 * amended; `removeOwnerEvidence`). Stops with `signal`; a retry
 * continues where this one stopped.
 */
export async function purgeAnalysisLog(
	store: AnalysisStore,
	target: { targetType: "organization" | "account"; targetId: string },
	signal: AbortSignal,
): Promise<void> {
	signal.throwIfAborted();
	if (target.targetType === "organization") {
		await store.deleteAnalysesByWorkspace(target.targetId);
		return;
	}
	await store.deleteAnalysesByAuthor(target.targetId);
	signal.throwIfAborted();
	await store.removeOwnerEvidence(target.targetId);
	signal.throwIfAborted();
	// Their chats linked to other members' analyses go; those analyses stay.
	await store.deleteSessionLinksByOwner(target.targetId);
}
