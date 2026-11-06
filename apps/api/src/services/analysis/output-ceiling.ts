import type {
	AnalysisFindOutput,
	AnalysisReadOutput,
	AnalysisTrace,
} from "@rudel/api-routes";
import {
	fitRows,
	fitToBudget,
	omittedMarker,
	responseBudget,
	type Verbosity,
} from "./compact.js";
import { findRowCosts, renderFind } from "./find-text.js";

type Header = AnalysisFindOutput["header"];

/**
 * Largest find or read result, in UTF-8 bytes of its JSON. The analysis log
 * stores exactly the returned result, so one stored result stays a quarter of
 * Convex's 1 MiB document limit.
 */
export const ANALYSIS_OUTPUT_MAX_BYTES = 256 * 1024;
/**
 * Bytes kept free for the trace the handler adds after capture
 * (`header.trace` on find, `trace` on read): three ids take about 170 bytes
 * even at 40 characters each. Fitting stops this far below the ceiling, so
 * the stored result is exactly the returned one and the response still fits.
 */
export const TRACE_RESERVE_BYTES = 256;
const BODY_MAX_BYTES = ANALYSIS_OUTPUT_MAX_BYTES - TRACE_RESERVE_BYTES;
const TRACE_RESERVE_CHARS = 200;

export function fitFindOutput(
	output: AnalysisFindOutput,
	cursorAfter: (index: number) => string | undefined = () => undefined,
	verbosity: Verbosity = "full",
): AnalysisFindOutput {
	return fitStoredFindOutput(
		fitDeliveredFindOutput(output, cursorAfter, verbosity),
		cursorAfter,
	);
}

export function fitDeliveredFindOutput(
	full: AnalysisFindOutput,
	cursorAfter: (index: number) => string | undefined,
	verbosity: Verbosity = "full",
): AnalysisFindOutput {
	const budget = responseBudget(verbosity) - TRACE_RESERVE_CHARS;
	const measure = (fitted: AnalysisFindOutput) =>
		renderFind(fitted, verbosity).length;
	if (measure(full) <= budget) return full;
	const output =
		full.source === "git"
			? fitWitnesses(full, budget, (value) =>
					measure(value as AnalysisFindOutput),
				)
			: full;
	const items = findItems(output);
	const costs = findRowCosts(output, verbosity);
	const withCount = (count: number): AnalysisFindOutput => {
		if (count >= items.length) return output;
		const cursor = count > 0 ? cursorAfter(count - 1) : undefined;
		return items.build(count, {
			...output.header,
			truncated: true,
			omitted: items.length - count,
			cursor,
		});
	};
	const baseCost = measure(withCount(0));
	return fitToBudget(
		budget,
		(walkBudget) => withCount(fitRows(costs, walkBudget, baseCost)),
		withCount(0),
		measure,
	);
}

function findItems(output: AnalysisFindOutput): {
	length: number;
	build: (count: number, header: Header) => AnalysisFindOutput;
} {
	if ("sessions" in output)
		return {
			length: output.sessions.length,
			build: (count, header) => ({
				...output,
				header,
				sessions: output.sessions.slice(0, count),
			}),
		};
	if ("rows" in output)
		return {
			length: output.rows.length,
			build: (count, header) =>
				({
					...output,
					header,
					rows: output.rows.slice(0, count),
				}) as AnalysisFindOutput,
		};
	if (output.source === "user" || output.source === "git")
		return {
			length: output.events.length,
			build: (count, header) =>
				({
					...output,
					header,
					events: output.events.slice(0, count),
				}) as AnalysisFindOutput,
		};
	if (output.source === "weekly")
		return {
			length: output.totals.length,
			build: (count, header) => ({
				...output,
				header,
				totals: output.totals.slice(0, count),
			}),
		};
	return {
		length: output.groups.length,
		build: (count, header) =>
			({
				...output,
				header,
				groups: output.groups.slice(0, count),
			}) as AnalysisFindOutput,
	};
}

function fitStoredFindOutput(
	output: AnalysisFindOutput,
	cursorAfter: (index: number) => string | undefined,
): AnalysisFindOutput {
	if (jsonBytes(output) <= BODY_MAX_BYTES) return output;
	const page = { header: output.header, cursorAfter };
	if ("sessions" in output)
		return fitItems(page, output.sessions, "sessions", (sessions, header) => ({
			...output,
			header,
			sessions,
		}));
	if (output.source === "calls")
		return "rows" in output
			? fitItems(page, output.rows, "rows", (rows, header) => ({
					...output,
					header,
					rows,
				}))
			: fitItems(page, output.groups, "groups", (groups, header) => ({
					...output,
					header,
					groups,
				}));
	if ("rows" in output)
		return fitItems(page, output.rows, "rows", (rows, header) => ({
			...output,
			header,
			rows,
		}));
	if (output.source === "user")
		return fitItems(page, output.events, "events", (events, header) => ({
			...output,
			header,
			events,
		}));
	if (output.source === "git") {
		const fitted = fitWitnesses(output, BODY_MAX_BYTES, jsonBytes);
		if (jsonBytes(fitted) <= BODY_MAX_BYTES) return fitted;
		return fitItems(
			{ ...page, header: fitted.header },
			fitted.events,
			"events",
			(events, header) => ({ ...fitted, header, events }),
		);
	}
	if (output.source === "weekly")
		return fitItems(page, output.totals, "totals", (totals, header) => ({
			...output,
			header,
			totals,
		}));
	if (output.source === "tool")
		return fitItems(page, output.groups, "groups", (groups, header) => ({
			...output,
			header,
			groups,
		}));
	return fitItems(page, output.groups, "groups", (groups, header) => ({
		...output,
		header,
		groups,
	}));
}

function fitWitnesses(
	output: Extract<AnalysisFindOutput, { source: "git" }>,
	budget: number,
	measure: (value: unknown) => number,
): Extract<AnalysisFindOutput, { source: "git" }> {
	const witnesses = output.witnesses ?? [];
	if (witnesses.length === 0) return output;
	const share = output.events.length > 0 ? budget / 4 : budget;
	const withWitnesses = (
		count: number,
		events: typeof output.events,
	): Extract<AnalysisFindOutput, { source: "git" }> =>
		count === witnesses.length
			? { ...output, events }
			: {
					...output,
					events,
					witnesses: witnesses.slice(0, count),
					header: {
						...output.header,
						truncated: true,
						notes: [
							...output.header.notes,
							`${omittedMarker(witnesses.length - count, "witnesses")}; narrow the dates or sessions to see them`,
						],
					},
				};
	const kept =
		fitCount(
			witnesses.length,
			(count) => withWitnesses(count, []),
			share,
			measure,
		).witnesses?.length ?? 0;
	return withWitnesses(kept, output.events);
}

/**
 * The read result with as many leading sections as fit
 * `ANALYSIS_OUTPUT_MAX_BYTES` with its trace; reads that lost sections are
 * truncated.
 */
export function fitReadOutput(output: AnalysisReadOutput): AnalysisReadOutput {
	const total = output.reads.reduce(
		(sum, read) => sum + read.sections.length,
		0,
	);
	return fitCount(total, (count) => {
		if (count === total) return output;
		let left = count;
		const reads = output.reads.map((read) => {
			const sections = read.sections.slice(0, left);
			left -= sections.length;
			return sections.length === read.sections.length
				? read
				: { ...read, sections, truncated: true };
		});
		return { ...output, reads, truncated: true };
	});
}

/** The find response: the fitted result with the trace it was stored under. */
export function withFindTrace(
	output: AnalysisFindOutput,
	trace: AnalysisTrace,
): AnalysisFindOutput {
	return { ...output, header: { ...output.header, trace } };
}

/** The read response: the fitted result with the trace it was stored under. */
export function withReadTrace(
	output: AnalysisReadOutput,
	trace: AnalysisTrace,
): AnalysisReadOutput {
	return { ...output, trace };
}

export function jsonBytes(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value));
}

function fitItems<TItem>(
	{
		header,
		cursorAfter,
	}: {
		header: Header;
		cursorAfter: (index: number) => string | undefined;
	},
	items: readonly TItem[],
	noun: string,
	build: (items: TItem[], header: Header) => AnalysisFindOutput,
): AnalysisFindOutput {
	return fitCount(items.length, (count) => {
		const kept = items.slice(0, count);
		if (count === items.length) return build(kept, header);
		const cursor = count > 0 ? cursorAfter(count - 1) : undefined;
		return build(kept, {
			...header,
			truncated: true,
			notes: [
				...header.notes,
				`only the first ${count} of ${items.length} ${noun} fit the ${ANALYSIS_OUTPUT_MAX_BYTES / 1024} KiB result ceiling; ${cursor ? "pass the cursor for the rest, or " : ""}narrow the scope or lower limit`,
			],
			cursor,
		});
	});
}

/** `build(count)` for the largest `count` up to `total` whose JSON fits `budget` (leaving the trace room). */
export function fitCount<TOutput>(
	total: number,
	build: (count: number) => TOutput,
	budget = BODY_MAX_BYTES,
	measure: (value: TOutput) => number = jsonBytes,
): TOutput {
	const full = build(total);
	if (measure(full) <= budget) return full;
	let low = 0;
	let high = total - 1;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (measure(build(middle)) <= budget) low = middle;
		else high = middle - 1;
	}
	return build(low);
}
