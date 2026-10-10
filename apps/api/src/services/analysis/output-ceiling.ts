import type {
	AnalysisFindOutput,
	AnalysisReadOutput,
	AnalysisTrace,
} from "@rudel/api-routes";

type Header = AnalysisFindOutput["header"];

/**
 * Largest find or read result, in UTF-8 bytes of its JSON. The analysis log
 * stores exactly the returned result, so one stored result stays a quarter of
 * Convex's 1 MiB document limit; at about four bytes a token it is also some
 * 64k agent tokens, more than one answer should cost.
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

/**
 * The find result with as many leading rows, groups or events as fit
 * `ANALYSIS_OUTPUT_MAX_BYTES` with its trace; a cut result is truncated, says
 * so, and continues with `cursorAfter(index of its last item)`.
 */
export function fitFindOutput(
	output: AnalysisFindOutput,
	cursorAfter: (index: number) => string | undefined = () => undefined,
): AnalysisFindOutput {
	if (jsonBytes(output) <= BODY_MAX_BYTES) return output;
	const page = { header: output.header, cursorAfter };
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
		const fitted = fitWitnesses(output);
		if (jsonBytes(fitted) <= BODY_MAX_BYTES) return fitted;
		return fitItems(
			{ ...page, header: fitted.header },
			fitted.events,
			"events",
			(events, header) => ({ ...fitted, header, events }),
		);
	}
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

/**
 * `find pullRequest=…` witnesses fitted first: as many leading (newest) ones
 * as fit a quarter of the ceiling when there are events (all of it
 * otherwise), so events keep the rest; a cut list says so.
 */
function fitWitnesses(
	output: Extract<AnalysisFindOutput, { source: "git" }>,
): Extract<AnalysisFindOutput, { source: "git" }> {
	const witnesses = output.witnesses ?? [];
	if (witnesses.length === 0) return output;
	const budget = output.events.length > 0 ? BODY_MAX_BYTES / 4 : BODY_MAX_BYTES;
	// The note about a cut list is part of what must fit.
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
							`only the first ${count} of ${witnesses.length} witnesses fit the ${ANALYSIS_OUTPUT_MAX_BYTES / 1024} KiB result ceiling; narrow the dates or sessions to see the rest`,
						],
					},
				};
	const kept =
		fitCount(witnesses.length, (count) => withWitnesses(count, []), budget)
			.witnesses?.length ?? 0;
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
function fitCount<TOutput>(
	total: number,
	build: (count: number) => TOutput,
	budget = BODY_MAX_BYTES,
): TOutput {
	const full = build(total);
	if (jsonBytes(full) <= budget) return full;
	let low = 0;
	let high = total - 1;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (jsonBytes(build(middle)) <= budget) low = middle;
		else high = middle - 1;
	}
	return build(low);
}
