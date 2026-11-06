import { ORPCError } from "@orpc/server";
import type {
	AnalysisHost,
	AnalysisSqlOutput,
	CheckDefinition,
	ChecksResult,
} from "@rudel/api-routes";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import { orgMiddleware, os } from "../../middleware.js";
import {
	CHECKS_PER_MEMBER,
	type CheckScope,
	type CheckStore,
	checkQuery,
} from "../../services/analysis/checks.js";
import { analysisLimiter } from "../../services/analysis/concurrency.js";
import {
	LimitRefusal,
	limitRefusal,
} from "../../services/analysis/refused-split.js";
import {
	describeMeasure,
	listMeasures,
} from "../../services/analysis/retro-measures.js";
import {
	execute as executeSql,
	guardSql,
	runSql,
	type SqlEnv,
	withSqlLimits,
	wrapRows,
} from "../../services/analysis/sql-gateway.js";
import { captureCall } from "../../services/analysis-log/capture.js";
import type { AnalysisLog } from "../../services/analysis-log/types.js";
import type { SessionReader } from "../../services/session-visibility.js";
import { badRequest, measureStatement } from "./measure-statement.js";
import { patternStatement } from "./pattern-statement.js";
import { peekOutcome, sliceOutcome } from "./peek.js";
import { runDigest } from "./retro-digest.js";
import { requireRetroTools } from "./retro-tools.js";
import { sqlError } from "./sql-error.js";

interface MeasureEnv {
	readonly executor: ClickHouseExecutor;
	readonly sqlEnv: SqlEnv;
	readonly checks: CheckStore;
	readonly log: (workspaceId: string) => AnalysisLog | null;
	readonly author: (context: {
		organizationId: string;
		user: { id: string };
		session: { id: string } | null;
		apiKeyId: string | null;
	}) => { workspaceId: string; userId: string; host: AnalysisHost };
	readonly now?: () => Date;
}

interface Context {
	organizationId: string;
	user: { id: string };
	session: { id: string } | null;
	apiKeyId: string | null;
	sessionReader: SessionReader;
}

export function createMeasureProcedures(env: MeasureEnv) {
	const now = env.now ?? (() => new Date());
	const callerOf = (context: Context) => ({
		workspaceId: context.organizationId,
		reader: context.sessionReader,
	});

	const execute = async (
		context: Context,
		input: {
			query: string;
			title: string;
			cohort?: string;
			measure?: AnalysisSqlOutput["measure"];
			analysis?: string;
		},
		signal?: AbortSignal,
	): Promise<AnalysisSqlOutput> => {
		const outcome = await runSql(callerOf(context), input, env.sqlEnv, signal);
		if (!outcome.ok) throw sqlError(outcome.error);
		const trace = await captureCall(
			env.executor,
			env.log(context.organizationId),
			env.author(context),
			"sql",
			{
				query: input.query,
				title: input.title,
				...(input.analysis ? { analysis: input.analysis } : {}),
			},
			outcome.result,
			outcome.owners,
			outcome.result.sessions,
			outcome.quotes,
		).catch(async (error: unknown) => {
			await env.sqlEnv.results.discard(outcome.result.id);
			throw error;
		});
		return trace ? { ...outcome.result, trace } : outcome.result;
	};

	const evaluate = async (
		context: Context,
		name: string,
		definition: CheckDefinition,
		scope: CheckScope,
		analysis: string | undefined,
		signal?: AbortSignal,
	): Promise<ChecksResult> => {
		const built = checkQuery(name, definition, scope);
		if ("error" in built) throw badRequest(built.error);
		const result = await execute(
			context,
			{
				query: built.query,
				title: built.title,
				...(built.cohort ? { cohort: built.cohort } : {}),
				...(analysis ? { analysis } : {}),
			},
			signal,
		);
		return {
			check: { name, definition },
			over: built.over,
			matches: result.rows === 0 ? 0 : matchesOf(result),
			result,
		};
	};

	return {
		measures: {
			list: os.analysis.measures.list
				.use(orgMiddleware)
				.use(({ context, next }) => {
					requireRetroTools(context);
					return next();
				})
				.handler(() => ({ measures: listMeasures() })),
			describe: os.analysis.measures.describe
				.use(orgMiddleware)
				.use(({ context, next }) => {
					requireRetroTools(context);
					return next();
				})
				.handler(({ input }) => {
					const described = describeMeasure(input.name, now());
					if (!described)
						throw badRequest(
							`${input.name} is not a measure; measures action=list names them`,
						);
					return described;
				}),
			run: os.analysis.measures.run
				.use(orgMiddleware)
				.use(({ context, next }) => {
					requireRetroTools(context);
					return next();
				})
				.use(({ context, next, signal }) =>
					analysisLimiter.run(context.user.id, async () => next(), signal),
				)
				.handler(async ({ input, context, signal }) =>
					execute(context, measureStatement(input, now()), signal),
				),
			peek: os.analysis.measures.peek
				.use(orgMiddleware)
				.use(({ context, next }) => {
					requireRetroTools(context);
					return next();
				})
				.use(({ context, next, signal }) =>
					analysisLimiter.run(context.user.id, async () => next(), signal),
				)
				.handler(({ input, context, signal }) =>
					peekOutcome(
						context,
						measureStatement(input, now()),
						env.sqlEnv,
						signal,
					),
				),
			slice: os.analysis.measures.slice
				.use(orgMiddleware)
				.use(({ context, next }) => {
					requireRetroTools(context);
					return next();
				})
				.use(({ context, next, signal }) =>
					analysisLimiter.run(context.user.id, async () => next(), signal),
				)
				.handler(({ input, context, signal }) =>
					sliceOutcome(
						context,
						measureStatement(input, now()),
						env.sqlEnv,
						signal,
					),
				),
		},
		patterns: {
			list: os.analysis.patterns.list
				.use(orgMiddleware)
				.use(({ context, next }) => {
					requireRetroTools(context);
					return next();
				})
				.use(({ context, next, signal }) =>
					analysisLimiter.run(context.user.id, async () => next(), signal),
				)
				.handler(({ input, context, signal }) =>
					execute(
						context,
						patternStatement({ action: "list", ...input }, now()),
						signal,
					),
				),
			drill: os.analysis.patterns.drill
				.use(orgMiddleware)
				.use(({ context, next }) => {
					requireRetroTools(context);
					return next();
				})
				.use(({ context, next, signal }) =>
					analysisLimiter.run(context.user.id, async () => next(), signal),
				)
				.handler(({ input, context, signal }) =>
					execute(
						context,
						patternStatement({ action: "drill", ...input }, now()),
						signal,
					),
				),
			verify: os.analysis.patterns.verify
				.use(orgMiddleware)
				.use(({ context, next }) => {
					requireRetroTools(context);
					return next();
				})
				.use(({ context, next, signal }) =>
					analysisLimiter.run(context.user.id, async () => next(), signal),
				)
				.handler(({ input, context, signal }) =>
					execute(
						context,
						patternStatement({ action: "verify", ...input }, now()),
						signal,
					),
				),
			peek: os.analysis.patterns.peek
				.use(orgMiddleware)
				.use(({ context, next }) => {
					requireRetroTools(context);
					return next();
				})
				.use(({ context, next, signal }) =>
					analysisLimiter.run(context.user.id, async () => next(), signal),
				)
				.handler(async ({ input: { id, ...input }, context, signal }) => {
					const statement = patternStatement(
						id
							? { action: "drill", ...input, id }
							: { action: "list", ...input },
						now(),
					);
					const peeks = [];
					for (const part of statement.parts.queries)
						peeks.push(
							await peekOutcome(
								context,
								{ query: part.query, cohort: part.cohort ?? statement.cohort },
								env.sqlEnv,
								signal,
							),
						);
					return {
						rows: Math.min(
							input.limit,
							peeks.reduce((sum, peek) => sum + peek.rows, 0),
						),
						chars: peeks.reduce((sum, peek) => sum + peek.chars, 0),
						columns: peeks[0]?.columns ?? [],
						head: peeks.flatMap((peek) => peek.head).slice(0, 3),
						ms: peeks.reduce((sum, peek) => sum + peek.ms, 0),
					};
				}),
			digest: os.analysis.patterns.digest
				.use(orgMiddleware)
				.use(({ context, next }) => {
					requireRetroTools(context);
					return next();
				})
				.use(({ context, next, signal }) =>
					analysisLimiter.run(context.user.id, async () => next(), signal),
				)
				.handler(async ({ input, context, signal }) => {
					const limited = withSqlLimits(env.executor);
					const result = await runDigest(
						{
							workspaceId: context.organizationId,
							view: async (query, cohort, rows) => {
								const outcome = await executeSql(
									callerOf(context),
									query,
									env.sqlEnv,
									signal,
									async (found) => found,
									rows ? wrapRows(rows) : undefined,
									cohort,
								);
								if (!outcome.ok)
									throw limitRefusal(outcome.error) ?? sqlError(outcome.error);
								return outcome.value;
							},
							trusted: (statement) =>
								limited.query({
									...statement,
									clickhouse_settings: { readonly: "1" },
								}),
						},
						input,
						now(),
					).catch((error: unknown) => {
						if (error instanceof LimitRefusal) throw sqlError(error.failure);
						throw error;
					});
					return {
						text: result.text,
						ms: result.ms,
						from: result.from,
						to: result.to,
						digest: result.digest,
					};
				}),
		},
		checks: {
			test: os.analysis.checks.test
				.use(orgMiddleware)
				.use(({ context, next }) => {
					requireRetroTools(context);
					return next();
				})
				.use(({ context, next, signal }) =>
					analysisLimiter.run(context.user.id, async () => next(), signal),
				)
				.handler(({ input, context, signal }) =>
					evaluate(
						context,
						"test",
						input.definition,
						{ kind: "last", last: input.last, today: now() },
						input.analysis,
						signal,
					),
				),
			create: os.analysis.checks.create
				.use(orgMiddleware)
				.use(({ context, next }) => {
					requireRetroTools(context);
					return next();
				})
				.handler(async ({ input, context }) => {
					const owner = {
						workspaceId: context.organizationId,
						authorId: context.user.id,
					};
					const built = checkQuery(input.name, input.definition, {
						kind: "last",
						last: 1,
						today: now(),
					});
					if ("error" in built) throw badRequest(built.error);
					const refused = guardSql(callerOf(context), built.query);
					if (refused) throw sqlError(refused);
					if ((await env.checks.list(owner)).length >= CHECKS_PER_MEMBER)
						throw badRequest(
							`you have ${CHECKS_PER_MEMBER} checks, the most a member keeps`,
						);
					const check = await env.checks.create({
						...owner,
						name: input.name,
						definition: input.definition,
					});
					return {
						check,
						notices: [
							"Saved off: nothing runs checks on a schedule yet. Run it with checks action=run and its id over a window to see whether the failure still happens.",
						],
					};
				}),
			list: os.analysis.checks.list
				.use(orgMiddleware)
				.use(({ context, next }) => {
					requireRetroTools(context);
					return next();
				})
				.handler(async ({ context }) => ({
					checks: await env.checks.list({
						workspaceId: context.organizationId,
						authorId: context.user.id,
					}),
				})),
			run: os.analysis.checks.run
				.use(orgMiddleware)
				.use(({ context, next }) => {
					requireRetroTools(context);
					return next();
				})
				.use(({ context, next, signal }) =>
					analysisLimiter.run(context.user.id, async () => next(), signal),
				)
				.handler(async ({ input, context, signal }) => {
					const check = await env.checks.get(
						{ workspaceId: context.organizationId, authorId: context.user.id },
						input.id,
					);
					if (!check)
						throw new ORPCError("NOT_FOUND", {
							message: `No check ${input.id} of yours; checks action=list shows them`,
						});
					return evaluate(
						context,
						check.name,
						check.definition,
						{ kind: "window", from: input.from, to: input.to, today: now() },
						input.analysis,
						signal,
					);
				}),
		},
	};
}

function matchesOf(result: AnalysisSqlOutput): number | null {
	const header = result.table.split("\n")[0]?.split(" | ") ?? [];
	const index = header.indexOf("matches");
	const first = result.table.split("\n")[1]?.split(" | ") ?? [];
	const value = Number(first[index]);
	return index === -1 || !Number.isFinite(value) ? null : value;
}
