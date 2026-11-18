/** Transcript search tables (packages/ch-schema/src/db/schema/transcript-search.ts). */
export const TRANSCRIPT_CHUNKS_TABLE = "rudel.transcript_chunks";
export const TRANSCRIPT_CHUNK_HITS_TABLE = "rudel.transcript_chunk_hits";
/** Both are deleted with the account (user_id) and the workspace (organization_id). */
export const TRANSCRIPT_SEARCH_TABLES = [
	TRANSCRIPT_CHUNKS_TABLE,
	TRANSCRIPT_CHUNK_HITS_TABLE,
] as const;
