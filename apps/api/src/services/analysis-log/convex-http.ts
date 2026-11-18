import { z } from "zod";

/**
 * A Convex client over Convex's documented HTTP API
 * (https://docs.convex.dev/http-api/). The API must not load the `convex`
 * npm package at runtime: Vercel's function file tracer does not package it,
 * so every function would crash at boot.
 *
 * It sends what `ConvexHttpClient` sends (POST `/api/<type>` with the
 * function path and its arguments, a Bearer token), in the documented
 * `json` format instead of the client's internal `convex_encoded_json`; the
 * arguments and results of the analysis log are plain JSON either way.
 */

export type ConvexFunctionType = "query" | "mutation" | "action";

/**
 * Why a call failed. Server text is never kept: Convex error messages can
 * repeat the rejected arguments.
 */
export type ConvexFailure =
	/** The function threw a `ConvexError`; `data` is its payload. */
	| { kind: "convexError"; data: unknown }
	/** The function threw any other error, or does not exist or rejected the token. */
	| { kind: "functionError" }
	/** Convex answered with an HTTP error before running the function. */
	| { kind: "httpError"; status: number }
	/** Convex answered with something other than a function result. */
	| { kind: "invalidResponse" }
	/** The arguments hold a value Convex cannot receive as JSON. */
	| { kind: "invalidArguments" };

export type ConvexCall = (
	type: ConvexFunctionType,
	path: string,
	args: Record<string, unknown>,
	options: { token: string; signal: AbortSignal },
) => Promise<unknown>;

/** Convex's status for a function that ran and failed (`ConvexHttpClient`'s STATUS_CODE_UDF_FAILED). */
const FUNCTION_FAILED_STATUS = 560;

const ResponseSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("success"), value: z.unknown() }),
	z.object({
		status: z.literal("error"),
		errorData: z.unknown().optional(),
	}),
]);

/** A failed Convex call. Its message names the function and the kind of failure only. */
export class ConvexCallError extends Error {
	override name = "ConvexCallError";
	constructor(
		readonly path: string,
		readonly failure: ConvexFailure,
	) {
		super(`Convex ${path} failed (${describeFailure(failure)})`);
	}
}

/**
 * Calls the public functions of the deployment at `url`. Aborts and timeouts
 * of `signal` reject with the fetch's own `AbortError` or `TimeoutError`.
 */
export function createConvexHttpClient(url: string): ConvexCall {
	const address = deploymentAddress(url);
	return async (type, path, args, { token, signal }) => {
		assertJsonValue(args, path);
		const response = await fetch(`${address}/api/${type}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ path, args, format: "json" }),
			signal,
		});
		if (!response.ok && response.status !== FUNCTION_FAILED_STATUS) {
			await response.body?.cancel();
			throw new ConvexCallError(path, {
				kind: "httpError",
				status: response.status,
			});
		}
		const parsed = ResponseSchema.safeParse(await readJson(response, path));
		if (!parsed.success)
			throw new ConvexCallError(path, { kind: "invalidResponse" });
		if (parsed.data.status === "success") return parsed.data.value;
		// Like ConvexHttpClient: errorData is present exactly when the function threw a ConvexError.
		throw new ConvexCallError(
			path,
			parsed.data.errorData === undefined
				? { kind: "functionError" }
				: { kind: "convexError", data: parsed.data.errorData },
		);
	};
}

/** The deployment URL without a trailing slash, checked as ConvexHttpClient checks it. */
function deploymentAddress(url: string): string {
	if (!URL.canParse(url) || !/^https?:/.test(url))
		throw new Error(
			"Invalid Convex deployment URL: it must be an http(s) URL such as https://<deployment>.convex.cloud",
		);
	if (url.replace(/\/+$/, "").endsWith(".convex.site"))
		throw new Error(
			"Invalid Convex deployment URL: .convex.site serves HTTP actions; use the deployment's .convex.cloud URL",
		);
	return url.replace(/\/+$/, "");
}

async function readJson(response: Response, path: string): Promise<unknown> {
	const text = await response.text();
	try {
		return JSON.parse(text);
	} catch {
		throw new ConvexCallError(path, { kind: "invalidResponse" });
	}
}

/**
 * Refuses what ConvexHttpClient refuses before sending (undefined array
 * items, non-finite numbers, bigints, dates, class instances) instead of
 * letting `JSON.stringify` silently change it. Undefined object fields are
 * dropped, as Convex drops them.
 */
function assertJsonValue(value: unknown, path: string): void {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	)
		return;
	if (Array.isArray(value)) {
		for (const item of value) assertJsonValue(item, path);
		return;
	}
	if (isPlainObject(value)) {
		for (const field of Object.values(value))
			if (field !== undefined) assertJsonValue(field, path);
		return;
	}
	throw new ConvexCallError(path, { kind: "invalidArguments" });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function describeFailure(failure: ConvexFailure): string {
	switch (failure.kind) {
		case "convexError":
			return "ConvexError";
		case "functionError":
			return "Error";
		case "httpError":
			return `HTTP ${failure.status}`;
		case "invalidResponse":
			return "invalid response";
		case "invalidArguments":
			return "invalid arguments";
	}
}
