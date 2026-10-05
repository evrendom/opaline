import { z } from "zod";
import { SanitizedError } from "./errors.js";
import type { Embedder } from "./types.js";

const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const LOCAL_EMBEDDING_MODEL = "local-word-vectors-1";
const LOCAL_DIMENSIONS = 1536;
const EmbeddingResponseSchema = z.object({
	data: z.array(
		z.object({ index: z.number(), embedding: z.array(z.number()) }),
	),
});

/**
 * OpenAI embeddings for the question title and topics of saved analyses
 * only, never transcripts or query results
 * (ADR 0001).
 */
export function createOpenAiEmbedder(
	apiKey: string,
	fetcher: typeof fetch = fetch,
): Embedder {
	return {
		model: OPENAI_EMBEDDING_MODEL,
		async embed(texts) {
			if (!texts.length) return [];
			const response = await fetcher("https://api.openai.com/v1/embeddings", {
				method: "POST",
				headers: {
					authorization: `Bearer ${apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: texts }),
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok)
				throw new SanitizedError(
					`OpenAI embeddings failed with HTTP ${response.status}`,
				);
			const { data } = EmbeddingResponseSchema.parse(await response.json());
			return data
				.sort((left, right) => left.index - right.index)
				.map((item) => item.embedding);
		},
	};
}

/**
 * Deterministic bag-of-words vectors for tests and the in-process store
 * without an API key. It matches shared words only; real similarity needs
 * OpenAI, which the Convex store requires.
 */
export function createLocalEmbedder(): Embedder {
	return {
		model: LOCAL_EMBEDDING_MODEL,
		async embed(texts) {
			return texts.map((text) => {
				const vector = new Array<number>(LOCAL_DIMENSIONS).fill(0);
				for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
					const stem = word.slice(0, 6);
					let hash = 0;
					for (const character of stem)
						hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
					vector[hash % LOCAL_DIMENSIONS] =
						(vector[hash % LOCAL_DIMENSIONS] ?? 0) + 1;
				}
				return vector;
			});
		},
	};
}
