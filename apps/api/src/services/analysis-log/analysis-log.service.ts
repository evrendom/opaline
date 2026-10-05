import { randomBytes } from "node:crypto";
import { getLogger } from "@logtape/logtape";
import { ORPCError } from "@orpc/server";
import type {
	AnalysisChange,
	AnalysisFindInput,
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
	AnalysisFullError,
	AnalysisSavedError,
	loggableError,
} from "./errors.js";
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

/** An unidentified call joins the author's analysis active within this window. */
const OPEN_ANALYSIS_WINDOW_MS = 30 * 60_000;
/** Query results expire after this; shared or pinned analyses keep them longer (ADR 0001). */
const RESULT_RETENTION_MS = 90 * 86_400_000;
const SHARED_RESULT_RETENTION_MS = 365 * 86_400_000;
const UNLABELLED_STEP = "(no step given)";
/** Revisions listed with an analysis (`updatedBy`). */
const MAX_LISTED_REVISIONS = 20;

/** What save_analysis answers for a saved analysis: saving is append-only. */
export function analysisAlreadySaved(id: string): string {
	return `This analysis is already saved. To revise it, save a new analysis that passes updates=${id}.`;
}

export interface RecordedCall {
	tool: "find" | "read";
	/** The call's arguments without the trace fields. */
	args: Record<string, unknown>;
	trace: {
		analysis?: string;
		question?: string;
		/** On a draft's first call: the saved analysis it revises. */
		updates?: string;
		step?: string;
		parentStep?: string;
	};
	output: unknown;
	outputChars: number;
	sessions: QuerySession[];
	/** Every member whose sessions the call read, shown in its output or not. */
	owners: readonly string[];
}

/**
 * Stores one find/read call under its draft analysis and step, creating
 * either when needed, and returns the ids the agent passes on its next call.
 * Only drafts take calls: a saved analysis never changes, so revising one
 * starts a new draft (`updates`).
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
		return await recordInto(log, analysis, call, now);
	} catch (error) {
		// Saved by a concurrent save_analysis after this call picked it.
		if (error instanceof AnalysisSavedError) throw notADraft(analysis.id);
		if (!(error instanceof AnalysisFullError)) throw error;
		// Only a named analysis is the agent's to fix; one the server picked
		// filled up under a concurrent call, so this call starts a new one.
		if (call.trace.analysis || call.trace.question || call.trace.updates)
			throw analysisFull(analysis.id, error.child);
		return recordInto(
			log,
			await createAnalysis(log, author, call.trace, now),
			call,
			now,
		);
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
	const step = await resolveStep(log, analysis, call.trace, now);
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
	};
	await log.store.createQuery(query);
	return { analysis: analysis.id, step: step.id, query: query.id };
}

/**
 * Publishes a draft: the final answer, step findings, the asker's
 * clarifications and, for a revision, how each finding changed. The analysis
 * becomes finished and visible to its author (and the workspace once shared).
 * Saving is append-only: a saved analysis is refused unchanged, and a
 * revision is a new analysis that names it in `updates`.
 */
export async function saveAnalysis(
	log: AnalysisLog,
	viewer: AnalysisViewer,
	input: AnalysisHistorySaveInput,
): Promise<{ analysis: string; status: "finished" }> {
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
	const steps = await log.store.getSteps(analysis.id);
	// Agents refer to steps by id or by the sub-question they wrote; accept both.
	const stepOf = (reference: string) => {
		const step = steps.find(
			(candidate) =>
				candidate.id === reference || candidate.question === reference.trim(),
		);
		if (!step)
			throw new ORPCError("BAD_REQUEST", {
				message: `Step "${reference}" is not part of analysis ${analysis.id}; use a step id from a trace line or its exact sub-question`,
			});
		return step;
	};
	const findings = input.findings.map(({ step, finding }) => ({
		stepId: stepOf(step).id,
		finding,
	}));
	const now = log.now().toISOString();
	const clarifications = input.clarifications.map(
		(clarification, index): StoredStep => {
			const before = clarification.before
				? stepOf(clarification.before)
				: undefined;
			return {
				id: newId("s"),
				analysisId: analysis.id,
				parentId: null,
				ordinal: before
					? before.ordinal - 0.5 + index / 1_000
					: Math.max(0, ...steps.map((item) => item.ordinal)) + 1 + index,
				question: clarification.question,
				reply: clarification.reply,
				finding: null,
				createdAt: now,
			};
		},
	);
	const changes = updates
		? resolveChanges(
				analysis.id,
				await visibleAnalysis(log, viewer, updates),
				await log.store.getSteps(updates),
				findings.map(({ stepId, finding }) => ({
					step: stepOf(stepId),
					finding,
				})),
				input.changes,
			)
		: [];
	const full = new ORPCError("BAD_REQUEST", {
		message: `Analysis ${analysis.id} has ${steps.length} steps; with ${clarifications.length} clarifications it would pass ${MAX_STEPS_PER_ANALYSIS}, the most one analysis keeps; save fewer clarifications`,
	});
	if (steps.length + clarifications.length > MAX_STEPS_PER_ANALYSIS) throw full;

	// One atomic write: a refused save leaves the analysis as it was.
	try {
		await log.store.saveAnalysis(analysis.id, {
			findings,
			clarifications,
			patch: {
				status: "finished",
				finalAnswer: input.finalAnswer,
				topics: input.topics,
				updates,
				changes,
				scope: scopeOf(await log.store.getQueries(analysis.id)),
			},
		});
	} catch (error) {
		if (error instanceof AnalysisFullError) throw full;
		// A concurrent save won: nothing was written by this one.
		if (error instanceof AnalysisSavedError)
			throw new ORPCError("CONFLICT", {
				message: analysisAlreadySaved(analysis.id),
			});
		throw error;
	}
	for (const step of clarifications)
		await embedText(
			log,
			analysis.workspaceId,
			analysis.id,
			step.id,
			"step",
			step.question,
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
	return { analysis: analysis.id, status: "finished" };
}

/**
 * A find without `from` in a revision covers only the evidence since the
 * revised analysis's data cutoff day: on the draft's first call (`updates`)
 * and on every follow-up (`analysis` naming a draft that revises one), so
 * pages and follow-ups keep one window. The note says so in the result's
 * header. An explicit `from` always wins. Null when nothing changes; a draft
 * the caller cannot add to is left for `recordQuery` to refuse.
 */
export async function sinceUpdatedCutoff(
	log: AnalysisLog,
	viewer: AnalysisViewer,
	input: AnalysisFindInput,
): Promise<{ input: AnalysisFindInput; note: string } | null> {
	if (input.from) return null;
	const updates = input.updates ?? (await draftUpdates(log, viewer, input));
	if (!updates) return null;
	const prior = await visibleAnalysis(log, viewer, updates);
	const from = prior.cutoff.slice(0, 10);
	if (input.to && input.to < from) return null;
	return {
		input: { ...input, from },
		note: `from defaults to ${from}, the data cutoff of analysis ${prior.id} that this draft updates; pass from to cover earlier days`,
	};
}

/** The analysis the named draft revises, when the caller may add to that draft. */
async function draftUpdates(
	log: AnalysisLog,
	viewer: AnalysisViewer,
	input: AnalysisFindInput,
): Promise<string | null> {
	if (!input.analysis) return null;
	const draft = await log.store.getAnalysis(input.analysis);
	if (
		!draft?.draft ||
		draft.workspaceId !== viewer.workspaceId ||
		draft.authorId !== viewer.userId ||
		isExpiredDraft(draft, log.now())
	)
		return null;
	return draft.updates;
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
				: { tool: "read", args: query.args, output: output as never },
	};
}

export async function shareAnalysis(
	log: AnalysisLog,
	viewer: AnalysisViewer,
	id: string,
	shared: boolean,
): Promise<{ analysis: string; shared: boolean }> {
	const analysis = await authoredAnalysis(log, viewer, id);
	if (analysis.draft)
		throw new ORPCError("BAD_REQUEST", {
			message: `Analysis ${analysis.id} is an unsaved draft; save it with save_analysis first, then share it`,
		});
	await log.store.updateAnalysis(analysis.id, { shared });
	return { analysis: analysis.id, shared };
}

async function resolveAnalysis(
	log: AnalysisLog,
	author: { workspaceId: string; userId: string; host: AnalysisHost },
	trace: RecordedCall["trace"],
	now: string,
): Promise<StoredAnalysis> {
	if (trace.analysis) {
		const analysis = await authoredAnalysis(
			log,
			authorViewer(author),
			trace.analysis,
		);
		if (!analysis.draft) throw notADraft(analysis.id);
		if (trace.updates && trace.updates !== analysis.updates)
			throw new ORPCError("BAD_REQUEST", {
				message: `updates only applies to the first call of a draft; analysis ${analysis.id} ${analysis.updates ? `updates ${analysis.updates}` : "updates no earlier analysis"}. Leave updates out, or start a new draft with updates and no analysis`,
			});
		return analysis;
	}
	if (!trace.question && !trace.updates) {
		const open = await log.store.latestOpenAnalysis(
			author.workspaceId,
			author.userId,
			new Date(Date.parse(now) - OPEN_ANALYSIS_WINDOW_MS).toISOString(),
		);
		// A full analysis the server picked is not the agent's mistake: start anew.
		if (
			open &&
			!isExpiredDraft(open, new Date(now)) &&
			open.queryCount < MAX_QUERIES_PER_ANALYSIS &&
			open.stepCount < MAX_STEPS_PER_ANALYSIS
		)
			return open;
	}
	return createAnalysis(log, author, trace, now);
}

async function createAnalysis(
	log: AnalysisLog,
	author: { workspaceId: string; userId: string; host: AnalysisHost },
	trace: RecordedCall["trace"],
	now: string,
): Promise<StoredAnalysis> {
	// A revision starts from a saved analysis its author may see.
	const prior = trace.updates
		? await visibleAnalysis(log, authorViewer(author), trace.updates)
		: null;
	const question = trace.question ?? prior?.question;
	const analysis: StoredAnalysis = {
		id: newId("a"),
		workspaceId: author.workspaceId,
		authorId: author.userId,
		host: author.host,
		question: question ?? "(question not given)",
		status: "unfinished",
		draft: true,
		shared: false,
		pinned: false,
		createdAt: now,
		cutoff: now,
		scope: { from: null, to: null, filters: {} },
		finalAnswer: null,
		topics: [],
		updates: prior?.id ?? null,
		changes: [],
		notes: [],
		cost: null,
		queryCount: 0,
		stepCount: 0,
	};
	await log.store.createAnalysis(analysis);
	if (question)
		await embedText(
			log,
			analysis.workspaceId,
			analysis.id,
			null,
			"question",
			question,
		);
	return analysis;
}

/** `step` is an existing step id, or the text of a sub-question (reused when already asked). */
async function resolveStep(
	log: AnalysisLog,
	analysis: StoredAnalysis,
	trace: RecordedCall["trace"],
	now: string,
): Promise<StoredStep> {
	const steps = await log.store.getSteps(analysis.id);
	const text = trace.step ?? UNLABELLED_STEP;
	const existing = steps.find(
		(step) => step.id === text || step.question === text,
	);
	if (existing) return existing;
	if (trace.step?.startsWith("s_"))
		throw new ORPCError("BAD_REQUEST", {
			message: `Step ${trace.step} is not part of analysis ${analysis.id}`,
		});
	const parent = trace.parentStep
		? steps.find((step) => step.id === trace.parentStep)
		: undefined;
	if (trace.parentStep && !parent)
		throw new ORPCError("BAD_REQUEST", {
			message: `Parent step ${trace.parentStep} is not part of analysis ${analysis.id}`,
		});
	if (steps.length >= MAX_STEPS_PER_ANALYSIS)
		throw new AnalysisFullError("steps");
	const step: StoredStep = {
		id: newId("s"),
		analysisId: analysis.id,
		parentId: parent?.id ?? null,
		ordinal: Math.max(0, ...steps.map((item) => item.ordinal)) + 1,
		question: text,
		reply: null,
		finding: null,
		createdAt: now,
	};
	await log.store.createStep(step);
	if (trace.step)
		await embedText(
			log,
			analysis.workspaceId,
			analysis.id,
			step.id,
			"step",
			text,
		);
	return step;
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
		message: `Analysis ${analysisId} updates ${prior.id}, so changes needs exactly one item per finding saved now, naming its step by id or exact sub-question (plus change=dropped items for findings of ${prior.id} that no longer hold): ${problems.join("; ")}. Nothing was saved.`,
	});
}

function notADraft(analysisId: string): ORPCError<"BAD_REQUEST", unknown> {
	return new ORPCError("BAD_REQUEST", {
		message: `Analysis ${analysisId} is saved, and a saved analysis never changes; find and read add only to the unsaved draft they started. To revise it, start a new draft by passing updates=${analysisId} (and no analysis), then save that draft`,
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
	};
}

function analysisFull(
	analysisId: string,
	child: AnalysisFullError["child"],
): ORPCError<"BAD_REQUEST", unknown> {
	const messages = {
		queries: `Analysis ${analysisId} already has ${MAX_QUERIES_PER_ANALYSIS} queries, the most one analysis keeps; start a new analysis by passing question instead of analysis`,
		steps: `Analysis ${analysisId} already has ${MAX_STEPS_PER_ANALYSIS} steps, the most one analysis keeps; reuse a step id or start a new analysis by passing question instead of analysis`,
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

/** Dates span every find; filters come from the first find that set any. */
function scopeOf(queries: QuerySummary[]): AnalysisScope {
	const finds = queries.filter((query) => query.tool === "find");
	const dates = (key: "from" | "to") =>
		finds
			.map((query) => query.args[key])
			.filter((value): value is string => typeof value === "string")
			.sort();
	const filters: Record<string, string> = {};
	for (const key of ["repository", "agent", "model", "userId", "sessionId"]) {
		const value = finds.find((query) => typeof query.args[key] === "string")
			?.args[key];
		if (typeof value === "string") filters[key] = value;
	}
	return {
		from: dates("from")[0] ?? null,
		to: dates("to").at(-1) ?? null,
		filters,
	};
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
 * an account, its own analyses and every analysis, by anyone, that read one
 * of its sessions (ADR 0001). Stops with `signal`; a retry continues where
 * this one stopped.
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
	await store.deleteAnalysesReadingOwner(target.targetId);
	signal.throwIfAborted();
	// Their chats linked to other members' analyses go; those analyses stay.
	await store.deleteSessionLinksByOwner(target.targetId);
}
