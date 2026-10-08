import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type { AnalysisFindInput } from "@rudel/api-routes";
import { z } from "zod";

/**
 * A find page's position: the sort key of its last item. Keys order items
 * totally (every key ends in an identity such as the run ref), so the next
 * page is exactly the items after it, whatever was added since.
 */
export type CursorKey = readonly (string | number | null)[];
/** Direction of each key element; `null` sorts as the lowest value. */
export type CursorOrder = readonly ("asc" | "desc")[];

/** Arguments that do not change which items follow a position. */
const PAGE_INDEPENDENT = new Set(["cursor", "limit", "analysis"]);

const CursorSchema = z
	.object({
		f: z.string(),
		k: z.array(z.union([z.string(), z.number(), z.null()])),
	})
	.strict();

/**
 * The position `input.cursor` encodes, or undefined on the first page. A
 * cursor that is malformed or from a call with other arguments is a
 * BAD_REQUEST telling the agent what to pass instead.
 */
export function readFindCursor(
	input: AnalysisFindInput,
	order: CursorOrder,
): CursorKey | undefined {
	if (input.cursor === undefined) return undefined;
	const parsed = CursorSchema.safeParse(decode(input.cursor));
	if (!parsed.success || parsed.data.k.length !== order.length)
		throw cursorError(
			"not a cursor returned by find; pass the header's cursor unchanged, or omit it to start from the first page",
		);
	if (parsed.data.f !== fingerprint(input))
		throw cursorError(
			"returned by a find call with other arguments; repeat that call's arguments (only limit may change), or omit cursor to start from the first page",
		);
	return parsed.data.k;
}

/** The cursor continuing after the item whose sort key is `key`. */
export function writeFindCursor(
	input: AnalysisFindInput,
	key: CursorKey,
): string {
	return Buffer.from(
		JSON.stringify({ f: fingerprint(input), k: key }),
	).toString("base64url");
}

/**
 * Up to `limit` items after `after` in key order, and whether more follow.
 * The same comparison sorts and pages, so pages never overlap or skip.
 */
export function takePage<TItem>(
	items: readonly TItem[],
	keyOf: (item: TItem) => CursorKey,
	order: CursorOrder,
	after: CursorKey | undefined,
	limit: number,
): { page: TItem[]; more: boolean } {
	const rest = items
		.map((item) => ({ item, key: keyOf(item) }))
		.filter(({ key }) => isAfter(key, after, order))
		.sort((left, right) => compareKeys(left.key, right.key, order))
		.map(({ item }) => item);
	return { page: rest.slice(0, limit), more: rest.length > limit };
}

export function isAfter(
	key: CursorKey,
	after: CursorKey | undefined,
	order: CursorOrder,
): boolean {
	return after === undefined || compareKeys(key, after, order) > 0;
}

export function compareKeys(
	left: CursorKey,
	right: CursorKey,
	order: CursorOrder,
): number {
	for (const [index, direction] of order.entries()) {
		const difference = compareValues(left[index] ?? null, right[index] ?? null);
		if (difference) return direction === "asc" ? difference : -difference;
	}
	return 0;
}

/**
 * Numbers numerically, strings by code point (total, unlike locale order):
 * the order of UTF-8 bytes, as ClickHouse and Postgres `COLLATE "C"` compare
 * strings, so SQL keysets and merged pages agree beyond the BMP.
 */
function compareValues(
	left: string | number | null,
	right: string | number | null,
): number {
	if (left === right) return 0;
	if (left === null) return -1;
	if (right === null) return 1;
	if (typeof left === "number" && typeof right === "number")
		return left - right;
	return compareCodePoints(`${left}`, `${right}`);
}

function compareCodePoints(left: string, right: string): number {
	const length = Math.min(left.length, right.length);
	for (let index = 0; index < length; index++) {
		const a = left.charCodeAt(index);
		const b = right.charCodeAt(index);
		// Surrogates (supplementary code points) sort after the rest of the BMP.
		if (a !== b) return codePointRank(a) - codePointRank(b);
	}
	return left.length - right.length;
}

function codePointRank(unit: number): number {
	if (unit >= 0xd800 && unit <= 0xdfff) return unit + 0x2000;
	return unit >= 0xe000 ? unit - 0x800 : unit;
}

function fingerprint(input: AnalysisFindInput): string {
	const args = Object.entries(input)
		.filter(([key, value]) => !PAGE_INDEPENDENT.has(key) && value !== undefined)
		.sort(([left], [right]) => (left < right ? -1 : 1));
	return createHash("sha256")
		.update(JSON.stringify(args))
		.digest("base64url")
		.slice(0, 16);
}

function decode(cursor: string): unknown {
	try {
		return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
	} catch {
		return undefined;
	}
}

function cursorError(reason: string): ORPCError<"BAD_REQUEST", unknown> {
	return new ORPCError("BAD_REQUEST", { message: `cursor: ${reason}` });
}
