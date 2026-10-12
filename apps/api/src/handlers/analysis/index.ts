import { ORPCError } from "@orpc/server";
import { redactReturnedValue } from "@rudel/secret-filter";
import { type ClickHouseExecutor, getClickhouse } from "../../clickhouse.js";
import { sqlClient } from "../../db.js";
import { orgMiddleware, os } from "../../middleware.js";
import {
	type AgentQueryLimiter,
	createAgentQueryLimiter,
	createPostgresAgentQuerySlots,
} from "../../services/analysis/agent-query-slots.js";
import { analysisLimiter } from "../../services/analysis/concurrency.js";
import { findAnalysisWithOwners } from "../../services/analysis/find.service.js";
import {
	withFindTrace,
	withReadTrace,
} from "../../services/analysis/output-ceiling.js";
import { readAnalysis } from "../../services/analysis/read.service.js";
import { budgetReadOutput } from "../../services/analysis/read-output.js";
import { findScope } from "../../services/analysis/scope.js";
import {
	describeSchema,
	describeSqlFailure,
	runSql,
	type SqlFailure,
} from "../../services/analysis/sql-gateway.js";
import {
	createPostgresSqlQuota,
	createPostgresSqlResultStore,
	type SqlQuota,
	type SqlResultStore,
} from "../../services/analysis/sql-results.js";
import {
	getAnalysisTree,
	getStoredQuery,
	saveAnalysis,
	searchAnalyses,
	shareAnalysis,
} from "../../services/analysis-log/analysis-log.service.js";
import { captureCall, hostOf } from "../../services/analysis-log/capture.js";
import {
	getAnalysisLog,
	restrictsAnalysisResults,
} from "../../services/analysis-log/config.js";
import { describeSessions } from "../../services/analysis-log/sessions.js";
import type { AnalysisLog } from "../../services/analysis-log/types.js";
import { getSessionOwner } from "../../services/session-ownership.service.js";
import {
	readableSessionOwner,
	type SessionReader,
} from "../../services/session-visibility.js";
import { requireSessionDetailOwnerAccess } from "../analytics/session-detail-access.js";

/** Why history calls fail where the log is off, phrased for the calling agent. */
export const ANALYSIS_HISTORY_OFF =
	"Analysis history is off for this workspace; answer with find and read, and skip search_answers, save_answer and share_answer.";

/** Longest rendered trace line ("trace analysis=… step=… query=…") plus its newline. */
const TRACE_LINE_RESERVE = 80;

interface AnalysisEnv {
	executor: ClickHouseExecutor;
	/** The log of a workspace, or null where it is off. */
	log?: (workspaceId: string) => AnalysisLog | null;
	/** Where sql results are stored; Postgres by default. */
	sqlResults?: SqlResultStore;
	/** The per-workspace sql quota; Postgres by default. */
	sqlQuota?: SqlQuota;
	/** The query slots shared by every instance; Postgres by default. */
	queryLimiter?: AgentQueryLimiter;
}

export function createAnalysisRouter(
	env: AnalysisEnv = { executor: getClickhouse() },
) {
	const analysisLog = env.log ?? getAnalysisLog;
	const author = (context: {
		organizationId: string;
		user: { id: string };
		session: { id: string } | null;
		apiKeyId: string | null;
	}) => ({
		workspaceId: context.organizationId,
		userId: context.user.id,
		host: hostOf(context),
	});

	const find = os.analysis.find
		.use(orgMiddleware)
		// One slot per call, held until the response and its log capture are done.
		// The MCP tools call this procedure too, so the cap covers both entry points.
		.use(({ context, next, signal }) =>
			analysisLimiter.run(context.user.id, async () => next(), signal),
		)
		.handler(async ({ input, context }) => {
			// Only a member limited to own sessions cannot name another member.
			if (input.userId && readableSessionOwner(context.sessionReader) !== null)
				throw new ORPCError("FORBIDDEN", {
					message: "Only workspace admins may filter by userId",
				});
			const found = await findAnalysisWithOwners(
				findScope(context.organizationId, context.sessionReader, input),
				input,
				env,
			);
			const { owners } = found;
			// Credentials never leave in a result or its stored evidence.
			const output = redactReturnedValue(found.output);
			const trace = await captureCall(
				env.executor,
				analysisLog(context.organizationId),
				author(context),
				"find",
				input,
				output,
				owners,
			);
			return trace ? withFindTrace(output, trace) : output;
		});

	const read = os.analysis.read
		.use(orgMiddleware)
		// One slot per call, held until the response and its log capture are done.
		// The MCP tools call this procedure too, so the cap covers both entry points.
		.use(({ context, next, signal }) =>
			analysisLimiter.run(context.user.id, async () => next(), signal),
		)
		.handler(async ({ input, context }) => {
			const owners = new Map<string, string>();
			for (const sessionId of new Set(input.refs.map((ref) => ref.sessionId))) {
				const ownerId = requireSessionDetailOwnerAccess(
					await getSessionOwner(context.organizationId, sessionId),
					context.sessionReader,
				);
				owners.set(sessionId, ownerId);
			}
			const log = analysisLog(context.organizationId);
			const read = await readAnalysis(
				context.organizationId,
				owners,
				input,
				env,
			);
			// Keep room for the trace line so the rendered read stays within maxChars.
			const fitted =
				log && input.maxChars > TRACE_LINE_RESERVE * 2
					? budgetReadOutput(read, input.maxChars - TRACE_LINE_RESERVE)
					: read;
			// Credentials never leave in a result or its stored evidence.
			const output = redactReturnedValue(fitted);
			const trace = await captureCall(
				env.executor,
				log,
				author(context),
				"read",
				input,
				output,
				[...new Set(owners.values())],
			);
			return trace && fitted !== read ? withReadTrace(output, trace) : output;
		});

	const sqlEnv = {
		executor: env.executor,
		results: env.sqlResults ?? createPostgresSqlResultStore(sqlClient),
		quota: env.sqlQuota ?? createPostgresSqlQuota(sqlClient),
		limiter:
			env.queryLimiter ??
			createAgentQueryLimiter(createPostgresAgentQuerySlots(sqlClient)),
	};
	const callerOf = (context: {
		organizationId: string;
		sessionReader: SessionReader;
	}) => ({
		workspaceId: context.organizationId,
		reader: context.sessionReader,
	});

	const schema = os.analysis.schema
		.use(orgMiddleware)
		.use(({ context, next, signal }) =>
			analysisLimiter.run(context.user.id, async () => next(), signal),
		)
		.handler(async ({ input, context, signal }) => {
			const described = await describeSchema(
				callerOf(context),
				input,
				sqlEnv,
				signal,
			);
			if (!described.ok) throw sqlError(described.error);
			return described.result;
		});

	const sql = os.analysis.sql
		.use(orgMiddleware)
		// One slot per call, like find and read: the MCP tool calls this too.
		.use(({ context, next, signal }) =>
			analysisLimiter.run(context.user.id, async () => next(), signal),
		)
		.handler(async ({ input, context, signal }) => {
			const outcome = await runSql(callerOf(context), input, sqlEnv, signal);
			if (!outcome.ok) throw sqlError(outcome.error);
			// Recorded like find: exact arguments and result, the sessions it
			// names and every member whose sessions it could read (ADR 0001).
			// A draft id the log refuses fails the call, so its result goes too.
			const trace = await captureCall(
				env.executor,
				analysisLog(context.organizationId),
				author(context),
				"sql",
				input,
				outcome.result,
				outcome.owners,
				outcome.result.sessions,
			).catch(async (error: unknown) => {
				await sqlEnv.results.discard(outcome.result.id);
				throw error;
			});
			return trace ? { ...outcome.result, trace } : outcome.result;
		});

	const viewerOf = (context: {
		organizationId: string;
		user: { id: string };
		isOrgAdmin: boolean;
		sessionReader: SessionReader;
	}) => ({
		workspaceId: context.organizationId,
		userId: context.user.id,
		isAdmin: context.isOrgAdmin,
		restrictResults: restrictsAnalysisResults({
			id: context.organizationId,
			ownSessionsOnly: context.sessionReader.ownSessionsOnly,
		}),
	});
	const requireLog = (context: { organizationId: string }): AnalysisLog => {
		const log = analysisLog(context.organizationId);
		// Agents read this message (the analyses MCP tool returns it as text).
		if (!log)
			throw new ORPCError("PRECONDITION_FAILED", {
				message: ANALYSIS_HISTORY_OFF,
			});
		return log;
	};

	const history = {
		search: os.analysis.history.search
			.use(orgMiddleware)
			.handler(({ input, context }) =>
				searchAnalyses(requireLog(context), viewerOf(context), input),
			),
		get: os.analysis.history.get
			.use(orgMiddleware)
			.handler(({ input, context }) =>
				getAnalysisTree(requireLog(context), viewerOf(context), input.analysis),
			),
		query: os.analysis.history.query
			.use(orgMiddleware)
			.handler(({ input, context }) =>
				getStoredQuery(
					requireLog(context),
					viewerOf(context),
					input.query,
					async (sessions) => {
						const now = await describeSessions(
							env.executor,
							context.organizationId,
							sessions.map((session) => session.sessionId),
						);
						return new Map(now.map((session) => [session.sessionId, session]));
					},
				),
			),
		save: os.analysis.history.save
			.use(orgMiddleware)
			.handler(({ input, context }) =>
				saveAnalysis(requireLog(context), viewerOf(context), input),
			),
		share: os.analysis.history.share
			.use(orgMiddleware)
			.handler(({ input, context }) =>
				shareAnalysis(
					requireLog(context),
					viewerOf(context),
					input.analysis,
					input.shared,
				),
			),
	};

	return { find, read, schema, sql, history };
}

/** Recoverable refusals are bad requests; fatal ones are forbidden. Both carry the class. */
function sqlError(failure: SqlFailure): ORPCError<string, unknown> {
	return new ORPCError(failure.kind === "fatal" ? "FORBIDDEN" : "BAD_REQUEST", {
		message: describeSqlFailure(failure),
		data: {
			kind: failure.kind,
			fragment: failure.fragment,
			fix: failure.fix,
		},
	});
}

export const analysisRouter = createAnalysisRouter();
