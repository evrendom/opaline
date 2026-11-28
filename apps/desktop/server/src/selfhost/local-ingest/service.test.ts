import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	appendFile,
	mkdir,
	mkdtemp,
	rename,
	rm,
	stat,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileStore, StoredFile } from "./file-store.js";
import {
	INITIAL_IMPORT_MILESTONE,
	type MilestoneStore,
	memoryMilestoneStore,
} from "./milestone-store.js";
import {
	LocalIngest,
	type Owner,
	type SessionJob,
	type SessionOutcome,
} from "./service.js";
import type { LocalIngestRoots } from "./sources.js";
import { readSession } from "./transcript-file/index.js";
import type { UsageTailJob } from "./usage-tail.js";

let home: string;
let roots: LocalIngestRoots;
const owner: Owner = { organizationId: "org", userId: "user" };

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "local-ingest-"));
	roots = {
		claudeProjects: join(home, ".claude", "projects"),
		codexSessions: join(home, ".codex", "sessions"),
		codexArchivedSessions: join(home, ".codex", "archived_sessions"),
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
					nextAttemptAt: input.coldDueAt ?? null,
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
		freeBytes: async () => Number.MAX_SAFE_INTEGER,
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

test("during the first import, a session big enough to run alone waits until the smaller ones are in", async () => {
	const giant = await session("giant", 1, "g".repeat(400));
	const small = await session("small", 60);
	const older = await session("older", 300);
	const ingest = ingestor();
	const service = create(memoryStore(), ingest, {
		settings: {
			concurrency: 1,
			quietMs: 1,
			liveIntervalMs: 0,
			retryBaseMs: 20,
			exclusiveBytes: 200,
		},
	});
	await service.start();
	await settle(service);
	expect(ingest.calls.map((call) => call.sessionPath)).toEqual([
		small,
		older,
		giant,
	]);
	await service.stop();
});

test("counts sessions written in the last five minutes as running until their turn stops", async () => {
	const working = await session("working", 1);
	await session("quiet", 10);
	let clock = Date.now() - 1_000;
	const service = create(memoryStore(), ingestor(), { now: () => clock });
	await service.start();
	await settle(service);
	expect(service.status().agentsRunning).toBe(0);

	clock += 1_000;
	const written = new Date(clock);
	await appendFile(working, line("working"));
	await utimes(working, written, written);
	await service.notify([working], false);
	expect(service.status().agentsRunning).toBe(1);
	expect(await service.liveSessions()).toMatchObject([
		{ sessionId: working, userId: owner.userId, source: "claude_code" },
	]);

	await service.notify([working], false, true);
	expect(service.status().agentsRunning).toBe(0);
	expect(await service.liveSessions()).toEqual([]);

	const stoppedAt = clock;
	const summary = new Date(stoppedAt + 2_000);
	await appendFile(working, line("stop hook summary"));
	await utimes(working, summary, summary);
	await service.notify([working], false);
	expect(service.status().agentsRunning).toBe(0);

	clock = stoppedAt + 20_000;
	const nextTurn = new Date(clock);
	await appendFile(working, line("next prompt"));
	await utimes(working, nextTurn, nextTurn);
	await service.notify([working], false);
	expect(service.status().agentsRunning).toBe(1);

	clock += 6 * 60_000;
	expect(service.status().agentsRunning).toBe(0);
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
	expect(ingest.calls.map((call) => call.change.kind)).toEqual([
		"whole",
		"appended",
	]);
	await service.stop();
});

/** Imports that each take `ms`, timed when they finish. */
function timedIngestor(ms: number) {
	const calls: SessionJob[] = [];
	const finished: { at: number; kind: string; path: string }[] = [];
	return {
		calls,
		finished,
		ingestSession: async (job: SessionJob): Promise<SessionOutcome> => {
			calls.push(job);
			await Bun.sleep(ms);
			finished.push({
				at: performance.now(),
				kind: job.change.kind,
				path: job.sessionPath,
			});
			return { kind: "ingested", sessionId: job.sessionPath, bytes: 10 };
		},
	};
}

const liveSettings = {
	concurrency: 1,
	quietMs: 1,
	retryBaseMs: 20,
	liveIntervalMs: 10,
	liveGapFactor: 20,
	liveMaxGapMs: 5_000,
	maxDelayMs: 60_000,
};

test("a live session waits 20 times its last import before the next; a quick one is imported again at once", async () => {
	for (const [importMs, atLeast, below] of [
		[40, 750, Number.POSITIVE_INFINITY],
		[0, 0, 400],
	] as const) {
		const path = await session(`live-${importMs}`, 1);
		const ingest = timedIngestor(importMs);
		const service = create(memoryStore(), ingest, { settings: liveSettings });
		await service.start();
		await settle(service);
		await appendFile(path, line("next turn"));
		await service.notify([path], false, true);
		await settle(service);
		const imports = ingest.finished.filter((call) => call.path === path);
		expect(imports.map((call) => call.kind)).toEqual(["whole", "appended"]);
		const [first, second] = imports;
		const waited = (second?.at ?? 0) - (first?.at ?? 0);
		expect(waited).toBeGreaterThanOrEqual(atLeast);
		expect(waited).toBeLessThan(below);
		await service.stop();
	}
});

test("the session's end and a look at the session import at once, past the live gap", async () => {
	const path = await session("ending", 1);
	const ingest = timedIngestor(40);
	const service = create(memoryStore(), ingest, { settings: liveSettings });
	await service.start();
	await settle(service);
	expect(service.refresh(path)).toBe(false);

	await appendFile(path, line("last turn"));
	let asked = performance.now();
	await service.notify([path], true, true);
	await settle(service);
	expect((ingest.finished[1]?.at ?? 0) - asked).toBeLessThan(400);

	await appendFile(path, line("one more"));
	await service.notify([path], false, true);
	asked = performance.now();
	expect(service.refresh(path)).toBe(true);
	await settle(service);
	expect(ingest.finished).toHaveLength(3);
	expect((ingest.finished[2]?.at ?? 0) - asked).toBeLessThan(400);
	// Someone is reading it: that import is full, not hot.
	expect(ingest.calls.map((call) => call.derived)).toEqual([
		"full",
		"full",
		"full",
	]);
	await service.stop();
});

test("the stored identity is the bytes the import read, also when the file grows around the read", async () => {
	const path = await session("growing", 1, "first");
	const store = memoryStore();
	const calls: SessionJob[] = [];
	const service = create(store, {
		calls,
		ingestSession: async (job) => {
			calls.push(job);
			if (calls.length > 1)
				return { kind: "ingested", sessionId: "growing", bytes: 1 };
			await appendFile(path, line("during"));
			const read = await readSession(job.sessionPath, job.change);
			await appendFile(path, line("after"));
			return {
				kind: "ingested",
				sessionId: "growing",
				bytes: read.content.length,
				files: read.files(),
			};
		},
	});
	await service.start();
	await settle(service);
	const readBytes = Buffer.byteLength(
		`${line("first")}${line("during")}`,
		"utf8",
	);
	expect(store.rows.get(path)?.ingestedSize).toBe(readBytes);
	await service.notify([path], true);
	await settle(service);
	expect(calls.map((call) => call.change.kind)).toEqual(["whole", "appended"]);
	expect(calls[1]?.change.since?.size).toBe(readBytes);
	await service.stop();
});

test("a transcript replaced by rename while it is read is imported again", async () => {
	const path = await session("renamed", 1, "first");
	const store = memoryStore();
	const calls: SessionJob[] = [];
	const service: LocalIngest = create(store, {
		calls,
		ingestSession: async (job) => {
			calls.push(job);
			if (calls.length > 1)
				return { kind: "ingested", sessionId: "renamed", bytes: 1 };
			const read = await readSession(job.sessionPath, job.change);
			await writeFile(`${path}.next`, `${line("first")}${line("replaced")}`);
			await rename(`${path}.next`, path);
			await service.notify([path], false);
			return {
				kind: "ingested",
				sessionId: "renamed",
				bytes: read.content.length,
				files: read.files(),
			};
		},
	});
	await service.start();
	await settle(service);
	await service.notify([path], false);
	await settle(service);
	expect(calls.map((call) => call.change)).toMatchObject([
		{ kind: "whole", reason: "new" },
		{ kind: "whole", reason: "replaced" },
	]);
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

test("a restart gives a session it gave up on or skipped one more round", async () => {
	const broken = await session("broken", 1);
	const oversized = await session("oversized", 1);
	const store = memoryStore();
	const outcomes = new Map<string, SessionOutcome>([
		[
			broken,
			{ kind: "retry", reason: 'could not access file "$libdir/plpgsql"' },
		],
		[oversized, { kind: "skipped", reason: "content Too big" }],
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
	expect(store.rows.get(oversized)?.state).toBe("skipped");
	await service.stop();
	const second = ingestor();
	const restarted = create(store, second, { settings });
	await restarted.start();
	await waitFor(
		() =>
			store.rows.get(broken)?.state === "ingested" &&
			store.rows.get(oversized)?.state === "ingested",
	);
	expect(second.calls).toHaveLength(2);
	await restarted.stop();
});

test("the first import holds recent sessions by modification time, then every older one follows", async () => {
	const folder = join(roots.codexSessions, "2026", "08", "25");
	await mkdir(folder, { recursive: true });
	const resumed = join(folder, "rollout-2026-08-25T19-51-29-a.jsonl");
	await writeFile(resumed, line("resumed"));
	const stale = join(folder, "rollout-2026-08-25T19-51-30-b.jsonl");
	await writeFile(stale, line("stale"));
	const archive = join(home, ".codex", "archived_sessions");
	await mkdir(archive, { recursive: true });
	const archived = join(archive, "rollout-2026-03-01T10-00-00-c.jsonl");
	await writeFile(archived, line("archived"));
	const old = new Date(Date.now() - 80 * 86_400_000);
	const older = new Date(Date.now() - 200 * 86_400_000);
	await utimes(stale, old, old);
	await utimes(archived, older, older);
	const ingest = ingestor();
	const service = create(memoryStore(), ingest, {
		settings: initialSettings,
	});
	await service.start();
	const first = await initialImportDone(service);
	expect(first).toMatchObject({ sessionsDone: 1, sessionsTotal: 1 });
	await waitFor(() => ingest.calls.length === 3);
	await settle(service);
	expect(ingest.calls.map((call) => call.sessionPath)).toEqual([
		resumed,
		stale,
		archived,
	]);
	await service.stop();
});

test("after a finished first import, a restart imports history the window had left out", async () => {
	const folder = join(roots.codexSessions, "2026", "08", "25");
	await mkdir(folder, { recursive: true });
	const stale = join(folder, "rollout-2026-08-25T19-51-30-b.jsonl");
	await writeFile(stale, line("stale"));
	const old = new Date(Date.now() - 80 * 86_400_000);
	await utimes(stale, old, old);
	const milestones = memoryMilestoneStore();
	await milestones.reach(INITIAL_IMPORT_MILESTONE, new Date());
	const ingest = ingestor();
	const service = create(memoryStore(), ingest, { milestones });
	await service.start();
	await waitFor(() => ingest.calls.length === 1);
	await settle(service);
	expect(ingest.calls.map((call) => call.sessionPath)).toEqual([stale]);
	await service.stop();
});

const initialSettings = {
	concurrency: 1,
	quietMs: 1,
	liveIntervalMs: 0,
	retryBaseMs: 1,
	initialPollMs: 5,
};

function gated(ingest: ReturnType<typeof ingestor>) {
	let open: () => void = () => {};
	let gate = new Promise<void>((resolve) => {
		open = resolve;
	});
	return {
		ingestSession: async (job: SessionJob) => {
			await gate;
			return ingest.ingestSession(job);
		},
		open: () => open(),
		close: () => {
			gate = new Promise<void>((resolve) => {
				open = resolve;
			});
		},
	};
}

async function initialImportDone(service: LocalIngest) {
	await waitFor(() => service.status().initialImport.active === false);
	return service.status().initialImport;
}

test("the initial import is active through the first backfill and its derived work, then finishes", async () => {
	await session("a", 5);
	await session("b", 10);
	const store = memoryStore();
	const milestones = memoryMilestoneStore();
	const ingest = ingestor();
	const gate = gated(ingest);
	let derived = 0;
	const service = create(store, ingest, {
		ingestSession: gate.ingestSession,
		milestones,
		derivedQueued: async () => derived,
		settings: initialSettings,
	});
	await service.start();
	expect(service.status().initialImport).toEqual({
		active: true,
		sessionsDone: 0,
		sessionsTotal: 2,
		completedAt: null,
	});
	derived = 3;
	gate.open();
	await settle(service);
	await Bun.sleep(30);
	expect(service.status().initialImport).toMatchObject({
		active: true,
		sessionsDone: 2,
		sessionsTotal: 2,
	});
	expect(await milestones.reachedAt(INITIAL_IMPORT_MILESTONE)).toBeNull();
	derived = 0;
	const finished = await initialImportDone(service);
	expect(finished).toMatchObject({ sessionsDone: 2, sessionsTotal: 2 });
	expect(finished.completedAt).not.toBeNull();
	expect(await milestones.reachedAt(INITIAL_IMPORT_MILESTONE)).not.toBeNull();
	await service.stop();
});

test("a finished initial import stays finished for live re-imports, new sessions and restarts", async () => {
	const live = await session("live", 1);
	const store = memoryStore();
	const milestones = memoryMilestoneStore();
	const ingest = ingestor();
	const gate = gated(ingest);
	let derived = 0;
	const service = create(store, ingest, {
		ingestSession: gate.ingestSession,
		milestones,
		derivedQueued: async () => derived,
		settings: initialSettings,
	});
	gate.open();
	await service.start();
	await initialImportDone(service);
	gate.close();
	derived = 4;
	await appendFile(live, line("more"));
	const fresh = await session("fresh", 0);
	await service.notify([live, fresh], false);
	await waitFor(() => service.status().state === "importing");
	expect(service.status().initialImport.active).toBe(false);
	await Bun.sleep(30);
	expect(service.status().initialImport.active).toBe(false);
	gate.open();
	await settle(service);
	await service.stop();

	await session("after-restart", 0);
	const restarted = create(store, ingestor(), {
		milestones,
		derivedQueued: async () => 9,
		settings: initialSettings,
	});
	await restarted.start();
	expect(restarted.status().initialImport.active).toBe(false);
	await settle(restarted);
	expect(restarted.status().initialImport.active).toBe(false);
	await restarted.stop();
});

test("an install whose sessions were all imported before counts as finished at start", async () => {
	await session("a", 5);
	await session("b", 10);
	const store = memoryStore();
	const before = create(store, ingestor(), { settings: initialSettings });
	await before.start();
	await settle(before);
	await before.stop();

	await session("new-while-closed", 0);
	const milestones: MilestoneStore = memoryMilestoneStore();
	const upgraded = create(store, ingestor(), {
		milestones,
		derivedQueued: async () => 12,
		settings: initialSettings,
	});
	await upgraded.start();
	expect(upgraded.status().initialImport.active).toBe(false);
	expect(upgraded.status().initialImport.completedAt).not.toBeNull();
	expect(await milestones.reachedAt(INITIAL_IMPORT_MILESTONE)).not.toBeNull();
	await settle(upgraded);
	expect(upgraded.status().initialImport.active).toBe(false);
	await upgraded.stop();
});

test("an install with a session that was never imported resumes its initial import", async () => {
	const done = await session("done", 5);
	const unread = await session("unread", 10);
	const store = memoryStore();
	await store.recordIngested({
		files: [
			{
				file: {
					path: done,
					source: "claude_code",
					role: "session",
					sessionPath: done,
				},
				stat: { device: "1", inode: "1", size: 1, mtimeMs: 1 },
				headSha256: "h",
				tailSha256: "t",
			},
		],
		sessionId: done,
		organizationId: owner.organizationId,
		userId: owner.userId,
		state: "ingested",
		reason: null,
		at: new Date(),
	});
	await store.recordSeen([
		{
			file: {
				path: unread,
				source: "claude_code",
				role: "session",
				sessionPath: unread,
			},
			stat: { device: "1", inode: "2", size: 1, mtimeMs: 1 },
		},
	]);
	const ingest = ingestor();
	const gate = gated(ingest);
	const service = create(store, ingest, {
		ingestSession: gate.ingestSession,
		settings: initialSettings,
	});
	await service.start();
	expect(service.status().initialImport).toMatchObject({
		active: true,
		sessionsDone: 1,
		sessionsTotal: 2,
	});
	gate.open();
	await initialImportDone(service);
	await service.stop();
});

test("skipped and given-up sessions do not keep the initial import active", async () => {
	const good = await session("good", 1);
	const oversized = await session("oversized", 2);
	const broken = await session("broken", 3);
	const store = memoryStore();
	const ingest = ingestor(
		new Map<string, SessionOutcome>([
			[oversized, { kind: "skipped", reason: "content Too big" }],
			[broken, { kind: "retry", reason: "usage telemetry is malformed" }],
		]),
	);
	const milestones = memoryMilestoneStore();
	const service = create(store, ingest, {
		milestones,
		derivedQueued: async () => 0,
		settings: { ...initialSettings, maxAttempts: 2 },
	});
	await service.start();
	const finished = await initialImportDone(service);
	expect(finished).toMatchObject({ sessionsDone: 3, sessionsTotal: 3 });
	expect(store.rows.get(good)?.state).toBe("ingested");
	expect(store.rows.get(oversized)?.state).toBe("skipped");
	expect(store.rows.get(broken)?.state).toBe("skipped");
	expect(await milestones.reachedAt(INITIAL_IMPORT_MILESTONE)).not.toBeNull();
	await service.stop();
});

test("older history comes in batches, newest first, and waits while the disk is nearly full", async () => {
	const folder = join(roots.codexSessions, "2026", "07", "01");
	await mkdir(folder, { recursive: true });
	const paths: string[] = [];
	for (let index = 0; index < 5; index += 1) {
		const path = join(
			folder,
			`rollout-2026-07-01T10-00-0${index}-h${index}.jsonl`,
		);
		await writeFile(path, line(`history ${index}`));
		const at = new Date(Date.now() - (60 + index) * 86_400_000);
		await utimes(path, at, at);
		paths.push(path);
	}
	const milestones = memoryMilestoneStore();
	await milestones.reach(INITIAL_IMPORT_MILESTONE, new Date());
	let free = 1024;
	const logged: string[] = [];
	const ingest = ingestor();
	const service = create(memoryStore(), ingest, {
		milestones,
		freeBytes: async () => free,
		log: (entry) => logged.push(entry),
		settings: {
			concurrency: 1,
			quietMs: 1,
			liveIntervalMs: 0,
			retryBaseMs: 20,
			historyBatchSessions: 2,
			historyMinFreeBytes: 4096,
		},
	});
	await service.start();
	await settle(service);
	expect(ingest.calls).toHaveLength(0);
	expect(logged.some((entry) => entry.includes("paused older history"))).toBe(
		true,
	);
	free = 8192;
	await service.notify([], false);
	await waitFor(() => ingest.calls.length === 5);
	await settle(service);
	expect(ingest.calls.map((call) => call.sessionPath)).toEqual(paths);
	await service.stop();
});

test("a new Gemini translation imports every Gemini session again once; Claude Code sessions are left alone", async () => {
	const claude = await session("a", 5);
	const geminiRoots: LocalIngestRoots = {
		...roots,
		geminiTmp: join(home, ".gemini", "tmp"),
	};
	const chats = join(home, ".gemini", "tmp", "repo", "chats");
	await mkdir(chats, { recursive: true });
	const gemini = join(chats, "session-2026-11-21T10-00-8d1f6a6e.jsonl");
	await writeFile(gemini, line("gemini"));
	const store = memoryStore();
	const milestones = memoryMilestoneStore();
	const first = ingestor();
	const service = create(store, first, { roots: geminiRoots, milestones });
	await service.start();
	await settle(service);
	await service.stop();
	expect(first.calls.map((call) => call.sessionPath).sort()).toEqual(
		[claude, gemini].sort(),
	);
	// Nothing new to translate: a restart imports nothing.
	const second = ingestor();
	const restarted = create(store, second, { roots: geminiRoots, milestones });
	await restarted.start();
	await settle(restarted);
	await restarted.stop();
	expect(second.calls).toHaveLength(0);
	// An install from before this translation has no milestone yet.
	const third = ingestor();
	const upgraded = create(store, third, {
		roots: geminiRoots,
		milestones: memoryMilestoneStore(),
	});
	await upgraded.start();
	await settle(upgraded);
	await upgraded.stop();
	expect(third.calls.map((call) => call.sessionPath)).toEqual([gemini]);
});

const derivedOf = (calls: readonly SessionJob[]) =>
	calls.map((call) => call.derived ?? "full");

test("a live session's re-imports are hot; once it is quiet it gets one full import, later for every new write", async () => {
	const path = await session("live", 0);
	const ingest = timedIngestor(0);
	const service = create(memoryStore(), ingest, {
		settings: { ...liveSettings, liveIntervalMs: 0, coldQuietMs: 300 },
	});
	await service.start();
	await settle(service);
	await appendFile(path, line("turn 2"));
	await service.notify([path], false);
	await waitFor(() => ingest.calls.length === 2);
	await Bun.sleep(150);
	await appendFile(path, line("turn 3"));
	const lastWrite = performance.now();
	await service.notify([path], false);
	// The full import it owes is not counted as queued work.
	await waitFor(
		() => ingest.finished.length === 3 && service.status().sessionsQueued === 0,
	);
	expect(derivedOf(ingest.calls)).toEqual(["full", "hot", "hot"]);

	await waitFor(() => ingest.finished.length === 4);
	expect(derivedOf(ingest.calls)).toEqual(["full", "hot", "hot", "full"]);
	expect(ingest.calls[3]?.change.kind).toBe("unchanged");
	expect((ingest.finished[3]?.at ?? 0) - lastWrite).toBeGreaterThanOrEqual(290);
	await Bun.sleep(400);
	expect(ingest.calls).toHaveLength(4);
	await service.stop();
});

test("the session's end gets the full import it owes at once; a session past the quiet window is imported in full", async () => {
	const path = await session("ending", 0);
	const quiet = await session("quiet", 10);
	const ingest = ingestor();
	const service = create(memoryStore(), ingest, {
		settings: {
			concurrency: 1,
			quietMs: 1,
			liveIntervalMs: 0,
			coldQuietMs: 60_000,
		},
	});
	await service.start();
	await settle(service);
	await appendFile(path, line("last turn"));
	await service.notify([path], false);
	await waitFor(() => ingest.calls.length === 3);
	await service.notify([path], true);
	await waitFor(() => ingest.calls.length === 4);
	expect(
		ingest.calls.map((call) => [call.sessionPath, call.derived ?? "full"]),
	).toEqual([
		[path, "full"],
		[quiet, "full"],
		[path, "hot"],
		[path, "full"],
	]);
	await service.notify([path], true);
	await settle(service);
	expect(ingest.calls).toHaveLength(4);

	const old = new Date(Date.now() - 10 * 60_000);
	await appendFile(quiet, line("late line"));
	await utimes(quiet, old, old);
	await service.notify([quiet], false);
	await waitFor(() => ingest.calls.length === 5);
	expect(ingest.calls[4]).toMatchObject({
		sessionPath: quiet,
		derived: "full",
	});
	await service.stop();
});

test("a session only imported hot gets its full import after a restart", async () => {
	const path = await session("live", 0);
	const store = memoryStore();
	const first = ingestor();
	const service = create(store, first, {
		settings: {
			concurrency: 1,
			quietMs: 1,
			liveIntervalMs: 0,
			coldQuietMs: 60_000,
		},
	});
	await service.start();
	await settle(service);
	await appendFile(path, line("turn 2"));
	await service.notify([path], false);
	await waitFor(() => first.calls.length === 2);
	await settle(service);
	await service.stop();
	expect(derivedOf(first.calls)).toEqual(["full", "hot"]);
	expect(store.rows.get(path)?.nextAttemptAt).not.toBeNull();

	const second = ingestor();
	const restarted = create(store, second, {
		now: () => Date.now() + 2 * 60_000,
		settings: {
			concurrency: 1,
			quietMs: 1,
			liveIntervalMs: 0,
			coldQuietMs: 60_000,
		},
	});
	await restarted.start();
	await waitFor(() => second.calls.length === 1);
	await settle(restarted);
	expect(second.calls.map((call) => [call.derived, call.change.kind])).toEqual([
		["full", "unchanged"],
	]);
	expect(store.rows.get(path)?.nextAttemptAt).toBeNull();
	await restarted.stop();

	const third = ingestor();
	const again = create(store, third);
	await again.start();
	await settle(again);
	expect(third.calls).toHaveLength(0);
	await again.stop();
});

test("due sessions run most recently written first, a subagent's write counting for its parent", async () => {
	const parent = await session("parent", 60);
	const subagents = join(roots.claudeProjects, "-repo", "parent", "subagents");
	await mkdir(subagents, { recursive: true });
	const subagent = join(subagents, "agent-a1.jsonl");
	await writeFile(subagent, line("sub"));
	const recent = new Date(Date.now() - 60_000);
	await utimes(subagent, recent, recent);
	const middle = await session("middle", 30);
	const old = await session("old", 90);
	const ingest = ingestor();
	const service = create(memoryStore(), ingest);
	await service.start();
	await settle(service);
	expect(ingest.calls.map((call) => call.sessionPath)).toEqual([
		parent,
		middle,
		old,
	]);
	await service.stop();
});

test("between imports, a live Claude Code session's appended usage is read from where the last import stopped", async () => {
	const path = await session("tailed", 0);
	const firstSize = (await stat(path)).size;
	const ingest = timedIngestor(40);
	const tails: UsageTailJob[] = [];
	const service = create(memoryStore(), ingest, {
		settings: { ...liveSettings, tailIntervalMs: 50 },
		tailUsage: async (job) => {
			tails.push(job);
		},
	});
	await service.start();
	await settle(service);
	expect(tails).toHaveLength(0);
	await appendFile(path, line("turn 2"));
	await service.notify([path], false);
	await waitFor(() => tails.length === 1);
	expect(tails[0]).toEqual({
		sessionId: "tailed",
		source: "claude_code",
		files: [{ path, fromByte: firstSize, agentId: null }],
	});
	// Its next import still waits out the live gap.
	expect(ingest.calls).toHaveLength(1);
	await service.stop();
});
