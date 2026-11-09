import type postgres from "postgres";
import { BACKGROUND_WORKERS_ENV } from "../../lib/background-work.js";
import { isSelfHosted } from "../../lib/self-hosted.js";
import { createFileStore } from "./file-store.js";
import {
	DEFAULT_LOCAL_INGEST_SETTINGS,
	type IngestStatus,
	LocalIngest,
	type LocalIngestSettings,
	type Owner,
} from "./service.js";
import { localIngestRoots } from "./sources.js";

type Environment = Readonly<Record<string, string | undefined>>;

export interface LocalIngestHandle {
	status(): IngestStatus;
	notify(paths: readonly string[], final: boolean): Promise<number>;
	wake(): void;
	stop(): Promise<void>;
}

let current: LocalIngestHandle | null = null;

export function getLocalIngest(): LocalIngestHandle | null {
	return current;
}

export function registerLocalIngest(handle: LocalIngestHandle | null): void {
	current = handle;
}

export function isLocalIngestEnabled(env: Environment = process.env): boolean {
	return isSelfHosted(env) && env.OPALINE_LOCAL_INGEST === "1";
}

export function backgroundPrioritySupported(
	env: Environment = process.env,
): boolean {
	return (
		env[BACKGROUND_WORKERS_ENV] === "1" &&
		(process.platform === "darwin" || process.platform === "linux")
	);
}

function positive(
	raw: string | undefined,
	fallback: number,
	max: number,
): number {
	const value = Number(raw?.trim());
	return Number.isSafeInteger(value) && value > 0
		? Math.min(value, max)
		: fallback;
}

export function readLocalIngestSettings(
	env: Environment,
): Partial<LocalIngestSettings> {
	return {
		historyDays: positive(
			env.OPALINE_LOCAL_INGEST_DAYS,
			DEFAULT_LOCAL_INGEST_SETTINGS.historyDays,
			3650,
		),
		concurrency: positive(
			env.OPALINE_LOCAL_INGEST_CONCURRENCY,
			DEFAULT_LOCAL_INGEST_SETTINGS.concurrency,
			16,
		),
	};
}

export async function resolveLocalOwner(
	sql: postgres.Sql,
): Promise<Owner | null> {
	const [row] = await sql<Owner[]>`
		SELECT m.user_id AS "userId", m.organization_id AS "organizationId"
		FROM member m
		WHERE m.role = 'owner'
			AND m.organization_id = (SELECT id FROM organization ORDER BY created_at, id LIMIT 1)
		ORDER BY m.created_at, m.id
		LIMIT 1
	`;
	return row ?? null;
}

export async function startLocalIngest(options: {
	readonly wakeJobs: () => void;
	readonly log: (line: string) => void;
	readonly env?: Environment;
}): Promise<LocalIngestHandle> {
	const env = options.env ?? process.env;
	const [
		{ sqlClient },
		router,
		{ getClickhouse },
		storage,
		{ createSessionRunner },
		{ LocalSessionInputPool },
	] = await Promise.all([
		import("../../db.js"),
		import("../../router.js"),
		import("../../clickhouse.js"),
		import("../../services/r2-ingest-storage.service.js"),
		import("./runner.js"),
		import("../../services/local-session-input.service.js"),
	]);
	const settings = readLocalIngestSettings(env);
	const pool = new LocalSessionInputPool(
		settings.concurrency ?? DEFAULT_LOCAL_INGEST_SETTINGS.concurrency,
	);
	let wakeTimer: ReturnType<typeof setTimeout> | undefined;
	const roots = localIngestRoots(env);
	const service = new LocalIngest({
		roots,
		store: createFileStore(sqlClient),
		resolveOwner: () => resolveLocalOwner(sqlClient),
		ingestSession: createSessionRunner({
			processIngestSession: router.processIngestSession,
			errorFactories: router.createBackgroundIngestErrorFactories,
			prepare: (request) => pool.prepare(request),
			sql: sqlClient,
			clickhouse: getClickhouse,
			objectStore: () => {
				const availability = storage.readR2IngestAvailability();
				return availability.enabled
					? storage.createObjectStoreClient(availability.configuration)
					: null;
			},
			log: options.log,
		}),
		onIngested: () => {
			if (wakeTimer) return;
			wakeTimer = setTimeout(() => {
				wakeTimer = undefined;
				options.wakeJobs();
			}, 1_000);
			wakeTimer.unref?.();
		},
		backgroundPriority: backgroundPrioritySupported(env),
		settings,
		log: options.log,
	});
	void service
		.start()
		.catch((error: unknown) =>
			options.log(
				`local ingest stopped: ${error instanceof Error ? error.message : String(error)}`,
			),
		);
	const handle: LocalIngestHandle = {
		status: () => service.status(),
		notify: (paths, final) => service.notify(paths, final),
		wake: () => service.wake(),
		stop: async () => {
			clearTimeout(wakeTimer);
			await service.stop();
			pool.close();
			registerLocalIngest(null);
		},
	};
	registerLocalIngest(handle);
	options.log(
		`local ingest: ${roots.claudeProjects} and ${roots.codexSessions}, last ${settings.historyDays} days, background priority ${backgroundPrioritySupported(env) ? "on" : "off"}`,
	);
	return handle;
}
