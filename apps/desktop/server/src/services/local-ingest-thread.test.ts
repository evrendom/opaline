import { expect, test } from "bun:test";
import type { SessionJob } from "../selfhost/local-ingest/service.js";
import { LocalIngestThread } from "./local-ingest-thread.js";

type Listener = (event: { data: unknown }) => void;

/** A worker that answers every session at once and counts how often it is ended. */
function fakeWorkers() {
	const started: { terminated: boolean }[] = [];
	const create = () => {
		const state = { terminated: false };
		started.push(state);
		const listeners = new Map<string, Listener[]>();
		return {
			addEventListener(type: string, listener: Listener) {
				listeners.set(type, [...(listeners.get(type) ?? []), listener]);
			},
			postMessage(message: { type: string; id?: number }) {
				if (message.type !== "session") return;
				queueMicrotask(() => {
					for (const listener of listeners.get("message") ?? [])
						listener({
							data: {
								id: message.id,
								outcome: { kind: "skipped", reason: "fake" },
								timings: {},
							},
						});
				});
			},
			terminate() {
				state.terminated = true;
			},
		} as unknown as Worker;
	};
	return { started, create };
}

const job = (bytes: number): SessionJob => ({
	sessionPath: "/s.jsonl",
	source: "claude_code",
	change: { kind: "whole", reason: "new", since: null },
	bytes,
});
const owner = { organizationId: "org", userId: "user" };

test("a worker without work for idleMs ends, and the next job starts a new one", async () => {
	const workers = fakeWorkers();
	const thread = new LocalIngestThread({
		idleMs: 20,
		createWorker: workers.create,
	});
	await thread.ingestSession(job(1), owner);
	await thread.ingestSession(job(1), owner);
	expect(workers.started).toHaveLength(1);
	await Bun.sleep(60);
	expect(workers.started[0]?.terminated).toBe(true);
	await thread.ingestSession(job(1), owner);
	expect(workers.started).toHaveLength(2);
	thread.close();
});

test("jobs adding up to recycleAfterTotalBytes end the worker, as one big job does", async () => {
	const workers = fakeWorkers();
	const thread = new LocalIngestThread({
		recycleAfterBytes: 100,
		recycleAfterTotalBytes: 150,
		createWorker: workers.create,
	});
	await thread.ingestSession(job(60), owner);
	await thread.ingestSession(job(60), owner);
	expect(workers.started[0]?.terminated).toBe(false);
	await thread.ingestSession(job(60), owner);
	expect(workers.started[0]?.terminated).toBe(true);
	await thread.ingestSession(job(100), owner);
	expect(workers.started[1]?.terminated).toBe(true);
	await thread.ingestSession(job(10), owner);
	expect(workers.started).toHaveLength(3);
	expect(workers.started[2]?.terminated).toBe(false);
	thread.close();
});
