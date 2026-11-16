import { INGEST_AGGREGATE_CONTENT_MAX_BYTES } from "@rudel/api-routes";
import type postgres from "postgres";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import { runAsBackgroundWork } from "../../lib/background-work.js";
import { timedIngestPhase } from "../../services/ingest-phase-timings.js";
import type {
	LocalSessionInputRequest,
	PreparedLocalSession,
} from "../../services/local-session-input.types.js";
import type { R2EvidenceStorageClient } from "../../services/r2-ingest-storage.service.js";
import { storeSessionImages } from "./images.js";
import type { Owner, SessionJob, SessionOutcome } from "./service.js";

type ImportSession =
	typeof import("../../services/session-import/index.js").importSession;

export interface SessionRunnerDependencies {
	readonly importSession: ImportSession;
	readonly prepare: (
		request: LocalSessionInputRequest,
	) => Promise<PreparedLocalSession>;
	readonly sql: postgres.Sql;
	readonly clickhouse: () => ClickHouseExecutor;
	readonly objectStore: () => R2EvidenceStorageClient | null;
	readonly now?: () => Date;
	readonly sleep?: (ms: number) => Promise<void>;
	readonly log?: (line: string) => void;
}

const BUSY_WAIT_MS = 250;
const BUSY_WAIT_LIMIT_MS = 10 * 60_000;
const KEPT_REASON =
	"The transcript on disk is shorter than the copy Opaline stored; the longer copy is kept.";
const USAGE_INCOMPLETE_REASON =
	"Stored without its usage: the transcript's token counts are incomplete. It is imported again when the file changes.";

export async function loadSessionRunner(options: {
	readonly sql: postgres.Sql;
	readonly prepare: SessionRunnerDependencies["prepare"];
	readonly log: (line: string) => void;
}): Promise<(job: SessionJob, owner: Owner) => Promise<SessionOutcome>> {
	const [{ importSession }, { getClickhouse }, storage] = await Promise.all([
		import("../../services/session-import/index.js"),
		import("../../clickhouse.js"),
		import("../../services/r2-ingest-storage.service.js"),
	]);
	return createSessionRunner({
		importSession,
		prepare: options.prepare,
		sql: options.sql,
		clickhouse: getClickhouse,
		objectStore: () => {
			const availability = storage.readR2IngestAvailability();
			return availability.enabled
				? storage.createObjectStoreClient(availability.configuration)
				: null;
		},
		log: options.log,
	});
}

export function createSessionRunner(
	deps: SessionRunnerDependencies,
): (job: SessionJob, owner: Owner) => Promise<SessionOutcome> {
	const now = deps.now ?? (() => new Date());
	const sleep = deps.sleep ?? ((ms: number) => Bun.sleep(ms));
	return (job, owner) =>
		runAsBackgroundWork(async () => {
			const prepared = await timedIngestPhase("local.prepare", () =>
				deps.prepare({
					sessionPath: job.sessionPath,
					source: job.source,
					change: job.change,
					organizationId: owner.organizationId,
					now: now().getTime(),
				}),
			);
			if (prepared.kind === "skipped") return prepared;
			const { input, files } = prepared;
			const request = {
				aggregateContentMaxBytes: INGEST_AGGREGATE_CONTENT_MAX_BYTES,
				awaitLanguageSignals: true,
				context: {
					apiKeyId: null,
					session: { activeOrganizationId: owner.organizationId } as never,
					user: { id: owner.userId },
				},
				enforceRateLimits: false,
				input,
			};
			const waitedSince = Date.now();
			let imported = await timedIngestPhase("local.ingest_total", () =>
				deps.importSession(request),
			);
			while (
				imported.kind === "retry" &&
				imported.reason === "queue_full" &&
				Date.now() - waitedSince < BUSY_WAIT_LIMIT_MS
			) {
				await sleep(BUSY_WAIT_MS);
				imported = await timedIngestPhase("local.ingest_total", () =>
					deps.importSession(request),
				);
			}
			if (imported.kind === "kept")
				return {
					kind: "kept",
					sessionId: input.sessionId,
					bytes: 0,
					reason: KEPT_REASON,
					files,
				};
			if (imported.kind === "skipped" || imported.kind === "retry")
				return { kind: imported.kind, reason: imported.message, files };
			const store = deps.objectStore();
			if (store && prepared.images.length > 0) {
				try {
					await timedIngestPhase("local.images", () =>
						storeSessionImages({
							target: {
								organizationId: owner.organizationId,
								userId: owner.userId,
								sessionId: input.sessionId,
								source: input.source,
							},
							images: prepared.images,
							sql: deps.sql,
							clickhouse: deps.clickhouse(),
							store,
							captureId: `local:${input.sessionId}`,
							now: now(),
						}),
					);
				} catch (error) {
					deps.log?.(
						`images of ${input.sessionId} were not stored: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
			return {
				kind: "ingested",
				sessionId: input.sessionId,
				bytes: prepared.bytes,
				files,
				...(imported.usage === "incomplete"
					? { reason: USAGE_INCOMPLETE_REASON }
					: {}),
			};
		});
}
