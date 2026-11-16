import type postgres from "postgres";
import type { TranscriptFile } from "./sources.js";
import type { FileStat } from "./transcript-file/index.js";

export type FileState = "pending" | "ingested" | "failed" | "skipped" | "kept";

export interface StoredFile {
	readonly path: string;
	readonly source: TranscriptFile["source"];
	readonly role: TranscriptFile["role"];
	readonly sessionPath: string;
	readonly sessionId: string | null;
	readonly organizationId: string | null;
	readonly userId: string | null;
	readonly device: string;
	readonly inode: string;
	readonly size: number;
	readonly mtimeMs: number;
	readonly headSha256: string | null;
	readonly ingestedSize: number | null;
	readonly ingestedTailSha256: string | null;
	readonly ingestedMtimeMs: number | null;
	readonly state: FileState;
	readonly reason: string | null;
	readonly attempts: number;
	readonly nextAttemptAt: Date | null;
	readonly ingestedAt: Date | null;
}

export interface IngestedFile {
	readonly file: TranscriptFile;
	readonly stat: FileStat;
	readonly headSha256: string;
	readonly tailSha256: string;
}

const BATCH = 500;

function chunks<T>(items: readonly T[]): T[][] {
	const out: T[][] = [];
	for (let index = 0; index < items.length; index += BATCH)
		out.push(items.slice(index, index + BATCH));
	return out;
}

export interface FileStore {
	loadAll(): Promise<StoredFile[]>;
	recordSeen(
		files: readonly { file: TranscriptFile; stat: FileStat }[],
	): Promise<void>;
	recordIngested(input: {
		readonly files: readonly IngestedFile[];
		readonly sessionId: string | null;
		readonly organizationId: string;
		readonly userId: string;
		readonly state: "ingested" | "kept" | "skipped";
		readonly reason: string | null;
		readonly at: Date;
	}): Promise<void>;
	recordOutcome(input: {
		readonly paths: readonly string[];
		readonly state: "failed" | "skipped" | "pending";
		readonly reason: string | null;
		readonly nextAttemptAt: Date | null;
	}): Promise<void>;
}

export function createFileStore(sql: postgres.Sql): FileStore {
	return {
		async loadAll() {
			const rows = await sql.unsafe<
				(Omit<StoredFile, "nextAttemptAt" | "ingestedAt"> & {
					nextAttemptMs: number | null;
					ingestedMs: number | null;
				})[]
			>(
				`SELECT path, source, role, session_path AS "sessionPath", session_id AS "sessionId",
					organization_id AS "organizationId", user_id AS "userId", device, inode,
					size::float8 AS size, mtime_ms AS "mtimeMs", head_sha256 AS "headSha256",
					ingested_size::float8 AS "ingestedSize", ingested_tail_sha256 AS "ingestedTailSha256",
					ingested_mtime_ms AS "ingestedMtimeMs", state, reason, attempts,
					(extract(epoch FROM next_attempt_at) * 1000)::float8 AS "nextAttemptMs",
					(extract(epoch FROM ingested_at) * 1000)::float8 AS "ingestedMs"
				FROM local_ingest_file`,
			);
			return rows.map(({ nextAttemptMs, ingestedMs, ...row }) => ({
				...row,
				size: Number(row.size),
				mtimeMs: Number(row.mtimeMs),
				ingestedSize:
					row.ingestedSize === null ? null : Number(row.ingestedSize),
				ingestedMtimeMs:
					row.ingestedMtimeMs === null ? null : Number(row.ingestedMtimeMs),
				attempts: Number(row.attempts),
				nextAttemptAt:
					nextAttemptMs === null ? null : new Date(Number(nextAttemptMs)),
				ingestedAt: ingestedMs === null ? null : new Date(Number(ingestedMs)),
			}));
		},
		async recordSeen(files) {
			for (const batch of chunks(files)) {
				await sql.unsafe(
					`INSERT INTO local_ingest_file (path, source, role, session_path, device, inode, size, mtime_ms, updated_at)
					SELECT item.path, item.source, item.role, item."sessionPath", item.device, item.inode, item.size, item."mtimeMs", now()
					FROM jsonb_to_recordset($1::text::jsonb) AS item(
						path text, source text, role text, "sessionPath" text, device text, inode text, size bigint, "mtimeMs" float8
					)
					ON CONFLICT (path) DO UPDATE SET
						source = EXCLUDED.source, role = EXCLUDED.role, session_path = EXCLUDED.session_path,
						device = EXCLUDED.device, inode = EXCLUDED.inode, size = EXCLUDED.size,
						mtime_ms = EXCLUDED.mtime_ms, updated_at = now()`,
					[
						JSON.stringify(
							batch.map(({ file, stat }) => ({
								path: file.path,
								source: file.source,
								role: file.role,
								sessionPath: file.sessionPath,
								device: stat.device,
								inode: stat.inode,
								size: stat.size,
								mtimeMs: stat.mtimeMs,
							})),
						),
					],
				);
			}
		},
		async recordIngested(input) {
			for (const batch of chunks(input.files)) {
				await sql.unsafe(
					`INSERT INTO local_ingest_file (
						path, source, role, session_path, session_id, organization_id, user_id, device, inode,
						size, mtime_ms, head_sha256, ingested_size, ingested_tail_sha256, ingested_mtime_ms,
						state, reason, attempts, next_attempt_at, ingested_at, updated_at
					)
					SELECT item.path, item.source, item.role, item."sessionPath", $2, $3, $4, item.device, item.inode,
						item.size, item."mtimeMs", item.head, item.size, item.tail, item."mtimeMs",
						$5, $6, 0, NULL, $7::timestamptz, now()
					FROM jsonb_to_recordset($1::text::jsonb) AS item(
						path text, source text, role text, "sessionPath" text, device text, inode text,
						size bigint, "mtimeMs" float8, head text, tail text
					)
					ON CONFLICT (path) DO UPDATE SET
						session_id = EXCLUDED.session_id, organization_id = EXCLUDED.organization_id,
						user_id = EXCLUDED.user_id, device = EXCLUDED.device, inode = EXCLUDED.inode,
						size = EXCLUDED.size, mtime_ms = EXCLUDED.mtime_ms, head_sha256 = EXCLUDED.head_sha256,
						ingested_size = EXCLUDED.ingested_size, ingested_tail_sha256 = EXCLUDED.ingested_tail_sha256,
						ingested_mtime_ms = EXCLUDED.ingested_mtime_ms, state = EXCLUDED.state,
						reason = EXCLUDED.reason, attempts = 0, next_attempt_at = NULL,
						ingested_at = EXCLUDED.ingested_at, updated_at = now()`,
					[
						JSON.stringify(
							batch.map(({ file, stat, headSha256, tailSha256 }) => ({
								path: file.path,
								source: file.source,
								role: file.role,
								sessionPath: file.sessionPath,
								device: stat.device,
								inode: stat.inode,
								size: stat.size,
								mtimeMs: stat.mtimeMs,
								head: headSha256,
								tail: tailSha256,
							})),
						),
						input.sessionId,
						input.organizationId,
						input.userId,
						input.state,
						input.reason,
						input.at.toISOString(),
					],
				);
			}
		},
		async recordOutcome(input) {
			if (input.paths.length === 0) return;
			await sql.unsafe(
				`UPDATE local_ingest_file SET
					state = $2, reason = $3,
					attempts = CASE WHEN $2 = 'failed' THEN attempts + 1 ELSE attempts END,
					next_attempt_at = $4::timestamptz, updated_at = now()
				WHERE path = ANY($1::text[])`,
				[
					[...input.paths],
					input.state,
					input.reason,
					input.nextAttemptAt?.toISOString() ?? null,
				],
			);
		},
	};
}
