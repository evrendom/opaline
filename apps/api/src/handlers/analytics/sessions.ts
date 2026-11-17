import { ORPCError } from "@orpc/server";
import type { LiveSessionSummary } from "@rudel/api-routes";
import { sqlClient } from "../../db.js";
import { isSelfHosted } from "../../lib/self-hosted.js";
import { orgMiddleware, os } from "../../middleware.js";
import { selfHostedRead } from "../../selfhost/read-cache.js";
import { isLiveSessionsReadable } from "../../services/live-session/live-session-config.js";
import { LiveSessionStorageError } from "../../services/live-session/live-session-gate.js";
import { getLiveSessionR2Client } from "../../services/live-session/live-session-r2.js";
import {
	listLiveSessions,
	readLiveSession,
	readLiveSessionTail,
} from "../../services/live-session/live-session-read.service.js";
import { readR2IngestAvailability } from "../../services/r2-ingest-storage.service.js";
import { runCiDemoOf } from "../../services/run-ci/demo-run-ci.js";
import { sessionRunCiEnv } from "../../services/run-ci/env.js";
import { sessionRunCi } from "../../services/run-ci/session-run-ci.js";
import {
	InvalidAgentRunsCursorError,
	listAgentRuns,
} from "../../services/run-questions/agent-runs.js";
import {
	agentRunsEnv,
	sessionAnswersEnv,
} from "../../services/run-questions/env.js";
import {
	sessionRunAnswers,
	sessionRunQuestionTags,
} from "../../services/run-questions/session-answers.js";
import {
	getSessionAnalytics,
	getSessionAnalyticsSummaryComparison,
	getSessionDimensionAnalysis,
} from "../../services/session-analytics.service.js";
import { readSessionContextSnapshot } from "../../services/session-context-snapshot.service.js";
import {
	getSessionDetailBodyChunk,
	getSessionDetailInitial,
	getSessionDetailOverview,
	getSessionDetailSpine,
	getSessionDetailSubagent,
	getSessionDetailTurn,
	getSessionDetailWindow,
} from "../../services/session-detail.service.js";
import {
	InvalidSessionDetailCursorError,
	InvalidSessionDetailWindowCursorError,
} from "../../services/session-detail-derivation.service.js";
import { getSessionFileChanges } from "../../services/session-file-changes/session-file-changes.service.js";
import { getLastSessionUpload } from "../../services/session-last-upload.service.js";
import {
	getSessionCostMaximum,
	getSessionFilterCatalog,
} from "../../services/session-list-filters.js";
import { readNativeSessionRelationships } from "../../services/session-native-lineage.service.js";
import { getSessionOwner } from "../../services/session-ownership.service.js";
import {
	sessionSetupRuns,
	sessionSetupText,
	sessionSummaryLinks,
} from "../../services/session-summary-links.service.js";
import {
	readableSessionOwner,
	type SessionReader,
} from "../../services/session-visibility.js";
import { listUploadFailures } from "../../services/upload-failure.service.js";
import { workspaceFeatureEnabled } from "../../services/workspace-features.js";
import { requireSessionDetailOwnerAccess } from "./session-detail-access.js";
import {
	throwSessionDetailRevisionError,
	throwSessionDetailWindowError,
} from "./session-detail-errors.js";

const sortByMap: Record<string, "date" | "duration"> = {
	session_date: "date",
	duration_min: "duration",
	total_tokens: "date",
};

const uploadFailures = os.analytics.sessions.uploadFailures
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		listUploadFailures(
			context.organizationId,
			readableSessionOwner(context.sessionReader),
			input,
		),
	);

async function localLiveSessions(
	ownerId: string | null,
): Promise<LiveSessionSummary[] | null> {
	if (!isSelfHosted()) return null;
	const { getLocalIngest } = await import(
		"../../selfhost/local-ingest/index.js"
	);
	const ingest = getLocalIngest();
	if (!ingest) return null;
	return (await ingest.liveSessions())
		.filter((live) => ownerId === null || live.userId === ownerId)
		.map((live) => ({ ...live, agents: [...live.agents], endedAt: null }));
}

const liveList = os.analytics.sessions.liveList
	.use(orgMiddleware)
	.handler(async ({ context }) => {
		if (!isLiveSessionsReadable(context.organizationId))
			return { sessions: [] };
		const ownerId = readableSessionOwner(context.sessionReader);
		return {
			sessions:
				(await localLiveSessions(ownerId)) ??
				(await listLiveSessions(
					{ organizationId: context.organizationId, ownerId },
					{ database: sqlClient, now: () => new Date() },
				)),
		};
	});

/**
 * Who owns the session the detail is read for: its upload's owner, or
 * before an upload the member streaming it live.
 */
async function getSessionDetailOwner(
	organizationId: string,
	sessionId: string,
	reader: SessionReader,
): Promise<string | null> {
	const owner = await getSessionOwner(organizationId, sessionId);
	if (owner || !isLiveSessionsReadable(organizationId)) return owner;
	const live = await readLiveSession(
		{
			organizationId,
			readableOwnerId: readableSessionOwner(reader),
			sessionId,
			source: undefined,
		},
		{ database: sqlClient },
	);
	return live?.userId ?? null;
}

/** Readable exactly like the session's detail: by its live session's owner. */
const liveTail = os.analytics.sessions.liveTail
	.use(orgMiddleware)
	.handler(async ({ input, context, signal }) => {
		const local = isLiveSessionsReadable(context.organizationId)
			? await localLiveSessions(readableSessionOwner(context.sessionReader))
			: null;
		if (local) {
			const running =
				local.find(
					(live) =>
						live.sessionId === input.sessionId &&
						(!input.source || live.source === input.source),
				) ?? null;
			return { session: running, streams: [], uploaded: running !== null };
		}
		const session = isLiveSessionsReadable(context.organizationId)
			? await readLiveSession(
					{
						organizationId: context.organizationId,
						readableOwnerId: readableSessionOwner(context.sessionReader),
						sessionId: input.sessionId,
						source: input.source,
					},
					{ database: sqlClient },
				)
			: null;
		if (!session) return { session: null, streams: [], uploaded: false };
		requireSessionDetailOwnerAccess(session.userId, context.sessionReader);
		const availability = readR2IngestAvailability();
		if (!availability.enabled) {
			throw new ORPCError("SERVICE_UNAVAILABLE", {
				message: "Live session storage is unavailable.",
			});
		}
		try {
			return await readLiveSessionTail(
				{
					cursor: input.cursor,
					organizationId: context.organizationId,
					session,
					summaryOnly: input.summaryOnly,
				},
				{
					database: sqlClient,
					r2: getLiveSessionR2Client(availability.configuration),
					signal,
				},
			);
		} catch (error) {
			if (error instanceof LiveSessionStorageError) {
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message: "Live session storage is unavailable.",
				});
			}
			throw error;
		}
	});

/**
 * Run question answers for the dashboard (`session-answers.ts`): nothing in a
 * workspace whose runs are not answered, else the tags of the listed sessions
 * the caller may read, and every answer per run of one session the caller
 * may open.
 */
const runQuestionTags = os.analytics.sessions.runQuestionTags
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		sessionRunQuestionTags(
			sessionAnswersEnv(),
			{
				workspaceId: context.organizationId,
				member: readableSessionOwner(context.sessionReader),
			},
			input.sessionIds,
		),
	);

const runAnswers = os.analytics.sessions.runAnswers
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		sessionRunAnswers(
			sessionAnswersEnv(),
			context.organizationId,
			async () =>
				requireSessionDetailOwnerAccess(
					await getSessionOwner(context.organizationId, input.sessionId),
					context.sessionReader,
				),
			input.sessionId,
		),
	);

const runCi = os.analytics.sessions.runCi
	.use(orgMiddleware)
	.handler(async ({ input, context }) => {
		const env = sessionRunCiEnv();
		if (
			!runCiDemoOf(env, context.organizationId) &&
			!(await env.enabled(context.organizationId))
		)
			return { enabled: false, runs: [] };
		const ownerId = requireSessionDetailOwnerAccess(
			await getSessionOwner(context.organizationId, input.sessionId),
			context.sessionReader,
		);
		return sessionRunCi(
			env,
			{ workspaceId: context.organizationId, member: ownerId },
			input.sessionId,
		);
	});

const summaryLinks = os.analytics.sessions.summaryLinks
	.use(orgMiddleware)
	.handler(async ({ input, context }) => {
		const ownerId = requireSessionDetailOwnerAccess(
			await getSessionOwner(context.organizationId, input.sessionId),
			context.sessionReader,
		);
		return sessionSummaryLinks(
			sessionRunCiEnv(),
			{ workspaceId: context.organizationId, member: ownerId },
			input.sessionId,
		);
	});

const setupText = os.analytics.sessions.setupText
	.use(orgMiddleware)
	.handler(async ({ input, context }) => {
		const ownerId = requireSessionDetailOwnerAccess(
			await getSessionOwner(context.organizationId, input.sessionId),
			context.sessionReader,
		);
		return sessionSetupText(
			sessionRunCiEnv(),
			{ workspaceId: context.organizationId, member: ownerId },
			input.sessionId,
			input.setupFile,
		);
	});

const setupRuns = os.analytics.sessions.setupRuns
	.use(orgMiddleware)
	.handler(async ({ input, context }) => {
		const ownerId = requireSessionDetailOwnerAccess(
			await getSessionOwner(context.organizationId, input.sessionId),
			context.sessionReader,
		);
		return sessionSetupRuns(
			sessionRunCiEnv(),
			{ workspaceId: context.organizationId, member: ownerId },
			input.sessionId,
		);
	});

const contextSnapshot = os.analytics.sessions.contextSnapshot
	.use(orgMiddleware)
	.handler(async ({ input, context }) => {
		const ownerId = requireSessionDetailOwnerAccess(
			await getSessionOwner(context.organizationId, input.sessionId),
			context.sessionReader,
		);
		return readSessionContextSnapshot(
			sessionRunCiEnv().executor,
			{ workspaceId: context.organizationId, member: ownerId },
			input.sessionId,
		);
	});

/**
 * Whether the caller's workspace may open Agent traces: its admin switch,
 * else AGENT_TRACES_WORKSPACES (`workspace-features.ts`).
 */
const agentTracesAccess = os.analytics.sessions.agentTracesAccess
	.use(orgMiddleware)
	.handler(async ({ context }) => ({
		enabled: await workspaceFeatureEnabled(
			sqlClient,
			"agent_traces",
			context.organizationId,
		),
	}));

/**
 * Every run the caller may read over a date range, with its answers
 * (`agent-runs.ts`), in a workspace Agent traces is open to.
 */
const agentRuns = os.analytics.sessions.agentRuns
	.use(orgMiddleware)
	.handler(async ({ input, context }) => {
		if (
			!(await workspaceFeatureEnabled(
				sqlClient,
				"agent_traces",
				context.organizationId,
			))
		)
			throw new ORPCError("FORBIDDEN", {
				message: "Agent traces are not enabled for this workspace.",
			});
		try {
			return await listAgentRuns(
				agentRunsEnv(),
				{
					workspaceId: context.organizationId,
					member: readableSessionOwner(context.sessionReader),
				},
				input,
			);
		} catch (error) {
			if (error instanceof InvalidAgentRunsCursorError)
				throw new ORPCError("BAD_REQUEST", { message: error.message });
			throw error;
		}
	});

const list = os.analytics.sessions.list
	.use(orgMiddleware)
	.handler(async ({ input, context }) =>
		selfHostedRead("sessions.list", [context.organizationId, input], () =>
			getSessionAnalytics(context.organizationId, {
				filters: input.filters,
				skill_name: input.skillName,
				days: input.days,
				start_date: input.startDate,
				end_date: input.endDate,
				user_id: input.userId,
				project_path: input.projectPath,
				repository: input.repository,
				repo_key: input.repoKey,
				source: input.source,
				limit: input.limit,
				offset: input.offset,
				sort_by: sortByMap[input.sortBy] ?? "date",
				sort_order: input.sortOrder,
			}),
		),
	);

const lastUpload = os.analytics.sessions.lastUpload
	.use(orgMiddleware)
	.handler(({ context }) => getLastSessionUpload(context.organizationId));

const costMaximum = os.analytics.sessions.costMaximum
	.use(orgMiddleware)
	.handler(({ context }) =>
		selfHostedRead("sessions.costMaximum", [context.organizationId], () =>
			getSessionCostMaximum(context.organizationId),
		),
	);

const filterCatalog = os.analytics.sessions.filterCatalog
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		selfHostedRead(
			"sessions.filterCatalog",
			[context.organizationId, input],
			() =>
				getSessionFilterCatalog(context.organizationId, {
					days: input.days,
					start_date: input.startDate,
					end_date: input.endDate,
				}),
		),
	);

const summaryComparison = os.analytics.sessions.summaryComparison
	.use(orgMiddleware)
	.handler(async ({ input, context }) => {
		return getSessionAnalyticsSummaryComparison(context.organizationId, {
			days: input.days,
		});
	});

const dimensionAnalysis = os.analytics.sessions.dimensionAnalysis
	.use(orgMiddleware)
	.handler(async ({ input, context }) => {
		return getSessionDimensionAnalysis(context.organizationId, {
			days: input.days,
			dimension: input.dimension,
			metric: input.metric,
			split_by: input.splitBy,
			limit: input.limit,
			user_id: input.userId,
			project_path: input.projectPath,
		});
	});

const detailBodyChunk = os.analytics.sessions.detailBodyChunk
	.use(orgMiddleware)
	.handler(async ({ input, context, errors }) => {
		const ownerId = requireSessionDetailOwnerAccess(
			await getSessionDetailOwner(
				context.organizationId,
				input.sessionId,
				context.sessionReader,
			),
			context.sessionReader,
		);
		try {
			const result = await getSessionDetailBodyChunk({
				...input,
				revision: input.revision,
				organizationId: context.organizationId,
				ownerId,
			});
			if (!result) throw new ORPCError("NOT_FOUND");
			return result;
		} catch (error) {
			if (error instanceof RangeError) {
				throw new ORPCError("BAD_REQUEST", { message: error.message });
			}
			return throwSessionDetailRevisionError(error, errors);
		}
	});

const fileChanges = os.analytics.sessions.fileChanges
	.use(orgMiddleware)
	.handler(async ({ input, context, errors }) => {
		const ownerId = requireSessionDetailOwnerAccess(
			await getSessionDetailOwner(
				context.organizationId,
				input.sessionId,
				context.sessionReader,
			),
			context.sessionReader,
		);
		try {
			const result = await getSessionFileChanges({
				organizationId: context.organizationId,
				ownerId,
				sessionId: input.sessionId,
			});
			if (!result) throw new ORPCError("NOT_FOUND");
			return result;
		} catch (error) {
			return throwSessionDetailRevisionError(error, errors);
		}
	});

const detailInitial = os.analytics.sessions.detailInitial
	.use(orgMiddleware)
	.handler(async ({ input, context, errors }) => {
		const ownerId = requireSessionDetailOwnerAccess(
			await getSessionDetailOwner(
				context.organizationId,
				input.sessionId,
				context.sessionReader,
			),
			context.sessionReader,
		);
		try {
			const result = await getSessionDetailInitial({
				bodyChunks: input.bodyChunks,
				organizationId: context.organizationId,
				ownerId,
				sessionId: input.sessionId,
			});
			if (!result) throw new ORPCError("NOT_FOUND");
			return result;
		} catch (error) {
			return throwSessionDetailRevisionError(error, errors);
		}
	});

const detailOverview = os.analytics.sessions.detailOverview
	.use(orgMiddleware)
	.handler(async ({ input, context, errors }) => {
		const ownerId = requireSessionDetailOwnerAccess(
			await getSessionDetailOwner(
				context.organizationId,
				input.sessionId,
				context.sessionReader,
			),
			context.sessionReader,
		);

		try {
			const result = await getSessionDetailOverview({
				organizationId: context.organizationId,
				ownerId,
				sessionId: input.sessionId,
				turnCursor: input.turnCursor,
				turnLimit: input.turnLimit,
			});
			if (!result) {
				throw new ORPCError("NOT_FOUND");
			}
			return result;
		} catch (error) {
			if (error instanceof InvalidSessionDetailCursorError) {
				throw new ORPCError("BAD_REQUEST", {
					message: error.message,
				});
			}
			return throwSessionDetailRevisionError(error, errors);
		}
	});

const detailRelationships = os.analytics.sessions.detailRelationships
	.use(orgMiddleware)
	.handler(async ({ input, context }) => {
		const ownerId = requireSessionDetailOwnerAccess(
			await getSessionDetailOwner(
				context.organizationId,
				input.sessionId,
				context.sessionReader,
			),
			context.sessionReader,
		);
		return readNativeSessionRelationships({
			organizationId: context.organizationId,
			sessionId: input.sessionId,
			userId: ownerId,
		});
	});

const detailWindow = os.analytics.sessions.detailWindow
	.use(orgMiddleware)
	.handler(async ({ input, context, errors }) => {
		const ownerId = requireSessionDetailOwnerAccess(
			await getSessionDetailOwner(
				context.organizationId,
				input.sessionId,
				context.sessionReader,
			),
			context.sessionReader,
		);

		try {
			const result = await getSessionDetailWindow({
				organizationId: context.organizationId,
				ownerId,
				request: input,
				sessionId: input.sessionId,
			});
			if (!result) {
				throw new ORPCError("NOT_FOUND");
			}
			return result;
		} catch (error) {
			if (error instanceof InvalidSessionDetailWindowCursorError) {
				throw new ORPCError("BAD_REQUEST", { message: error.message });
			}
			return throwSessionDetailWindowError(error, errors);
		}
	});

const detailSpine = os.analytics.sessions.detailSpine
	.use(orgMiddleware)
	.handler(async ({ input, context, errors }) => {
		const ownerId = requireSessionDetailOwnerAccess(
			await getSessionDetailOwner(
				context.organizationId,
				input.sessionId,
				context.sessionReader,
			),
			context.sessionReader,
		);

		try {
			const result = await getSessionDetailSpine({
				organizationId: context.organizationId,
				ownerId,
				revision: input.revision,
				sessionId: input.sessionId,
			});
			if (!result) {
				throw new ORPCError("NOT_FOUND");
			}
			return result;
		} catch (error) {
			return throwSessionDetailRevisionError(error, errors);
		}
	});

const detailTurn = os.analytics.sessions.detailTurn
	.use(orgMiddleware)
	.handler(async ({ input, context, errors }) => {
		const ownerId = requireSessionDetailOwnerAccess(
			await getSessionDetailOwner(
				context.organizationId,
				input.sessionId,
				context.sessionReader,
			),
			context.sessionReader,
		);

		try {
			const result = await getSessionDetailTurn({
				organizationId: context.organizationId,
				ownerId,
				revision: input.revision,
				sessionId: input.sessionId,
				turnId: input.turnId,
			});
			if (!result) {
				throw new ORPCError("NOT_FOUND");
			}
			return result;
		} catch (error) {
			return throwSessionDetailRevisionError(error, errors);
		}
	});

const detailSubagent = os.analytics.sessions.detailSubagent
	.use(orgMiddleware)
	.handler(async ({ input, context, errors }) => {
		const ownerId = requireSessionDetailOwnerAccess(
			await getSessionDetailOwner(
				context.organizationId,
				input.sessionId,
				context.sessionReader,
			),
			context.sessionReader,
		);

		try {
			const result = await getSessionDetailSubagent({
				organizationId: context.organizationId,
				ownerId,
				revision: input.revision,
				sessionId: input.sessionId,
				subagentId: input.subagentId,
			});
			if (!result) {
				throw new ORPCError("NOT_FOUND");
			}
			return result;
		} catch (error) {
			return throwSessionDetailRevisionError(error, errors);
		}
	});

export const sessionsRouter = os.analytics.sessions.router({
	uploadFailures,
	detailBodyChunk,
	detailOverview,
	detailRelationships,
	detailInitial,
	detailSpine,
	detailSubagent,
	detailTurn,
	detailWindow,
	list,
	lastUpload,
	liveList,
	liveTail,
	agentRuns,
	agentTracesAccess,
	runAnswers,
	runCi,
	runQuestionTags,
	setupRuns,
	contextSnapshot,
	setupText,
	summaryLinks,
	fileChanges,
	costMaximum,
	filterCatalog,
	summaryComparison,
	dimensionAnalysis,
});
