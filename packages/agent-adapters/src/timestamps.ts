import type { Source } from "@rudel/api-routes";
import { InvalidTranscriptTimestampError } from "./errors.js";
import type { SessionTimestamps } from "./types.js";

const STRICT_RFC3339_TIMESTAMP =
	/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function extractStrictTranscriptTimestamps(input: {
	content: string;
	isTimestampRecord: (record: Readonly<Record<string, unknown>>) => boolean;
	source: Source;
}): SessionTimestamps | null {
	let min: string | null = null;
	let max: string | null = null;
	let minTime = Number.POSITIVE_INFINITY;
	let maxTime = Number.NEGATIVE_INFINITY;

	for (const line of input.content.split("\n")) {
		if (!line) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(parsed) || !input.isTimestampRecord(parsed)) continue;
		if (!Object.hasOwn(parsed, "timestamp")) continue;
		const timestampTime = parseStrictRfc3339Timestamp(parsed.timestamp);
		if (timestampTime === null) {
			throw new InvalidTranscriptTimestampError(input.source);
		}

		const timestamp = new Date(timestampTime).toISOString();
		if (timestampTime < minTime) {
			min = timestamp;
			minTime = timestampTime;
		}
		if (timestampTime > maxTime) {
			max = timestamp;
			maxTime = timestampTime;
		}
	}

	if (!min || !max) return null;
	return { lastInteractionDate: max, sessionDate: min };
}

function parseStrictRfc3339Timestamp(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const match = STRICT_RFC3339_TIMESTAMP.exec(value);
	if (!match) return null;
	const yearText = match[1];
	const monthText = match[2];
	const dayText = match[3];
	if (!yearText || !monthText || !dayText) return null;
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const daysInMonth =
		month === 2 && isLeapYear(year) ? 29 : (DAYS_PER_MONTH[month - 1] ?? 0);
	if (day > daysInMonth) return null;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : null;
}

function isLeapYear(year: number): boolean {
	return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
