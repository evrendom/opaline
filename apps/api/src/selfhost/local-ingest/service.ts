import { type FSWatcher, watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { LIVE_SESSION_ACTIVE_WINDOW_MS } from "@rudel/api-routes";
import type {
	FileState,
	FileStore,
	IngestedFile,
	StoredFile,
} from "./file-store.js";
import {
	INITIAL_IMPORT_MILESTONE,
	type MilestoneStore,
	memoryMilestoneStore,
} from "./milestone-store.js";
import {
	classifyTranscriptPath,
	type LocalIngestRoots,
	type TranscriptFile,
	type TranscriptSource,
} from "./sources.js";
import {
	checkTranscript,
	type FileIdentity,
	type FileStat,
	identifyTranscript,
	type ReadFile,
	statTranscript,
	type TranscriptChange,
} from "./transcript-file/index.js";

export interface Owner {
	readonly userId: string;
	readonly organizationId: string;
}

export interface SessionJob {
	readonly sessionPath: string;
	readonly source: TranscriptSource;
	readonly change: TranscriptChange;
	readonly bytes?: number;
}

export interface SessionProject {
	readonly projectPath: string;
	readonly gitRemote: string | null;
	readonly gitBranch: string | null;
}

export interface LocalLiveSession extends SessionProject {
	readonly sessionId: string;
	readonly userId: string;
	readonly source: TranscriptSource;
	readonly startedAt: string;
	readonly lastActivityAt: string;
}

export type SessionOutcome = (
	| {
			readonly kind: "ingested" | "kept";
			readonly sessionId: string;
			readonly bytes: number;
			readonly reason?: string;
			readonly project?: SessionProject;
	  }
	| { readonly kind: "skipped"; readonly reason: string }
	| { readonly kind: "retry"; readonly reason: string }
) & { readonly files?: readonly ReadFile[] };

export interface InitialImportStatus {
	readonly active: boolean;
	readonly sessionsDone: number;
	readonly sessionsTotal: number;
	readonly completedAt: string | null;
}

export interface IngestStatus {
	readonly state: "idle" | "importing" | "paused";
	readonly sessionsSeen: number;
	readonly sessionsIngested: number;
	readonly sessionsQueued: number;
	readonly bytesQueued: number;
	readonly lastIngestAt: string | null;
	readonly etaSeconds: number | null;
	readonly backgroundPriority: boolean;
	readonly initialImport: InitialImportStatus;
	readonly agentsRunning: number;
}

export interface LocalIngestSettings {
	readonly historyDays: number;
	readonly concurrency: number;
	readonly memoryBudgetBytes: number;
	readonly exclusiveBytes: number;
	readonly quietMs: number;
	readonly maxDelayMs: number;
	readonly liveIntervalMs: number;
	readonly scanIntervalMs: number;
	readonly partialLineGraceMs: number;
	readonly retryBaseMs: number;
	readonly retryMaxMs: number;
	readonly maxAttempts: number;
	readonly ownerPollMs: number;
	readonly initialPollMs: number;
}

export const DEFAULT_LOCAL_INGEST_SETTINGS: LocalIngestSettings = {
	historyDays: 30,
	concurrency: 3,
	memoryBudgetBytes: 256 * 1024 * 1024,
	exclusiveBytes: 48 * 1024 * 1024,
	quietMs: 1_500,
	maxDelayMs: 60_000,
	liveIntervalMs: 8_000,
	scanIntervalMs: 5 * 60_000,
	partialLineGraceMs: 30_000,
	retryBaseMs: 10_000,
	retryMaxMs: 15 * 60_000,
	maxAttempts: 5,
	ownerPollMs: 5_000,
	initialPollMs: 2_000,
};

export interface LocalIngestDependencies {
	readonly roots: LocalIngestRoots;
	readonly store: FileStore;
	readonly resolveOwner: () => Promise<Owner | null>;
	readonly ingestSession: (
		job: SessionJob,
		owner: Owner,
	) => Promise<SessionOutcome>;
	readonly onIngested?: () => void;
	readonly milestones?: MilestoneStore;
	readonly derivedQueued?: () => Promise<number>;
	readonly backgroundPriority: boolean;
	readonly settings?: Partial<LocalIngestSettings>;
	readonly now?: () => number;
	readonly watchFiles?: boolean;
	readonly log?: (line: string) => void;
}

interface SeenFile {
	file: TranscriptFile;
	stat: FileStat;
	ingested: FileIdentity | null;
	owner: Owner | null;
}

interface SessionEntry {
	readonly sessionPath: string;
	readonly source: TranscriptSource;
	state: FileState;
	reason: string | null;
	dueAt: number | null;
	firstDirtyAt: number | null;
	final: boolean;
	running: boolean;
	again: boolean;
	attempts: number;
	lastIngestAt: number | null;
	sessionId: string | null;
	project: SessionProject | null;
}

const SAFE_DIRECTORY = /^[A-Za-z0-9_-]{1,200}$/u;
const DAY_MS = 86_400_000;
const GAVE_UP = "gave up after";
const DRAINED_READS = 2;
const STOP_GRACE_MS = 10_000;

export class LocalIngest {
	private readonly settings: LocalIngestSettings;
	private readonly now: () => number;
	private readonly files = new Map<string, SeenFile>();
	private readonly subagentPaths = new Map<string, Set<string>>();
	private readonly sessions = new Map<string, SessionEntry>();
	private readonly watchers = new Map<string, FSWatcher>();
	private readonly touched = new Set<string>();
	private readonly stoppedAt = new Map<string, number>();
	private watchingSince = Number.POSITIVE_INFINITY;
	private owner: Owner | null = null;
	private stopped = false;
	private started = false;
	private pumpTimer: ReturnType<typeof setTimeout> | undefined;
	private touchTimer: ReturnType<typeof setTimeout> | undefined;
	private scanTimer: ReturnType<typeof setInterval> | undefined;
	private ownerTimer: ReturnType<typeof setTimeout> | undefined;
	private runningBytes = 0;
	private running = 0;
	private scanning: Promise<void> | null = null;
	private rescan = false;
	private lastIngestAt: number | null = null;
	private importStartedAt: number | null = null;
	private importBytesDone = 0;
	private inFlight = new Set<Promise<void>>();
	private readonly milestones: MilestoneStore;
	private initialLoaded = false;
	private initialDoneAt: number | null = null;
	private initialScope: Set<string> | null = null;
	private initialTimer: ReturnType<typeof setTimeout> | undefined;
	private initialDrainedReads = 0;

	constructor(private readonly deps: LocalIngestDependencies) {
		this.settings = { ...DEFAULT_LOCAL_INGEST_SETTINGS, ...deps.settings };
		this.now = deps.now ?? Date.now;
		this.milestones = deps.milestones ?? memoryMilestoneStore();
	}

	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;
		this.watchingSince = this.now();
		const rows = await this.deps.store.loadAll();
		for (const row of rows) this.restore(row);
		await this.loadInitialImport(rows);
		await this.waitForOwner();
	}

	private async loadInitialImport(rows: readonly StoredFile[]): Promise<void> {
		const reached = await this.milestones
			.reachedAt(INITIAL_IMPORT_MILESTONE)
			.catch((error: unknown) => {
				this.deps.log?.(
					`local ingest could not read the initial import state: ${error instanceof Error ? error.message : String(error)}`,
				);
				return null;
			});
		if (reached) this.initialDoneAt = reached.getTime();
		else {
			const sessions = rows.filter((row) => row.role === "session");
			if (
				sessions.length > 0 &&
				sessions.every(
					(row) => row.ingestedAt !== null || row.state === "skipped",
				)
			)
				await this.completeInitialImport();
		}
		this.initialLoaded = true;
	}

	private beginInitialImport(): void {
		if (this.stopped || this.initialDoneAt !== null || this.initialScope)
			return;
		this.initialScope = new Set(this.sessions.keys());
		void this.checkInitialImport();
	}

	private async checkInitialImport(): Promise<void> {
		if (this.stopped || this.initialDoneAt !== null) return;
		if (this.initialSessionsDone() < (this.initialScope?.size ?? 0))
			this.initialDrainedReads = 0;
		else {
			const derived = this.deps.derivedQueued
				? await this.deps.derivedQueued().catch((error: unknown) => {
						this.deps.log?.(
							`local ingest could not count derived work: ${error instanceof Error ? error.message : String(error)}`,
						);
						return null;
					})
				: 0;
			this.initialDrainedReads =
				derived === 0 ? this.initialDrainedReads + 1 : 0;
			if (
				this.initialDrainedReads >=
				(this.deps.derivedQueued ? DRAINED_READS : 1)
			) {
				await this.completeInitialImport();
				return;
			}
		}
		if (this.stopped) return;
		this.initialTimer = setTimeout(
			() => void this.checkInitialImport(),
			this.settings.initialPollMs,
		);
		this.initialTimer.unref?.();
	}

	private async completeInitialImport(): Promise<void> {
		if (this.initialDoneAt !== null) return;
		const at = this.now();
		this.initialDoneAt = at;
		clearTimeout(this.initialTimer);
		await this.milestones
			.reach(INITIAL_IMPORT_MILESTONE, new Date(at))
			.catch((error: unknown) =>
				this.deps.log?.(
					`local ingest could not record the finished initial import: ${error instanceof Error ? error.message : String(error)}`,
				),
			);
	}

	private initialSessionsDone(): number {
		let done = 0;
		for (const sessionPath of this.initialScope ?? []) {
			const entry = this.sessions.get(sessionPath);
			if (
				!entry ||
				entry.lastIngestAt !== null ||
				entry.state === "ingested" ||
				entry.state === "kept" ||
				entry.state === "skipped" ||
				(!entry.running && entry.dueAt === null)
			)
				done += 1;
		}
		return done;
	}

	private initialImportStatus(): InitialImportStatus {
		const total = this.initialScope?.size ?? 0;
		const done = this.initialDoneAt !== null;
		return {
			active: this.initialLoaded && !done,
			sessionsDone: done ? total : this.initialSessionsDone(),
			sessionsTotal: total,
			completedAt: done
				? new Date(this.initialDoneAt ?? 0).toISOString()
				: null,
		};
	}

	private async waitForOwner(): Promise<void> {
		if (this.stopped) return;
		this.owner = await this.deps.resolveOwner().catch(() => null);
		if (!this.owner) {
			this.ownerTimer = setTimeout(
				() => void this.waitForOwner(),
				this.settings.ownerPollMs,
			);
			this.ownerTimer.unref?.();
			return;
		}
		for (const seen of this.files.values()) this.markIfStale(seen);
		if (this.deps.watchFiles !== false) this.watchRoots();
		await this.scan();
		this.beginInitialImport();
		this.scanTimer = setInterval(() => {
			if (this.deps.watchFiles !== false) this.watchRoots();
			void this.scan();
		}, this.settings.scanIntervalMs);
		this.scanTimer.unref?.();
	}

	wake(): void {
		if (!this.owner && !this.stopped) {
			clearTimeout(this.ownerTimer);
			void this.waitForOwner();
		}
	}

	async stop(): Promise<void> {
		this.stopped = true;
		clearTimeout(this.pumpTimer);
		clearTimeout(this.touchTimer);
		clearTimeout(this.ownerTimer);
		clearTimeout(this.initialTimer);
		clearInterval(this.scanTimer);
		for (const watcher of this.watchers.values()) watcher.close();
		this.watchers.clear();
		await Promise.allSettled([...this.inFlight]);
	}

	async notify(
		paths: readonly string[],
		final: boolean,
		stopped = false,
	): Promise<number> {
		if (paths.length === 0) {
			if (this.owner && this.deps.watchFiles !== false) this.watchRoots();
			await this.scan();
			return 0;
		}
		const files = paths
			.map((path) => classifyTranscriptPath(this.deps.roots, path))
			.filter((file): file is TranscriptFile => file !== null);
		if (stopped)
			for (const file of files)
				this.stoppedAt.set(file.sessionPath, this.now());
		await this.observe(files, { final, force: final });
		return files.length;
	}

	status(): IngestStatus {
		let seen = 0;
		let ingested = 0;
		let queued = 0;
		let bytesQueued = 0;
		for (const entry of this.sessions.values()) {
			seen += 1;
			if (entry.running || (entry.dueAt !== null && entry.state !== "failed")) {
				queued += 1;
				bytesQueued += this.sessionBytes(entry.sessionPath);
			} else if (entry.state === "ingested" || entry.state === "kept")
				ingested += 1;
		}
		const importing = queued > 0;
		const elapsed =
			this.importStartedAt === null ? 0 : this.now() - this.importStartedAt;
		const rate =
			elapsed > 2_000 && this.importBytesDone > 0
				? this.importBytesDone / (elapsed / 1000)
				: 0;
		return {
			state:
				!this.owner || this.stopped
					? "paused"
					: importing
						? "importing"
						: "idle",
			sessionsSeen: seen,
			sessionsIngested: ingested,
			sessionsQueued: queued,
			bytesQueued,
			lastIngestAt:
				this.lastIngestAt === null
					? null
					: new Date(this.lastIngestAt).toISOString(),
			etaSeconds: importing && rate > 0 ? Math.ceil(bytesQueued / rate) : null,
			backgroundPriority: this.deps.backgroundPriority,
			initialImport: this.initialImportStatus(),
			agentsRunning: this.agentsRunning(),
		};
	}

	private agentsRunning(): number {
		return this.runningSessions().length;
	}

	async liveSessions(): Promise<LocalLiveSession[]> {
		const owner = this.owner;
		if (!owner) return [];
		const live: LocalLiveSession[] = [];
		for (const [sessionPath, writtenAt] of this.runningSessions()) {
			const entry = this.sessions.get(sessionPath);
			if (!entry?.sessionId) continue;
			const born = await stat(sessionPath).catch(() => null);
			live.push({
				sessionId: entry.sessionId,
				userId: owner.userId,
				source: entry.source,
				projectPath: entry.project?.projectPath ?? "",
				gitRemote: entry.project?.gitRemote ?? null,
				gitBranch: entry.project?.gitBranch ?? null,
				startedAt: new Date(born?.birthtimeMs ?? writtenAt).toISOString(),
				lastActivityAt: new Date(writtenAt).toISOString(),
			});
		}
		return live;
	}

	private runningSessions(): [string, number][] {
		const now = this.now();
		const lastWrite = new Map<string, number>();
		for (const seen of this.files.values()) {
			const { sessionPath } = seen.file;
			if (
				now - seen.stat.mtimeMs > LIVE_SESSION_ACTIVE_WINDOW_MS ||
				seen.stat.mtimeMs < this.watchingSince
			)
				continue;
			lastWrite.set(
				sessionPath,
				Math.max(lastWrite.get(sessionPath) ?? 0, seen.stat.mtimeMs),
			);
		}
		const running: [string, number][] = [];
		for (const [sessionPath, writtenAt] of lastWrite) {
			if (!this.files.has(sessionPath)) continue;
			const stoppedAt = this.stoppedAt.get(sessionPath);
			if (stoppedAt !== undefined && writtenAt <= stoppedAt + STOP_GRACE_MS)
				continue;
			running.push([sessionPath, writtenAt]);
		}
		return running;
	}

	private restore(row: StoredFile): void {
		const file: TranscriptFile = {
			path: row.path,
			source: row.source,
			role: row.role,
			sessionPath: row.sessionPath,
		};
		const decided =
			row.ingestedSize !== null &&
			row.ingestedMtimeMs !== null &&
			row.headSha256 !== null &&
			row.ingestedTailSha256 !== null;
		this.addFile({
			file,
			stat: {
				device: row.device,
				inode: row.inode,
				size: row.size,
				mtimeMs: row.mtimeMs,
			},
			ingested: decided
				? {
						device: row.device,
						inode: row.inode,
						size: row.ingestedSize ?? 0,
						mtimeMs: row.ingestedMtimeMs ?? 0,
						headSha256: row.headSha256 ?? "",
						tailSha256: row.ingestedTailSha256 ?? "",
					}
				: null,
			owner:
				row.organizationId && row.userId
					? { organizationId: row.organizationId, userId: row.userId }
					: null,
		});
		if (row.role !== "session") return;
		const entry = this.entry(row.sessionPath, row.source);
		if (row.sessionId) entry.sessionId = row.sessionId;
		const retry = row.state === "skipped";
		entry.state = retry ? "pending" : row.state;
		entry.reason = row.reason;
		entry.attempts = row.attempts;
		entry.lastIngestAt = row.ingestedAt?.getTime() ?? null;
		if (
			row.state === "ingested" &&
			entry.lastIngestAt !== null &&
			entry.lastIngestAt > (this.lastIngestAt ?? 0)
		)
			this.lastIngestAt = entry.lastIngestAt;
		if (retry) this.schedule(entry, this.now(), true);
		else if (row.state === "pending" || row.state === "failed")
			this.schedule(entry, row.nextAttemptAt?.getTime() ?? this.now(), true);
	}

	private addFile(seen: SeenFile): void {
		this.files.set(seen.file.path, seen);
		if (seen.file.role !== "subagent") return;
		let paths = this.subagentPaths.get(seen.file.sessionPath);
		if (!paths) {
			paths = new Set();
			this.subagentPaths.set(seen.file.sessionPath, paths);
		}
		paths.add(seen.file.path);
	}

	private entry(sessionPath: string, source: TranscriptSource): SessionEntry {
		let entry = this.sessions.get(sessionPath);
		if (!entry) {
			entry = {
				sessionPath,
				source,
				state: "pending",
				reason: null,
				dueAt: null,
				firstDirtyAt: null,
				final: false,
				running: false,
				again: false,
				attempts: 0,
				lastIngestAt: null,
				sessionId: null,
				project: null,
			};
			this.sessions.set(sessionPath, entry);
		}
		return entry;
	}

	private sessionBytes(sessionPath: string): number {
		let bytes = 0;
		for (const seen of this.filesOf(sessionPath)) bytes += seen.stat.size;
		return bytes;
	}

	private filesOf(sessionPath: string): SeenFile[] {
		const main = this.files.get(sessionPath);
		const files = main ? [main] : [];
		for (const path of this.subagentPaths.get(sessionPath) ?? []) {
			const seen = this.files.get(path);
			if (seen) files.push(seen);
		}
		return files;
	}

	private isStale(seen: SeenFile): boolean {
		const ingested = seen.ingested;
		if (!ingested) return true;
		if (
			this.owner &&
			(seen.owner?.organizationId !== this.owner.organizationId ||
				seen.owner?.userId !== this.owner.userId)
		)
			return true;
		return (
			ingested.device !== seen.stat.device ||
			ingested.inode !== seen.stat.inode ||
			ingested.size !== seen.stat.size ||
			ingested.mtimeMs !== seen.stat.mtimeMs
		);
	}

	private markIfStale(seen: SeenFile): void {
		const entry = this.sessions.get(seen.file.sessionPath);
		if (entry?.state === "skipped" && seen.ingested && !this.changedSince(seen))
			return;
		if (this.isStale(seen))
			this.schedule(
				this.entry(seen.file.sessionPath, seen.file.source),
				this.now(),
				true,
			);
	}

	private changedSince(seen: SeenFile): boolean {
		const ingested = seen.ingested;
		return (
			!ingested ||
			ingested.size !== seen.stat.size ||
			ingested.mtimeMs !== seen.stat.mtimeMs ||
			ingested.inode !== seen.stat.inode
		);
	}

	private schedule(entry: SessionEntry, dueAt: number, exact: boolean): void {
		const now = this.now();
		if (entry.running) {
			entry.again = true;
			return;
		}
		let due = dueAt;
		if (!exact) {
			entry.firstDirtyAt ??= now;
			if (entry.lastIngestAt !== null)
				due = Math.max(due, entry.lastIngestAt + this.settings.liveIntervalMs);
			due = Math.min(due, entry.firstDirtyAt + this.settings.maxDelayMs);
		}
		entry.dueAt = exact ? Math.min(entry.dueAt ?? due, due) : due;
		this.importStartedAt ??= now;
		this.pumpSoon(0);
	}

	private pumpSoon(delayMs: number): void {
		if (this.stopped) return;
		clearTimeout(this.pumpTimer);
		this.pumpTimer = setTimeout(() => this.pump(), Math.max(0, delayMs));
		this.pumpTimer.unref?.();
	}

	private pump(): void {
		if (this.stopped || !this.owner) return;
		const now = this.now();
		const due = [...this.sessions.values()]
			.filter((entry) => !entry.running && entry.dueAt !== null)
			.sort(
				(left, right) =>
					(this.files.get(right.sessionPath)?.stat.mtimeMs ?? 0) -
					(this.files.get(left.sessionPath)?.stat.mtimeMs ?? 0),
			);
		let next = Number.POSITIVE_INFINITY;
		const exclusiveRunning = this.exclusiveRunning;
		for (const entry of due) {
			if (exclusiveRunning) break;
			if (this.running >= this.settings.concurrency) break;
			const dueAt = entry.dueAt ?? now;
			if (dueAt > now) {
				next = Math.min(next, dueAt);
				continue;
			}
			const bytes = this.sessionBytes(entry.sessionPath);
			const exclusive = bytes >= this.settings.exclusiveBytes;
			if (exclusive && this.running > 0) break;
			if (
				this.running > 0 &&
				this.runningBytes + bytes > this.settings.memoryBudgetBytes
			)
				continue;
			this.run(entry, bytes);
			if (exclusive) break;
		}
		if (this.running === 0 && due.length === 0) this.finishImportIfIdle();
		if (Number.isFinite(next)) this.pumpSoon(next - now);
	}

	private finishImportIfIdle(): void {
		for (const entry of this.sessions.values())
			if (entry.running || entry.dueAt !== null) return;
		this.importStartedAt = null;
		this.importBytesDone = 0;
	}

	private get exclusiveRunning(): boolean {
		for (const entry of this.sessions.values())
			if (
				entry.running &&
				this.sessionBytes(entry.sessionPath) >= this.settings.exclusiveBytes
			)
				return true;
		return false;
	}

	private run(entry: SessionEntry, bytes: number): void {
		const owner = this.owner;
		if (!owner) return;
		entry.running = true;
		entry.dueAt = null;
		entry.again = false;
		const final = entry.final;
		entry.final = false;
		this.running += 1;
		this.runningBytes += bytes;
		let nextDueAt: number | null = null;
		const work = this.ingest(entry, owner, final)
			.then((due) => {
				nextDueAt = due;
			})
			.catch((error: unknown) => {
				this.deps.log?.(
					`local ingest of ${entry.sessionPath} failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				nextDueAt = this.now() + this.settings.retryBaseMs;
			})
			.finally(() => {
				this.running -= 1;
				this.runningBytes -= bytes;
				entry.running = false;
				this.inFlight.delete(work);
				const again = entry.again;
				entry.again = false;
				if (again && entry.final) this.schedule(entry, this.now(), true);
				else if (nextDueAt !== null) this.schedule(entry, nextDueAt, true);
				else if (again) this.schedule(entry, this.now(), false);
				this.pump();
			});
		this.inFlight.add(work);
	}

	private async ingest(
		entry: SessionEntry,
		owner: Owner,
		final: boolean,
	): Promise<number | null> {
		const main = this.files.get(entry.sessionPath);
		const check = main
			? await checkTranscript(entry.sessionPath, main.ingested, {
					final,
					now: this.now(),
					partialLineGraceMs: this.settings.partialLineGraceMs,
				})
			: null;
		if (!main || !check || check.kind === "missing") {
			entry.firstDirtyAt = null;
			return null;
		}
		main.stat = check.stat;
		if (check.kind === "writing") return this.now() + this.settings.quietMs;
		const { change } = check;
		const subagents = await this.refreshSubagents(entry);
		const snapshot = [main, ...subagents];
		const ownerChanged =
			main.owner?.organizationId !== owner.organizationId ||
			main.owner?.userId !== owner.userId;
		if (
			change.kind === "unchanged" &&
			!ownerChanged &&
			entry.state !== "failed" &&
			entry.state !== "pending" &&
			snapshot.every((seen) => !this.isStale(seen))
		) {
			entry.firstDirtyAt = null;
			return null;
		}
		const outcome = await this.deps.ingestSession(
			{
				sessionPath: entry.sessionPath,
				source: entry.source,
				change,
				bytes: this.sessionBytes(entry.sessionPath),
			},
			owner,
		);
		const at = this.now();
		entry.firstDirtyAt = null;
		const gaveUp =
			outcome.kind === "retry" &&
			entry.attempts + 1 >= this.settings.maxAttempts;
		if (outcome.kind === "retry" && !gaveUp) {
			entry.attempts += 1;
			entry.state = "failed";
			entry.reason = outcome.reason;
			const delay = Math.min(
				this.settings.retryMaxMs,
				this.settings.retryBaseMs * 2 ** Math.min(entry.attempts - 1, 10),
			);
			await this.deps.store.recordOutcome({
				paths: [entry.sessionPath],
				state: "failed",
				reason: outcome.reason,
				nextAttemptAt: new Date(at + delay),
			});
			return at + delay;
		}
		const decided = await this.identities(snapshot, outcome.files ?? []);
		if (outcome.kind === "skipped" || outcome.kind === "retry") {
			const reason =
				outcome.kind === "retry"
					? `${GAVE_UP} ${this.settings.maxAttempts} attempts until the transcript changes or the server restarts: ${outcome.reason}`
					: outcome.reason;
			entry.state = "skipped";
			entry.reason = reason;
			entry.attempts = 0;
			await this.deps.store.recordIngested({
				files: decided,
				sessionId: null,
				organizationId: owner.organizationId,
				userId: owner.userId,
				state: "skipped",
				reason,
				at: new Date(at),
			});
		} else {
			entry.state = outcome.kind;
			entry.reason = outcome.reason ?? null;
			entry.attempts = 0;
			entry.lastIngestAt = at;
			entry.sessionId = outcome.sessionId;
			entry.project = outcome.project ?? entry.project;
			this.lastIngestAt = at;
			this.importBytesDone += outcome.bytes;
			await this.deps.store.recordIngested({
				files: decided,
				sessionId: outcome.sessionId,
				organizationId: owner.organizationId,
				userId: owner.userId,
				state: outcome.kind,
				reason: outcome.reason ?? null,
				at: new Date(at),
			});
			this.deps.onIngested?.();
		}
		for (const { file, stat: fileStat, headSha256, tailSha256 } of decided) {
			const seen = this.files.get(file.path);
			if (!seen) continue;
			seen.stat = fileStat;
			seen.ingested = {
				device: fileStat.device,
				inode: fileStat.inode,
				size: fileStat.size,
				mtimeMs: fileStat.mtimeMs,
				headSha256,
				tailSha256,
			};
			seen.owner = owner;
		}
		return null;
	}

	private async identities(
		files: readonly SeenFile[],
		read: readonly ReadFile[],
	): Promise<IngestedFile[]> {
		const out: IngestedFile[] = [];
		for (const seen of files) {
			const identity =
				read.find((file) => file.path === seen.file.path) ??
				(await identifyTranscript(seen.file.path, seen.stat));
			if (!identity) continue;
			const { device, inode, size, mtimeMs, headSha256, tailSha256 } = identity;
			out.push({
				file: seen.file,
				stat: { device, inode, size, mtimeMs },
				headSha256,
				tailSha256,
			});
		}
		return out;
	}

	private async refreshSubagents(entry: SessionEntry): Promise<SeenFile[]> {
		if (entry.source !== "claude_code") return [];
		const directory = join(
			entry.sessionPath.slice(0, -".jsonl".length),
			"subagents",
		);
		const names = await readdir(directory).catch(() => [] as string[]);
		const files: SeenFile[] = [];
		const seenNow: { file: TranscriptFile; stat: FileStat }[] = [];
		for (const name of names) {
			const file = classifyTranscriptPath(
				this.deps.roots,
				join(directory, name),
			);
			if (!file || file.role !== "subagent") continue;
			const stat = await statTranscript(file.path);
			if (!stat) continue;
			const known = this.files.get(file.path);
			if (known) {
				known.stat = stat;
				files.push(known);
			} else {
				const seen: SeenFile = { file, stat, ingested: null, owner: null };
				this.addFile(seen);
				files.push(seen);
			}
			seenNow.push({ file, stat });
		}
		if (seenNow.length > 0) await this.deps.store.recordSeen(seenNow);
		return files;
	}

	private async scan(): Promise<void> {
		if (this.scanning) {
			this.rescan = true;
			return this.scanning;
		}
		this.scanning = (async () => {
			try {
				do {
					this.rescan = false;
					await this.observe(await this.walk(), { final: false, force: false });
				} while (this.rescan && !this.stopped);
			} catch (error) {
				this.deps.log?.(
					`local ingest scan failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			} finally {
				this.scanning = null;
			}
		})();
		return this.scanning;
	}

	private async observe(
		files: readonly TranscriptFile[],
		options: { readonly final: boolean; readonly force: boolean },
	): Promise<void> {
		const cutoff = this.now() - this.settings.historyDays * DAY_MS;
		const changed: { file: TranscriptFile; stat: FileStat }[] = [];
		const dirty = new Set<string>();
		for (const file of files) {
			const stat = await statTranscript(file.path);
			if (!stat) continue;
			const known = this.files.get(file.path);
			if (!known && stat.mtimeMs < cutoff) continue;
			const same =
				known &&
				known.stat.device === stat.device &&
				known.stat.inode === stat.inode &&
				known.stat.size === stat.size &&
				known.stat.mtimeMs === stat.mtimeMs;
			if (known) known.stat = stat;
			else this.addFile({ file, stat, ingested: null, owner: null });
			if (!same) changed.push({ file, stat });
			const seen = this.files.get(file.path);
			if (seen && (options.force || this.isStale(seen)))
				dirty.add(file.sessionPath);
		}
		if (changed.length > 0) await this.deps.store.recordSeen(changed);
		for (const sessionPath of dirty) {
			const main = this.files.get(sessionPath);
			if (!main) continue;
			const entry = this.entry(sessionPath, main.file.source);
			if (
				entry.state === "skipped" &&
				!options.force &&
				!this.filesOf(sessionPath).some((seen) => this.changedSince(seen))
			)
				continue;
			const now = this.now();
			if (options.final) entry.final = true;
			this.schedule(
				entry,
				options.final || !entry.lastIngestAt
					? now
					: now + this.settings.quietMs,
				options.final || entry.lastIngestAt === null,
			);
		}
	}

	private async walk(): Promise<TranscriptFile[]> {
		const files: TranscriptFile[] = [];
		const { claudeProjects, codexSessions } = this.deps.roots;
		const projects = await readdir(claudeProjects, {
			withFileTypes: true,
		}).catch(() => []);
		for (const project of projects) {
			if (!project.isDirectory()) continue;
			const directory = join(claudeProjects, project.name);
			const entries = await readdir(directory, { withFileTypes: true }).catch(
				() => [],
			);
			for (const entry of entries) {
				const path = join(directory, entry.name);
				if (entry.isFile()) {
					const file = classifyTranscriptPath(this.deps.roots, path);
					if (file) files.push(file);
				} else if (entry.isDirectory() && SAFE_DIRECTORY.test(entry.name)) {
					const subagents = join(path, "subagents");
					for (const name of await readdir(subagents).catch(
						() => [] as string[],
					)) {
						const file = classifyTranscriptPath(
							this.deps.roots,
							join(subagents, name),
						);
						if (file) files.push(file);
					}
				}
			}
		}
		const walkCodex = async (directory: string) => {
			const entries = await readdir(directory, { withFileTypes: true }).catch(
				() => [],
			);
			for (const entry of entries) {
				const path = join(directory, entry.name);
				if (entry.isDirectory()) await walkCodex(path);
				else if (entry.isFile()) {
					const file = classifyTranscriptPath(this.deps.roots, path);
					if (file) files.push(file);
				}
			}
		};
		await walkCodex(codexSessions);
		return files;
	}

	private watchRoots(): void {
		for (const root of [
			this.deps.roots.claudeProjects,
			this.deps.roots.codexSessions,
		]) {
			if (this.watchers.has(root)) continue;
			try {
				const watcher = watch(root, { recursive: true }, (_event, name) => {
					if (name === null) {
						void this.scan();
						return;
					}
					const path = join(root, name.toString());
					if (!path.endsWith(".jsonl") && !path.endsWith(".jsonl.zst")) return;
					this.touched.add(path);
					if (!this.touchTimer) {
						this.touchTimer = setTimeout(() => {
							this.touchTimer = undefined;
							const paths = [...this.touched];
							this.touched.clear();
							const files = paths
								.map((touched) =>
									classifyTranscriptPath(this.deps.roots, touched),
								)
								.filter((file): file is TranscriptFile => file !== null);
							void this.observe(files, { final: false, force: false });
						}, 250);
						this.touchTimer.unref?.();
					}
				});
				watcher.on("error", () => {
					watcher.close();
					this.watchers.delete(root);
				});
				this.watchers.set(root, watcher);
			} catch {}
		}
	}
}
