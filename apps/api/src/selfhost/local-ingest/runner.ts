import { ORPCError } from "@orpc/server";
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

type ProcessIngestSession =
	typeof import("../../router.js").processIngestSession;
type BackgroundErrors =
	typeof import("../../router.js").createBackgroundIngestErrorFactories;

export interface SessionRunnerDependencies {
	readonly processIngestSession: ProcessIngestSession;
	readonly errorFactories: BackgroundErrors;
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

const SHRINK = /smaller/iu;
const BUSY_REASONS = new Set([
	"ingest_filter_queue_full",
	"usage_extraction_queue_full",
]);
const BUSY_WAIT_MS = 250;
const USAGE_INCOMPLETE = "usage_extraction_incomplete";
const BUSY_WAIT_LIMIT_MS = 10 * 60_000;

function busyReason(error: unknown): boolean {
	if (!(error instanceof ORPCError) || error.code !== "SERVICE_UNAVAILABLE")
		return false;
	const data = error.data as { reason?: unknown } | undefined;
	return typeof data?.reason === "string" && BUSY_REASONS.has(data.reason);
}

export function classifyIngestError(error: unknown): SessionOutcome {
	const message = error instanceof Error ? error.message : String(error);
	if (
		error instanceof ORPCError &&
		error.code === "SERVICE_UNAVAILABLE" &&
		(error.data as { reason?: unknown } | undefined)?.reason ===
			USAGE_INCOMPLETE
	)
		return {
			kind: "ingested",
			sessionId: "",
			bytes: 0,
			reason:
				"Stored without its usage: the transcript's token counts are incomplete. It is imported again when the file changes.",
		};
	if (error instanceof ORPCError) {
		if (error.code === "CONFLICT" && SHRINK.test(message))
			return {
				kind: "kept",
				sessionId: "",
				bytes: 0,
				reason:
					"The transcript on disk is shorter than the copy Opaline stored; the longer copy is kept.",
			};
		if (error.code === "BAD_REQUEST" || error.code === "CONFLICT")
			return { kind: "skipped", reason: message.slice(0, 500) };
	}
	return { kind: "retry", reason: message.slice(0, 500) };
}

export async function loadSessionRunner(options: {
	readonly sql: postgres.Sql;
	readonly prepare: SessionRunnerDependencies["prepare"];
	readonly log: (line: string) => void;
}): Promise<(job: SessionJob, owner: Owner) => Promise<SessionOutcome>> {
	const [router, { getClickhouse }, storage] = await Promise.all([
		import("../../router.js"),
		import("../../clickhouse.js"),
		import("../../services/r2-ingest-storage.service.js"),
	]);
	return createSessionRunner({
		processIngestSession: router.processIngestSession,
		errorFactories: router.createBackgroundIngestErrorFactories,
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
			const ingest = () =>
				deps.processIngestSession({
					aggregateContentMaxBytes: INGEST_AGGREGATE_CONTENT_MAX_BYTES,
					awaitLanguageSignals: true,
					context: {
						apiKeyId: null,
						session: { activeOrganizationId: owner.organizationId } as never,
						user: { id: owner.userId },
					},
					enforceRateLimits: false,
					errorFactories: deps.errorFactories(),
					input,
				});
			const waitedSince = Date.now();
			let storedReason: string | undefined;
			for (;;) {
				try {
					await timedIngestPhase("local.ingest_total", ingest);
					break;
				} catch (error) {
					if (
						busyReason(error) &&
						Date.now() - waitedSince < BUSY_WAIT_LIMIT_MS
					) {
						await sleep(BUSY_WAIT_MS);
						continue;
					}
					const outcome = classifyIngestError(error);
					if (outcome.kind === "ingested") {
						storedReason = outcome.reason;
						break;
					}
					return outcome.kind === "kept"
						? { ...outcome, sessionId: input.sessionId, files }
						: { ...outcome, files };
				}
			}
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
				...(storedReason === undefined ? {} : { reason: storedReason }),
			};
		});
}
