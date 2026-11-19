import { expect, test } from "bun:test";
import {
	CHUNK_MAX_CHARS,
	CHUNK_OVERLAP_CHARS,
	chunkRecords,
	quantizeVector,
	type RecordText,
} from "./chunks.js";

const record = (overrides: Partial<RecordText>): RecordText => ({
	agentId: "",
	recordIdx: 1,
	blockIdx: 0,
	turnIdx: 1,
	kind: "user_prompt",
	toolName: "",
	ts: "2026-10-12 10:00:00.000",
	text: "fix the failing login test",
	...overrides,
});

test("long text is cut into overlapping chunks of at most the chunk size, at line ends where it can, and nothing is lost", () => {
	const lines = Array.from(
		{ length: 120 },
		(_, index) => `line ${index}: ${"x".repeat((index % 40) + 1)}`,
	);
	const text = lines.join("\n");
	const unbroken = "y".repeat(CHUNK_MAX_CHARS * 2 + 10);
	// Cut hard between "permission" and "denied" were the chunks not to overlap.
	const crossing = `${"x".repeat(1_190)}permission denied${"y".repeat(40)}`;

	const { chunks, hits } = chunkRecords([
		record({ text }),
		record({ recordIdx: 2, text: unbroken }),
		record({ recordIdx: 3, text: crossing }),
	]);

	const pieces = hits
		.filter((hit) => hit.recordIdx === 1)
		.map((hit) => chunks.get(hit.hash) ?? "");
	expect(pieces.length).toBeGreaterThan(2);
	for (const piece of pieces)
		expect(piece.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
	for (const line of lines)
		expect(pieces.some((piece) => piece.includes(line))).toBe(true);
	// Cut at a line end: every piece but the last ends a line.
	for (const piece of pieces.slice(0, -1))
		expect(lines.some((line) => piece.endsWith(line))).toBe(true);
	expect(
		hits.filter((hit) => hit.recordIdx === 1).map((hit) => hit.chunkIdx),
	).toEqual(pieces.map((_, index) => index));
	const hard = hits
		.filter((hit) => hit.recordIdx === 2)
		.map((hit) => chunks.get(hit.hash) ?? "");
	expect(hard.map((piece) => piece.length)).toEqual([
		CHUNK_MAX_CHARS,
		CHUNK_MAX_CHARS,
		10 + 2 * CHUNK_OVERLAP_CHARS,
	]);
	expect(
		hits
			.filter((hit) => hit.recordIdx === 3)
			.some((hit) => chunks.get(hit.hash)?.includes("permission denied")),
	).toBe(true);
});

test("blank and near-empty text makes no chunk", () => {
	const { chunks, hits } = chunkRecords([
		record({ text: "   \n\t " }),
		record({ recordIdx: 2, text: "ok" }),
		record({ recordIdx: 3, text: "yes" }),
	]);
	expect(hits.map((hit) => hit.recordIdx)).toEqual([3]);
	expect([...chunks.values()]).toEqual(["yes"]);
});

test("the same text always has the same hash, different text another", () => {
	const first = chunkRecords([record({ text: "Use --legacy here" })]);
	const again = chunkRecords([record({ text: "Use --legacy here" })]);
	const other = chunkRecords([record({ text: "use --legacy here" })]);
	expect(first.hits[0]?.hash).toBe(again.hits[0]?.hash ?? "");
	expect(first.hits[0]?.hash).not.toBe(other.hits[0]?.hash ?? "");
	expect(first.hits[0]?.hash).toMatch(/^[0-9a-f]{32}$/u);
});

test("a vector is quantized to 8 bits with its largest component at ±127, keeping its direction", () => {
	const vector = [0.5, -0.25, 0.125, 0, -0.5001];
	const quantized = quantizeVector(vector);
	expect(quantized).toEqual([127, -63, 32, 0, -127]);
	const cosine = (left: readonly number[], right: readonly number[]) => {
		let dot = 0;
		let leftNorm = 0;
		let rightNorm = 0;
		left.forEach((value, index) => {
			const other = right[index] ?? 0;
			dot += value * other;
			leftNorm += value * value;
			rightNorm += other * other;
		});
		return dot / Math.sqrt(leftNorm * rightNorm);
	};
	expect(cosine(vector, quantized)).toBeGreaterThan(0.999);
	expect(quantizeVector([0, 0, 0])).toEqual([0, 0, 0]);
});
