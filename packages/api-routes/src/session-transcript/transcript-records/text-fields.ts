import {
	TRANSCRIPT_RECORD_EXCERPT_CHARS,
	TRANSCRIPT_RECORD_TEXT_MAX_CHARS,
	type TranscriptTextBudget,
} from "./types.js";

export interface TranscriptTextFields {
	readonly head: string;
	readonly tail: string;
	readonly text: string;
	/** Code points in the full decoded text, before any cap. */
	readonly textChars: number;
	/** True when `text` is shorter than the full decoded text. */
	readonly truncated: boolean;
}

const BUDGET_EXHAUSTED_HEAD_CHARS = 256;
const BUDGET_EXHAUSTED_TAIL_CHARS = 512;

export function literalLineCount(text: string): number {
	let count = text === "" || text.endsWith("\n") ? 0 : 1;
	for (const character of text) if (character === "\n") count++;
	return count;
}

/** Code points in `value`, matching ClickHouse `lengthUTF8` for valid text. */
export function countCodePoints(value: string): number {
	let count = 0;
	for (let index = 0; index < value.length; index++) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd8_00 && unit <= 0xdb_ff) {
			const next = value.charCodeAt(index + 1);
			if (next >= 0xdc_00 && next <= 0xdf_ff) index++;
		}
		count++;
	}
	return count;
}

/** `value.slice(0, end)` that never splits a surrogate pair. */
export function sliceStart(value: string, end: number): string {
	if (end >= value.length) return value;
	const boundary = isHighSurrogate(value.charCodeAt(end - 1)) ? end - 1 : end;
	return value.slice(0, Math.max(0, boundary));
}

/** `value.slice(start)` that never splits a surrogate pair. */
export function sliceEnd(value: string, start: number): string {
	if (start <= 0) return value;
	const boundary = isLowSurrogate(value.charCodeAt(start)) ? start + 1 : start;
	return value.slice(Math.min(value.length, boundary));
}

/**
 * Split decoded text into the stored columns.
 *
 * `head` is the first excerpt and `tail` the last excerpt, non-overlapping: a
 * record shorter than one excerpt has an empty tail. `text` is a prefix of the
 * full text capped at `textMaxChars`. Storage is charged to the shared budget,
 * limited by `allowance` (the record's paced share): a record that does not
 * fit keeps both excerpts and as much text as fits, and with nothing left a
 * short head only, plus a short tail when `keepTail` (tool results and
 * errors, whose cause is usually at the end). `textChars` stays exact.
 */
export function buildTranscriptTextFields(
	fullText: string,
	options: {
		readonly allowance?: number;
		readonly budget?: TranscriptTextBudget;
		readonly keepTail?: boolean;
		readonly textMaxChars?: number;
	} = {},
): TranscriptTextFields {
	const textMaxChars = options.textMaxChars ?? TRANSCRIPT_RECORD_TEXT_MAX_CHARS;
	const textChars = countCodePoints(fullText);
	if (fullText === "") {
		return { head: "", tail: "", text: "", textChars: 0, truncated: false };
	}
	const head = sliceStart(fullText, TRANSCRIPT_RECORD_EXCERPT_CHARS);
	const tail =
		fullText.length > TRANSCRIPT_RECORD_EXCERPT_CHARS
			? sliceEnd(
					fullText,
					Math.max(
						head.length,
						fullText.length - TRANSCRIPT_RECORD_EXCERPT_CHARS,
					),
				)
			: "";
	const cappedText = sliceStart(fullText, textMaxChars);
	const budget = options.budget;
	const available =
		budget === undefined
			? Number.POSITIVE_INFINITY
			: Math.min(budget.remaining, options.allowance ?? budget.remaining);
	let fields: TranscriptTextFields;
	if (cappedText.length + head.length + tail.length <= available) {
		fields = {
			head,
			tail,
			text: cappedText,
			textChars,
			truncated: cappedText.length < fullText.length,
		};
	} else if (head.length + tail.length < available) {
		const text = sliceStart(
			cappedText,
			Math.floor(available - head.length - tail.length),
		);
		fields = { head, tail, text, textChars, truncated: true };
	} else {
		// Short excerpts only: whatever the allowance still covers, never less
		// than a short head, and for tool results and errors a short tail.
		const tailChars =
			options.keepTail === true
				? Math.min(
						BUDGET_EXHAUSTED_TAIL_CHARS,
						Math.max(0, fullText.length - BUDGET_EXHAUSTED_HEAD_CHARS),
					)
				: 0;
		const shortHead = sliceStart(
			fullText,
			Math.max(
				BUDGET_EXHAUSTED_HEAD_CHARS,
				Math.min(head.length, Math.floor(available) - tailChars),
			),
		);
		fields = {
			head: shortHead,
			tail:
				tailChars > 0 && fullText.length > shortHead.length
					? sliceEnd(
							fullText,
							Math.max(shortHead.length, fullText.length - tailChars),
						)
					: "",
			text: "",
			textChars,
			truncated: true,
		};
	}
	if (budget !== undefined) {
		budget.remaining -=
			fields.text.length + fields.head.length + fields.tail.length;
	}
	return fields;
}

function isHighSurrogate(unit: number): boolean {
	return unit >= 0xd8_00 && unit <= 0xdb_ff;
}

function isLowSurrogate(unit: number): boolean {
	return unit >= 0xdc_00 && unit <= 0xdf_ff;
}
