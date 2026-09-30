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
 * full text capped at `textMaxChars`. When the shared budget is spent, only a
 * short head survives; `textChars` stays exact.
 */
export function buildTranscriptTextFields(
	fullText: string,
	options: {
		readonly budget?: TranscriptTextBudget;
		readonly textMaxChars?: number;
	} = {},
): TranscriptTextFields {
	const textMaxChars = options.textMaxChars ?? TRANSCRIPT_RECORD_TEXT_MAX_CHARS;
	const textChars = countCodePoints(fullText);
	if (fullText === "") {
		return { head: "", tail: "", text: "", textChars: 0, truncated: false };
	}
	if (options.budget && options.budget.remaining <= 0) {
		return {
			head: sliceStart(fullText, BUDGET_EXHAUSTED_HEAD_CHARS),
			tail: "",
			text: "",
			textChars,
			truncated: true,
		};
	}
	const text = sliceStart(fullText, textMaxChars);
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
	if (options.budget) {
		options.budget.remaining -= text.length + head.length + tail.length;
	}
	return {
		head,
		tail,
		text,
		textChars,
		truncated: text.length < fullText.length,
	};
}

function isHighSurrogate(unit: number): boolean {
	return unit >= 0xd8_00 && unit <= 0xdb_ff;
}

function isLowSurrogate(unit: number): boolean {
	return unit >= 0xdc_00 && unit <= 0xdf_ff;
}
