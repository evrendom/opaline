import { expect, test } from "bun:test";
import { createLocalEmbedder, createOpenAiEmbedder } from "./embedder.js";

test("local vectors have the same 1536 dimensions as the Convex index and OpenAI", async () => {
	const embedder = createLocalEmbedder();
	const vectors = await embedder.embed(["Slow runs", "slow runs", ""]);
	for (const vector of vectors) expect(vector).toHaveLength(1536);
	const [first, second, empty] = vectors;
	expect(first).toEqual(second);
	expect(empty).toEqual(new Array<number>(1536).fill(0));
	expect(await embedder.embed([])).toEqual([]);
	expect(embedder.model).not.toBe(createOpenAiEmbedder("sk-test").model);
});
