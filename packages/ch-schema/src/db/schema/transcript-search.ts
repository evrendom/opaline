import { schema, table } from "@chkit/core";

/**
 * Transcript search (docs/retro-architecture.md, "Additions to the data
 * stack"): transcript text after the secret filter, cut into chunks that are
 * stored once per member by content hash with a short quantized vector, and a
 * hit for every place a chunk appeared, naming its run. Written at upload,
 * only from the session's committed transcript-records generation.
 *
 * Both tables are deleted with the account (user_id) and the workspace
 * (organization_id). chkit cannot express the text column's CODEC(ZSTD(3)),
 * so the migration adds it by hand, as for transcript_records.text.
 */
const SETTINGS = {
	index_granularity: "1024",
	index_granularity_bytes: "1048576",
	non_replicated_deduplication_window: "1000",
	storage_policy: "'s3'",
};

/**
 * The month is ahead of the hash so a search window reads only its months'
 * chunks; a chunk is stored once per member and month it appeared in.
 */
export const TRANSCRIPT_CHUNKS_KEY = [
	"organization_id",
	"user_id",
	"month",
	"chunk_hash",
];
/**
 * The generation is in the key, as in transcript_records: rows of a pass that
 * never wrote its receipt cannot replace the hits readers still serve. Older
 * generations are deleted once a newer receipt is written.
 */
export const TRANSCRIPT_CHUNK_HITS_KEY = [
	"organization_id",
	"user_id",
	"session_id",
	"revision",
	"parser_version",
	"agent_id",
	"record_idx",
	"block_idx",
	"chunk_idx",
];

export const transcriptChunksTable = table({
	database: "rudel",
	name: "transcript_chunks",
	engine: "SharedReplacingMergeTree(embedded_at)",
	columns: [
		{
			name: "organization_id",
			type: "String",
			comment: "Owning workspace ID; tenant boundary.",
		},
		{
			name: "user_id",
			type: "String",
			comment:
				"Member whose sessions hold the chunk; chunks are stored once per member and month.",
		},
		{
			name: "month",
			type: "Date",
			comment:
				"First day (UTC) of a month the chunk appeared in; a chunk seen in several months has a row for each, with the same vector.",
		},
		{
			name: "chunk_hash",
			type: "String",
			comment:
				"First 128 bits of the SHA-256 of the chunk text, as hex: the chunk's identity within the member's sessions.",
		},
		{
			name: "text",
			type: "String",
			comment:
				"Chunk text after the secret filter, at most 1,200 characters, cut at a line end where possible.",
		},
		{
			name: "embedding",
			type: "Array(Int8)",
			comment:
				"text-embedding-3-small vector at 512 dimensions, scaled so its largest component is ±127 (cosine does not depend on the scale); empty while not embedded.",
		},
		{
			name: "model",
			type: "LowCardinality(String)",
			comment:
				"Model and dimensions of the vector, e.g. text-embedding-3-small@512; empty while not embedded.",
		},
		{
			name: "embedded_at",
			type: "DateTime64(3, 'UTC')",
			comment:
				"Replacing version: UTC time the vector was written, or 1970-01-01 for a chunk stored without one, so an embedded row replaces it.",
		},
	],
	primaryKey: TRANSCRIPT_CHUNKS_KEY,
	orderBy: TRANSCRIPT_CHUNKS_KEY,
	settings: SETTINGS,
	comment:
		"Distinct chunks of transcript text per member and month with their 8-bit vectors, for search by meaning and exact string.",
});

export const transcriptChunkHitsTable = table({
	database: "rudel",
	name: "transcript_chunk_hits",
	engine: "SharedReplacingMergeTree(written_at)",
	columns: [
		{
			name: "organization_id",
			type: "String",
			comment: "Owning workspace ID; tenant boundary.",
		},
		{ name: "user_id", type: "String", comment: "Session owner." },
		{
			name: "source",
			type: "LowCardinality(String)",
			comment: "Transcript source: claude_code or codex.",
		},
		{
			name: "session_id",
			type: "String",
			comment: "Native session ID within organization and user.",
		},
		{
			name: "agent_id",
			type: "String",
			comment: "Transcript stream; empty for the main stream and the receipt.",
		},
		{
			name: "record_idx",
			type: "UInt32",
			comment:
				"Transcript record of the hit; 4294967295 for the session's receipt.",
		},
		{
			name: "block_idx",
			type: "UInt16",
			comment: "Content block of the record.",
		},
		{
			name: "chunk_idx",
			type: "UInt16",
			comment: "Place of the chunk in the block's text, from 0.",
		},
		{
			name: "turn_idx",
			type: "UInt32",
			comment: "Run number within the stream; zero for the receipt.",
		},
		{
			name: "kind",
			type: "LowCardinality(String)",
			comment:
				"Record kind of the hit: user_prompt, assistant_text, reasoning, tool_call, tool_result or file_change; receipt for the receipt.",
		},
		{
			name: "tool_name",
			type: "LowCardinality(String)",
			comment: "Tool of a tool call or result; empty otherwise.",
		},
		{
			name: "ts",
			type: "DateTime64(3, 'UTC')",
			comment: "UTC time of the record.",
		},
		{
			name: "chunk_hash",
			type: "String",
			comment:
				"The chunk (transcript_chunks.chunk_hash of the same member); empty for the receipt.",
		},
		{
			name: "revision",
			type: "UInt64",
			comment:
				"Raw transcript revision of the transcript records generation the hits were cut from.",
		},
		{
			name: "parser_version",
			type: "UInt16",
			comment: "Transcript records parser version of that generation.",
		},
		{
			name: "pending_chunks",
			type: "UInt32",
			comment:
				"Receipt only: chunks of the generation still without a vector (over the workspace's OpenAI quota or out of time); 0 when all are embedded.",
		},
		{
			name: "truncated_records",
			type: "UInt32",
			comment:
				"Receipt only: records searched by their kept prefix and tail only, because transcript records did not keep their middle.",
		},
		{
			name: "written_at",
			type: "DateTime64(3, 'UTC')",
			comment:
				"Replacing version: UTC time the row was written, so a later pass over the same generation wins (its receipt counts fewer pending chunks).",
		},
	],
	primaryKey: TRANSCRIPT_CHUNK_HITS_KEY,
	orderBy: TRANSCRIPT_CHUNK_HITS_KEY,
	settings: SETTINGS,
	indexes: [
		{ name: "ts_minmax", expression: "ts", type: "minmax", granularity: 1 },
	],
	comment:
		"Where each transcript chunk appeared, by run and transcript records generation; a receipt row closes each generation.",
});

export default schema(transcriptChunksTable, transcriptChunkHitsTable);
