import {
	type Auth,
	actionGeneric,
	type DataModelFromSchemaDefinition,
	type DocumentByName,
	type GenericActionCtx,
	type GenericMutationCtx,
	type GenericQueryCtx,
	internalMutationGeneric,
	internalQueryGeneric,
	type MutationBuilder,
	mutationGeneric,
	type QueryBuilder,
	type QueryMeta,
	queryGeneric,
	type TableNamesInDataModel,
} from "convex/server";
import type {
	GenericValidator,
	Infer,
	ObjectType,
	PropertyValidators,
} from "convex/values";
import { API_ISSUER } from "./identity";
import type { schema } from "./schema";

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export type Doc<TTable extends TableNamesInDataModel<DataModel>> =
	DocumentByName<DataModel, TTable>;
export type QueryCtx = GenericQueryCtx<DataModel>;
export type MutationCtx = GenericMutationCtx<DataModel>;
export type ActionCtx = GenericActionCtx<DataModel>;

export const internalQuery: QueryBuilder<DataModel, "internal"> =
	internalQueryGeneric;
export const internalMutation: MutationBuilder<DataModel, "internal"> =
	internalMutationGeneric;

interface Definition<
	TCtx,
	TArgs extends PropertyValidators,
	TReturns extends GenericValidator,
> {
	args: TArgs;
	returns: TReturns;
	handler: (ctx: TCtx, args: ObjectType<TArgs>) => Promise<Infer<TReturns>>;
}

/** A public query only Opaline's API may call (see README). */
export function apiQuery<
	TArgs extends PropertyValidators,
	TReturns extends GenericValidator,
>({ args, returns, handler }: Definition<QueryCtx, TArgs, TReturns>) {
	return queryGeneric({
		args,
		returns,
		handler: async (ctx: QueryCtx, values: ObjectType<TArgs>) => {
			await requireApi(ctx);
			return handler(ctx, values);
		},
	});
}

/** A public mutation only Opaline's API may call (see README). */
export function apiMutation<
	TArgs extends PropertyValidators,
	TReturns extends GenericValidator,
>({ args, returns, handler }: Definition<MutationCtx, TArgs, TReturns>) {
	return mutationGeneric({
		args,
		returns,
		handler: async (ctx: MutationCtx, values: ObjectType<TArgs>) => {
			await requireApi(ctx);
			return handler(ctx, values);
		},
	});
}

/** A public action only Opaline's API may call (see README). */
export function apiAction<
	TArgs extends PropertyValidators,
	TReturns extends GenericValidator,
>({ args, returns, handler }: Definition<ActionCtx, TArgs, TReturns>) {
	return actionGeneric({
		args,
		returns,
		handler: async (ctx: ActionCtx, values: ObjectType<TArgs>) => {
			await requireApi(ctx);
			return handler(ctx, values);
		},
	});
}

/** The analysis by application id; a deleting analysis counts as missing. */
export async function findAnalysis(id: string, ctx: QueryCtx) {
	const analysis = await ctx.db
		.query("analyses")
		.withIndex("by_app_id", (index) => index.eq("id", id))
		.unique();
	return analysis?.deleting ? null : analysis;
}

export async function findStep(id: string, ctx: QueryCtx) {
	return ctx.db
		.query("steps")
		.withIndex("by_app_id", (index) => index.eq("id", id))
		.unique();
}

export async function findQuery(id: string, ctx: QueryCtx) {
	return ctx.db
		.query("queries")
		.withIndex("by_app_id", (index) => index.eq("id", id))
		.unique();
}

export async function findOutput(queryId: string, ctx: QueryCtx) {
	return ctx.db
		.query("queryOutputs")
		.withIndex("by_query", (index) => index.eq("queryId", queryId))
		.unique();
}

/**
 * True while this transaction has used less than half of every Convex
 * transaction limit (bytes and documents read and written, index ranges,
 * scheduled functions). Loops over data of unbounded size stop once it is
 * false; the other half always fits the document in hand and its related
 * reads, because no document exceeds 1 MiB.
 */
export async function hasHeadroom(ctx: { meta: QueryMeta }): Promise<boolean> {
	const metrics = await ctx.meta.getTransactionMetrics();
	return Object.values(metrics).every(
		({ used, remaining }) => used < remaining,
	);
}

/** A document without Convex's system fields, as the store interface returns it. */
export function withoutSystemFields<
	TDocument extends { _id: unknown; _creationTime: number },
>({ _id, _creationTime, ...fields }: TDocument) {
	return fields;
}

async function requireApi(ctx: { auth: Auth }) {
	const identity = await ctx.auth.getUserIdentity();
	if (identity?.issuer !== API_ISSUER)
		throw new Error("Only the Opaline API may use the analysis log");
}
