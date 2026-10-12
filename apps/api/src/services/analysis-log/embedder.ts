import { z } from "zod";
import { SanitizedError } from "./errors.js";
import type { Embedder } from "./types.js";

export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const LOCAL_EMBEDDING_MODEL = "local-word-vectors-1";
const LOCAL_DIMENSIONS = 1536;
const EmbeddingResponseSchema = z.object({
	data: z.array(
		z.object({ index: z.number(), embedding: z.array(z.number()) }),
	),
	usage: z.object({ total_tokens: z.number() }).optional(),
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
			return (await requestOpenAiEmbeddings(apiKey, texts, {}, fetcher))
				.vectors;
		},
	};
}

/**
 * One request to OpenAI `text-embedding-3-small`: the vectors in input order
 * and the tokens it billed. `dimensions` shortens the vectors (the model
 * keeps the most important dimensions first).
 */
export async function requestOpenAiEmbeddings(
	apiKey: string,
	texts: readonly string[],
	options: { dimensions?: number; timeoutMs?: number; signal?: AbortSignal },
	fetcher: typeof fetch = fetch,
): Promise<{ vectors: number[][]; tokens: number }> {
	if (!texts.length) return { vectors: [], tokens: 0 };
	const response = await fetcher("https://api.openai.com/v1/embeddings", {
		method: "POST",
		headers: {
			authorization: `Bearer ${apiKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: OPENAI_EMBEDDING_MODEL,
			input: texts,
			...(options.dimensions ? { dimensions: options.dimensions } : {}),
		}),
		signal: AbortSignal.any([
			AbortSignal.timeout(options.timeoutMs ?? 10_000),
			...(options.signal ? [options.signal] : []),
		]),
	});
	if (!response.ok)
		throw new SanitizedError(
			`OpenAI embeddings failed with HTTP ${response.status}`,
		);
	const { data, usage } = EmbeddingResponseSchema.parse(await response.json());
	return {
		vectors: data
			.sort((left, right) => left.index - right.index)
			.map((item) => item.embedding),
		tokens: usage?.total_tokens ?? 0,
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
