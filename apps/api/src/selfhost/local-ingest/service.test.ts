import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	appendFile,
	mkdir,
	mkdtemp,
	rm,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileStore, StoredFile } from "./file-store.js";
import {
	LocalIngest,
	type Owner,
	type SessionJob,
	type SessionOutcome,
} from "./service.js";
import type { LocalIngestRoots } from "./sources.js";

let home: string;
let roots: LocalIngestRoots;
const owner: Owner = { organizationId: "org", userId: "user" };

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "local-ingest-"));
	roots = {
		claudeProjects: join(home, ".claude", "projects"),
		codexSessions: join(home, ".codex", "sessions"),
	};
	await mkdir(join(roots.claudeProjects, "-repo"), { recursive: true });
	await mkdir(join(roots.codexSessions, "2026", "11", "09"), {
		recursive: true,
	});
});

afterEach(async () => {
	await rm(home, { recursive: true, force: true });
});

function memoryStore(): FileStore & { rows: Map<string, StoredFile> } {
	const rows = new Map<string, StoredFile>();
	const base = (path: string): StoredFile =>
		rows.get(path) ?? {
			path,
			source: "claude_code",
			role: "session",
			sessionPath: path,
			sessionId: null,
			organizationId: null,
			userId: null,
			device: "",
			inode: "",
			size: 0,
			mtimeMs: 0,
			headSha256: null,
			ingestedSize: null,
			ingestedTailSha256: null,
			ingestedMtimeMs: null,
			state: "pending",
			reason: null,
			attempts: 0,
			nextAttemptAt: null,
			ingestedAt: null,
		};
	return {
		rows,
		async loadAll() {
			return [...rows.values()];
		},
		async recordSeen(files) {
			for (const { file, stat } of files)
				rows.set(file.path, {
					...base(file.path),
					source: file.source,
					role: file.role,
					sessionPath: file.sessionPath,
					...stat,
				});
		},
		async recordIngested(input) {
			for (const { file, stat, headSha256, tailSha256 } of input.files)
				rows.set(file.path, {
					...base(file.path),
					source: file.source,
					role: file.role,
					sessionPath: file.sessionPath,
					...stat,
					sessionId: input.sessionId,
					organizationId: input.organizationId,
					userId: input.userId,
					headSha256,
					ingestedSize: stat.size,
					ingestedTailSha256: tailSha256,
					ingestedMtimeMs: stat.mtimeMs,
					state: input.state,
					reason: input.reason,
					attempts: 0,
					nextAttemptAt: null,
					ingestedAt: input.at,
				});
		},
		async recordOutcome(input) {
			for (const path of input.paths) {
				const row = base(path);
				rows.set(path, {
					...row,
					state: input.state,
					reason: input.reason,
					attempts: row.attempts + (input.state === "failed" ? 1 : 0),
					nextAttemptAt: input.nextAttemptAt,
				});
			}
		},
	};
}

const line = (text: string) =>
	`${JSON.stringify({ type: "user", timestamp: "2026-11-09T10:00:00Z", text })}\n`;

async function session(name: string, ageMinutes: number, text = name) {
	const path = join(roots.claudeProjects, "-repo", `${name}.jsonl`);
	await writeFile(path, line(text));
	const at = new Date(Date.now() - ageMinutes * 60_000);
	await utimes(path, at, at);
	return path;
}

function ingestor(outcomes: Map<string, SessionOutcome> = new Map()) {
	const calls: SessionJob[] = [];
	return {
		calls,
		ingestSession: async (job: SessionJob): Promise<SessionOutcome> => {
			calls.push(job);
			return (
				outcomes.get(job.sessionPath) ?? {
					kind: "ingested",
					sessionId: job.sessionPath,
					bytes: 10,
				}
			);
		},
	};
}

async function settle(service: LocalIngest) {
	for (let i = 0; i < 400; i++) {
		const status = service.status();
		if (status.state === "idle" && status.sessionsQueued === 0) return status;
		await Bun.sleep(5);
	}
	throw new Error(`did not settle: ${JSON.stringify(service.status())}`);
}

async function waitFor(condition: () => boolean) {
	for (let i = 0; i < 400 && !condition(); i++) await Bun.sleep(5);
	if (!condition()) throw new Error("condition not reached");
}

function create(
	store: FileStore,
	ingest: ReturnType<typeof ingestor>,
	extra: Partial<ConstructorParameters<typeof LocalIngest>[0]> = {},
) {
	return new LocalIngest({
		roots,
		store,
		resolveOwner: async () => owner,
		ingestSession: ingest.ingestSession,
		backgroundPriority: true,
		watchFiles: false,
		settings: {
			concurrency: 1,
			quietMs: 1,
			liveIntervalMs: 0,
			retryBaseMs: 20,
		},
		...extra,
	});
}

test("imports every session once, newest first, and reports progress", async () => {
	const old = await session("old", 300);
	const newest = await session("newest", 1);
	const middle = await session("middle", 60);
	const store = memoryStore();
	const ingest = ingestor();
	const service = create(store, ingest);
	await service.start();
	const status = await settle(service);
	expect(ingest.calls.map((call) => call.sessionPath)).toEqual([
		newest,
		middle,
		old,
	]);
	expect(status).toMatchObject({
		state: "idle",
		sessionsSeen: 3,
		sessionsIngested: 3,
		sessionsQueued: 0,
		bytesQueued: 0,
		etaSeconds: null,
		backgroundPriority: true,
	});
	expect(status.lastIngestAt).not.toBeNull();
	await service.notify([], false);
	await settle(service);
	expect(ingest.calls).toHaveLength(3);
	await service.stop();
});

test("a restart resumes from the stored state without importing again", async () => {
	await session("a", 5);
	await session("b", 10);
	const store = memoryStore();
	const first = ingestor();
	const service = create(store, first);
	await service.start();
	await settle(service);
	await service.stop();
	const second = ingestor();
	const restarted = create(store, second);
	await restarted.start();
	const status = await settle(restarted);
	expect(second.calls).toHaveLength(0);
	expect(status.sessionsIngested).toBe(2);
	expect(status.lastIngestAt).not.toBeNull();
	await restarted.stop();
});

test("an appended session is imported again; a hook ping makes it due at once", async () => {
	const path = await session("live", 1);
	const store = memoryStore();
	const ingest = ingestor();
	const service = create(store, ingest);
	await service.start();
	await settle(service);
	await appendFile(path, line("more"));
	expect(await service.notify([path], true)).toBe(1);
	await settle(service);
	expect(ingest.calls.map((call) => call.change)).toEqual(["new", "appended"]);
	await service.stop();
});

test("a skipped session waits for a change; a failed one is retried", async () => {
	const skipped = await session("empty", 2);
	const flaky = await session("flaky", 1);
	const store = memoryStore();
	const outcomes = new Map<string, SessionOutcome>([
		[skipped, { kind: "skipped", reason: "no timestamped records" }],
		[flaky, { kind: "retry", reason: "ClickHouse busy" }],
	]);
	const ingest = ingestor(outcomes);
	const service = create(store, ingest);
	await service.start();
	for (
		let i = 0;
		i < 200 && ingest.calls.filter((c) => c.sessionPath === flaky).length < 2;
		i++
	)
		await Bun.sleep(5);
	outcomes.delete(flaky);
	await waitFor(() => store.rows.get(flaky)?.state === "ingested");
	await settle(service);
	expect(
		ingest.calls.filter((c) => c.sessionPath === flaky).length,
	).toBeGreaterThanOrEqual(2);
	expect(store.rows.get(flaky)?.state).toBe("ingested");
	expect(store.rows.get(skipped)?.state).toBe("skipped");
	const skippedCalls = ingest.calls.filter(
		(c) => c.sessionPath === skipped,
	).length;
	await service.notify([], false);
	await settle(service);
	expect(ingest.calls.filter((c) => c.sessionPath === skipped)).toHaveLength(
		skippedCalls,
	);
	await appendFile(skipped, line("now it has one"));
	await service.notify([skipped], false);
	await settle(service);
	expect(ingest.calls.filter((c) => c.sessionPath === skipped)).toHaveLength(
		skippedCalls + 1,
	);
	await service.stop();
});

test("a subagent change imports its parent session; files outside the window are left alone", async () => {
	const parent = await session("parent", 1);
	const subagents = join(roots.claudeProjects, "-repo", "parent", "subagents");
	await mkdir(subagents, { recursive: true });
	const subagent = join(subagents, "agent-a1.jsonl");
	await writeFile(subagent, line("sub"));
	const ancient = await session("ancient", 60 * 24 * 40);
	const store = memoryStore();
	const ingest = ingestor();
	const service = create(store, ingest);
	await service.start();
	await settle(service);
	expect(ingest.calls.map((call) => call.sessionPath)).toEqual([parent]);
	expect(store.rows.has(ancient)).toBe(false);
	expect(store.rows.get(subagent)?.state).toBe("ingested");
	await appendFile(subagent, line("sub more"));
	await service.notify([subagent], true);
	await settle(service);
	expect(ingest.calls.map((call) => call.sessionPath)).toEqual([
		parent,
		parent,
	]);
	await service.stop();
});

test("nothing is imported before the server has an owner", async () => {
	await session("a", 1);
	let ready: Owner | null = null;
	const ingest = ingestor();
	const service = create(memoryStore(), ingest, {
		resolveOwner: async () => ready,
		settings: { concurrency: 1, quietMs: 1, ownerPollMs: 10_000 },
	});
	await service.start();
	expect(service.status().state).toBe("paused");
	expect(ingest.calls).toHaveLength(0);
	ready = owner;
	service.wake();
	await Bun.sleep(20);
	await settle(service);
	expect(ingest.calls).toHaveLength(1);
	await service.stop();
});

test("a partial last line waits for the writer unless the hook says the session ended", async () => {
	const path = join(roots.claudeProjects, "-repo", "writing.jsonl");
	await writeFile(path, `${line("a")}{"type":"user","timest`);
	const ingest = ingestor();
	const service = create(memoryStore(), ingest, {
		settings: {
			concurrency: 1,
			quietMs: 30,
			liveIntervalMs: 0,
			partialLineGraceMs: 60_000,
		},
	});
	await service.start();
	await Bun.sleep(80);
	expect(ingest.calls).toHaveLength(0);
	await service.notify([path], true);
	await settle(service);
	expect(ingest.calls).toHaveLength(1);
	await service.stop();
});

test("a session that keeps failing is given up until its transcript changes, and stops counting as queued", async () => {
	const broken = await session("broken", 1);
	const store = memoryStore();
	const outcomes = new Map<string, SessionOutcome>([
		[broken, { kind: "retry", reason: "usage telemetry is malformed" }],
	]);
	const ingest = ingestor(outcomes);
	const service = create(store, ingest, {
		settings: {
			concurrency: 1,
			quietMs: 1,
			liveIntervalMs: 0,
			retryBaseMs: 1,
			maxAttempts: 3,
		},
	});
	await service.start();
	await waitFor(() => store.rows.get(broken)?.state === "skipped");
	const status = await settle(service);
	expect(ingest.calls).toHaveLength(3);
	expect(status).toMatchObject({
		state: "idle",
		sessionsQueued: 0,
		sessionsIngested: 0,
	});
	expect(store.rows.get(broken)?.state).toBe("skipped");
	expect(store.rows.get(broken)?.reason).toContain("gave up after 3 attempts");
	outcomes.delete(broken);
	await appendFile(broken, line("fixed"));
	await service.notify([broken], false);
	await waitFor(() => store.rows.get(broken)?.state === "ingested");
	expect(ingest.calls).toHaveLength(4);
	await service.stop();
});

test("a restart gives a session it gave up on one more round", async () => {
	const broken = await session("broken", 1);
	const store = memoryStore();
	const outcomes = new Map<string, SessionOutcome>([
		[
			broken,
			{ kind: "retry", reason: 'could not access file "$libdir/plpgsql"' },
		],
	]);
	const settings = {
		concurrency: 1,
		quietMs: 1,
		liveIntervalMs: 0,
		retryBaseMs: 1,
		maxAttempts: 2,
	};
	const service = create(store, ingestor(outcomes), { settings });
	await service.start();
	await waitFor(() => store.rows.get(broken)?.state === "skipped");
	await settle(service);
	await service.stop();
	const second = ingestor();
	const restarted = create(store, second, { settings });
	await restarted.start();
	await waitFor(() => store.rows.get(broken)?.state === "ingested");
	expect(second.calls).toHaveLength(1);
	await restarted.stop();
});

test("a resumed Codex session in an old day folder is imported by its modification time", async () => {
	const folder = join(roots.codexSessions, "2026", "08", "25");
	await mkdir(folder, { recursive: true });
	const resumed = join(folder, "rollout-2026-08-25T19-51-29-a.jsonl");
	await writeFile(resumed, line("resumed"));
	const stale = join(folder, "rollout-2026-08-25T19-51-30-b.jsonl");
	await writeFile(stale, line("stale"));
	const old = new Date(Date.now() - 80 * 86_400_000);
	await utimes(stale, old, old);
	const ingest = ingestor();
	const service = create(memoryStore(), ingest);
	await service.start();
	await settle(service);
	expect(ingest.calls.map((call) => call.sessionPath)).toEqual([resumed]);
	await service.stop();
});
