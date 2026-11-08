import { expect, test } from "bun:test";
import { createLocalEmbedder } from "./embedder.js";
import {
	decodeVector,
	encodeVector,
	MAX_EMBEDDING_MATCHES,
	rankByCosine,
	readText,
	storedText,
} from "./postgres-store.js";

test("vectors are stored as little-endian float32 at unit length, four bytes per dimension", () => {
	const bytes = encodeVector([3, 4, 0]);
	expect(bytes).toHaveLength(12);
	expect(bytes.readFloatLE(0)).toBeCloseTo(0.6, 6);
	expect(bytes.readFloatLE(4)).toBeCloseTo(0.8, 6);
	expect([...decodeVector(bytes)]).toEqual([
		Math.fround(0.6),
		Math.fround(0.8),
		0,
	]);
	const offset = new Uint8Array(16);
	offset.set(bytes, 4);
	expect([...decodeVector(offset.subarray(4))]).toEqual([
		...decodeVector(bytes),
	]);
	expect([...decodeVector(encodeVector([0, 0]))]).toEqual([0, 0]);
	expect(() => encodeVector([1, Number.NaN])).toThrow("finite");
	expect(() => encodeVector([Number.POSITIVE_INFINITY])).toThrow("finite");
});

test("ranking orders by cosine similarity, best first, keeps ties in stored order and stops at the limit", () => {
	const candidate = (values: number[], name: string) => ({
		vector: decodeVector(encodeVector(values)),
		match: name,
	});
	const candidates = [
		candidate([-1, 0], "opposite"),
		candidate([1, 1], "diagonal"),
		candidate([2, 0], "same"),
		candidate([5, 0], "same again"),
		candidate([0, 0], "empty"),
	];
	expect(rankByCosine([10, 0], candidates, 10)).toEqual([
		"same",
		"same again",
		"diagonal",
		"empty",
		"opposite",
	]);
	expect(rankByCosine([1, 0], candidates, 2)).toEqual(["same", "same again"]);
	expect(rankByCosine([1, 0], candidates, 0)).toEqual([]);
	expect(rankByCosine([0, 0], candidates, 2)).toEqual(["opposite", "diagonal"]);
});

test("local word vectors rank a question sharing more words higher", async () => {
	const embedder = createLocalEmbedder();
	const [query, close, far] = await embedder.embed([
		"why do agents wait on slow CI runs",
		"agents wait on CI",
		"billing invoices",
	]);
	expect(
		rankByCosine(
			query ?? [],
			[
				{ vector: decodeVector(encodeVector(far ?? [])), match: "far" },
				{ vector: decodeVector(encodeVector(close ?? [])), match: "close" },
			],
			2,
		),
	).toEqual(["close", "far"]);
	expect(MAX_EMBEDDING_MATCHES).toBe(256);
});

test("text Postgres cannot hold is stored escaped and read back as it was; other text is stored as is", () => {
	for (const plain of ["", "Parity — 错 ✓", "a\\u0000b", '"json:"', "😀"])
		expect(storedText(plain)).toBe(plain);
	for (const odd of [
		"nul\u0000inside",
		"lone \ud800 high",
		"lone \udfff low",
		"\u0001json:looks escaped",
		'\u0001json:"x"',
	]) {
		const stored = storedText(odd);
		expect(stored).not.toContain("\u0000");
		expect(stored).not.toMatch(/[\uD800-\uDFFF]/u);
		expect(readText(stored)).toBe(odd);
	}
	expect(storedText(null)).toBeNull();
	expect(readText(null)).toBeNull();
	expect(() => readText("\u0001json:not json")).toThrow();
	expect(() => readText("\u0001json:42")).toThrow("not a string");
});
