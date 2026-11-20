import { getLogger } from "@logtape/logtape";
import { readPositiveSafeIntegerEnv } from "../../lib/env.js";
import { isSelfHosted } from "../../lib/self-hosted.js";
import { listsWorkspace } from "../analysis-log/config.js";
import {
	OPENAI_EMBEDDING_MODEL,
	requestOpenAiEmbeddings,
} from "../analysis-log/embedder.js";

import { EMBEDDING_QUOTA } from "./quota.js";

const logger = getLogger(["rudel", "api", "transcript-search"]);

/**
 * Tokens charged for texts when OpenAI does not say what it billed (no usage
 * in the answer, or a request abandoned midway): about four characters per
 * token, so the quota errs towards counting more.
 */
export function estimateEmbeddingTokens(texts: readonly string[]): number {
	return Math.ceil(texts.reduce((sum, text) => sum + text.length, 0) / 4);
}

/** Vector length: text-embedding-3-small shortened by OpenAI (`dimensions`). */
export const TRANSCRIPT_EMBEDDING_DIMENSIONS = 512;
/** One batch takes this long at most; a batch that fails is retried on the next upload. */
const OPENAI_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Embeds transcript text and search queries. The seam tests replace: tests
 * never call OpenAI.
 */
export interface TranscriptEmbedder {
	/** Stored with every vector: model and dimensions. */
	readonly model: string;
	/** Vectors in input order, and the tokens OpenAI billed. */
	/** Stops the request when `signal` aborts. */
	embed(
		texts: readonly string[],
		signal?: AbortSignal,
	): Promise<{ vectors: number[][]; tokens: number }>;
}

/** OpenAI-hosted `text-embedding-3-small` at 512 dimensions (ADR 0001 as amended). */
export function createOpenAiTranscriptEmbedder(
	apiKey: string,
	fetcher: typeof fetch = fetch,
): TranscriptEmbedder {
	return {
		model: `${OPENAI_EMBEDDING_MODEL}@${TRANSCRIPT_EMBEDDING_DIMENSIONS}`,
		embed: (texts, signal) =>
			requestOpenAiEmbeddings(
				apiKey,
				texts,
				{
					dimensions: TRANSCRIPT_EMBEDDING_DIMENSIONS,
					timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
					signal,
				},
				fetcher,
			),
	};
}

/**
 * The OpenAI embedder, or null without `OPENAI_API_KEY`: then search still
 * finds exact strings in the chunks uploads store. Which workspaces are
 * embedded at all is `access.ts`'s decision.
 */
export function transcriptEmbedder(): TranscriptEmbedder | null {
	const apiKey = process.env.OPENAI_API_KEY?.trim();
	if (!apiKey) {
		reportOnce(
			"OPENAI_API_KEY is not set; transcript text of indexed workspaces is chunked but not embedded",
		);
		return null;
	}
	return createOpenAiTranscriptEmbedder(apiKey);
}

/**
 * Whether `TRANSCRIPT_EMBEDDINGS_WORKSPACES` lists the workspace (our internal
 * workspaces; comma-separated ids, or `*` for every workspace; empty or
 * missing means none): indexed for search whatever its plan. An invalid list
 * (`*` mixed with ids) is logged and lists nobody.
 */
export function embedsWorkspace(workspaceId: string): boolean {
	if (isSelfHosted() && workspaceId !== "") return true;
	return listsWorkspace("TRANSCRIPT_EMBEDDINGS_WORKSPACES", workspaceId, false);
}

/**
 * Tokens a workspace may embed per 30 days: `TRANSCRIPT_EMBEDDINGS_QUOTA_TOKENS`,
 * 1 billion by default (about $20 of text-embedding-3-small).
 */
export function readEmbeddingQuotaLimits(): {
	tokens: number;
	windowMs: number;
} {
	return {
		tokens: readPositiveSafeIntegerEnv(
			"TRANSCRIPT_EMBEDDINGS_QUOTA_TOKENS",
			EMBEDDING_QUOTA.tokens,
		),
		windowMs: EMBEDDING_QUOTA.windowMs,
	};
}

const reported = new Set<string>();

function reportOnce(message: string): void {
	if (reported.has(message)) return;
	reported.add(message);
	if (isSelfHosted()) logger.info(message);
	else logger.error(message);
}
