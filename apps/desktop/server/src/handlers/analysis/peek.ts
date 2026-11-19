import { SLICE_MAX_ROWS } from "@rudel/api-routes";
import { orgMiddleware, os } from "../../middleware.js";
import { analysisLimiter } from "../../services/analysis/concurrency.js";
import type { SqlEnv } from "../../services/analysis/sql-gateway.js";
import { peekSql, sliceSql } from "../../services/analysis/sql-peek.js";
import type { SessionReader } from "../../services/session-visibility.js";
import { requireRetroTools } from "./retro-tools.js";
import { sqlError } from "./sql-error.js";

type Statement = { query: string; cohort?: string };

export function peekOutcome(
	context: { organizationId: string; sessionReader: SessionReader },
	statement: Statement,
	sqlEnv: SqlEnv,
	signal?: AbortSignal,
) {
	return peekSql(
		{ workspaceId: context.organizationId, reader: context.sessionReader },
		statement,
		sqlEnv,
		signal,
	).then((outcome) => {
		if (!outcome.ok) throw sqlError(outcome.error);
		return outcome.result;
	});
}

export function sliceOutcome(
	context: { organizationId: string; sessionReader: SessionReader },
	statement: Statement,
	sqlEnv: SqlEnv,
	signal?: AbortSignal,
) {
	return sliceSql(
		{ workspaceId: context.organizationId, reader: context.sessionReader },
		statement,
		sqlEnv,
		SLICE_MAX_ROWS,
		signal,
	).then((outcome) => {
		if (!outcome.ok) throw sqlError(outcome.error);
		return outcome.result;
	});
}

export function createPeekProcedures(sqlEnv: SqlEnv) {
	return {
		peek: os.analysis.peek
			.use(orgMiddleware)
			.use(({ context, next }) => {
				requireRetroTools(context);
				return next();
			})
			.use(({ context, next, signal }) =>
				analysisLimiter.run(context.user.id, async () => next(), signal),
			)
			.handler(({ input, context, signal }) =>
				peekOutcome(context, input, sqlEnv, signal),
			),
		slice: os.analysis.slice
			.use(orgMiddleware)
			.use(({ context, next }) => {
				requireRetroTools(context);
				return next();
			})
			.use(({ context, next, signal }) =>
				analysisLimiter.run(context.user.id, async () => next(), signal),
			)
			.handler(({ input, context, signal }) =>
				sliceOutcome(context, input, sqlEnv, signal),
			),
	};
}
