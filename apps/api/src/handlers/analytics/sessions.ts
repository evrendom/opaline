import { ORPCError } from "@orpc/server";
import { sqlClient } from "../../db.js";
import { orgMiddleware, os } from "../../middleware.js";
import { isLiveSessionsReadable } from "../../services/live-session/live-session-config.js";
import { LiveSessionStorageError } from "../../services/live-session/live-session-gate.js";
import { getLiveSessionR2Client } from "../../services/live-session/live-session-r2.js";
import {
	listLiveSessions,
	readLiveSession,
	readLiveSessionTail,
} from "../../services/live-session/live-session-read.service.js";
import { readR2IngestAvailability } from "../../services/r2-ingest-storage.service.js";
import {
	getSessionAnalytics,
	getSessionAnalyticsSummaryComparison,
	getSessionDimensionAnalysis,
} from "../../services/session-analytics.service.js";
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
import { getSessionFilterCatalog } from "../../services/session-list-filters.js";
import { readNativeSessionRelationships } from "../../services/session-native-lineage.service.js";
import { getSessionOwner } from "../../services/session-ownership.service.js";
import {
	readableSessionOwner,
	type SessionReader,
} from "../../services/session-visibility.js";
import { listUploadFailures } from "../../services/upload-failure.service.js";
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

const liveList = os.analytics.sessions.liveList
	.use(orgMiddleware)
	.handler(async ({ context }) => ({
		sessions: !isLiveSessionsReadable(context.organizationId)
			? []
			: await listLiveSessions(
					{
						organizationId: context.organizationId,
						ownerId: readableSessionOwner(context.sessionReader),
					},
					{ database: sqlClient, now: () => new Date() },
				),
	}));

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

const list = os.analytics.sessions.list
	.use(orgMiddleware)
	.handler(async ({ input, context }) => {
		return getSessionAnalytics(context.organizationId, {
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
		});
	});

const filterCatalog = os.analytics.sessions.filterCatalog
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		getSessionFilterCatalog(context.organizationId, {
			days: input.days,
			start_date: input.startDate,
			end_date: input.endDate,
		}),
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
	liveList,
	liveTail,
	filterCatalog,
	summaryComparison,
	dimensionAnalysis,
});
