import { createHash, randomBytes } from "node:crypto";
import type { AnalysisFindOutput } from "@rudel/api-routes";
import type { CursorKey, CursorOrder } from "./find-cursor.js";

export const RANDOM_RUN_ORDER: CursorOrder = ["asc", "asc", "asc"];
export const RANDOM_CALL_ORDER: CursorOrder = [
	"asc",
	"asc",
	"asc",
	"asc",
	"asc",
	"asc",
];
const UINT64_DIGITS = 20;

export function newRandomSeed(): string {
	return randomBytes(6).toString("base64url");
}

export function randomSeedOf(after: CursorKey | undefined): string {
	return typeof after?.[0] === "string" ? after[0] : newRandomSeed();
}

export function randomRank(seed: string, id: string): string {
	return createHash("sha256")
		.update(`${seed}\u0000${id}`)
		.digest("hex")
		.slice(0, 16);
}

export function padUInt64(value: string): string {
	return value.padStart(UINT64_DIGITS, "0");
}

export function unpadUInt64(value: string): string {
	return BigInt(value).toString();
}

interface FoundPage {
	output: AnalysisFindOutput;
	keys: CursorKey[];
}

export function skipLeading<T extends FoundPage>(found: T, offset: number): T {
	if (offset <= 0) return found;
	return {
		...found,
		output: skipItems(found.output, offset),
		keys: found.keys.slice(offset),
	};
}

function skipItems(
	output: AnalysisFindOutput,
	offset: number,
): AnalysisFindOutput {
	if ("sessions" in output)
		return { ...output, sessions: output.sessions.slice(offset) };
	if ("rows" in output)
		return { ...output, rows: output.rows.slice(offset) } as AnalysisFindOutput;
	if (output.source === "user" || output.source === "git")
		return {
			...output,
			events: output.events.slice(offset),
		} as AnalysisFindOutput;
	if (output.source === "weekly")
		return { ...output, totals: output.totals.slice(offset) };
	return {
		...output,
		groups: output.groups.slice(offset),
	} as AnalysisFindOutput;
}
