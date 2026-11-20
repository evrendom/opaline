import { expect, test } from "bun:test";
import {
	MaintenanceJobThread,
	OFF_THREAD_JOBS,
} from "./maintenance-job-thread.js";

type Listener = (event: { data: unknown }) => void;

/** A worker that answers each job after `delayMs` (never when null) and counts how often it is ended. */
function fakeWorkers(delayMs: number | null) {
	const started: { terminated: boolean; jobs: string[] }[] = [];
	const create = () => {
		const state = { terminated: false, jobs: [] as string[] };
		started.push(state);
		const listeners = new Map<string, Listener[]>();
		return {
			addEventListener(type: string, listener: Listener) {
				listeners.set(type, [...(listeners.get(type) ?? []), listener]);
			},
			postMessage(message: {
				id: number;
				name: string;
				authorization: string;
			}) {
				state.jobs.push(`${message.name} ${message.authorization}`);
				if (delayMs === null) return;
				setTimeout(() => {
					if (state.terminated) return;
					for (const listener of listeners.get("message") ?? [])
						listener({
							data: {
								id: message.id,
								status: 200,
								body: JSON.stringify({ ok: true, job: message.name }),
							},
						});
				}, delayMs);
			},
			terminate() {
				state.terminated = true;
			},
		} as unknown as Worker;
	};
	return { started, create };
}

const request = (name: string) =>
	new Request(`http://selfhost.internal/api/cron/${name}`, {
		headers: { Authorization: "Bearer secret" },
	});

test("the jobs that can hold the CPU for minutes are the ones run off the main thread", () => {
	expect(Object.keys(OFF_THREAD_JOBS).sort()).toEqual([
		"l1-edges",
		"run-index-heal",
	]);
});

test("a job runs on the worker with the request's authorization and returns its answer; one worker serves several jobs", async () => {
	const workers = fakeWorkers(5);
	const thread = new MaintenanceJobThread({ createWorker: workers.create });
	const [first, second] = await Promise.all([
		thread.run("l1-edges", request("l1-edges")),
		thread.run("run-index-heal", request("run-index-heal")),
	]);
	expect(first.status).toBe(200);
	expect(JSON.parse(first.body)).toEqual({ ok: true, job: "l1-edges" });
	expect(JSON.parse(second.body)).toEqual({ ok: true, job: "run-index-heal" });
	expect(workers.started).toHaveLength(1);
	expect(workers.started[0]?.jobs).toEqual([
		"l1-edges Bearer secret",
		"run-index-heal Bearer secret",
	]);
	thread.close();
});

test("a job that does not finish in time ends its worker and answers 504; the next job gets a new worker", async () => {
	const workers = fakeWorkers(null);
	const thread = new MaintenanceJobThread({
		createWorker: workers.create,
		timeoutMs: 30,
	});
	const answer = await thread.run("l1-edges", request("l1-edges"));
	expect(answer.status).toBe(504);
	expect(workers.started[0]?.terminated).toBe(true);
	expect(thread.inFlight).toBe(0);
	void thread.run("l1-edges", request("l1-edges"));
	expect(workers.started).toHaveLength(2);
	thread.close();
});

test("the worker ends after idleMs without a job", async () => {
	const workers = fakeWorkers(1);
	const thread = new MaintenanceJobThread({
		createWorker: workers.create,
		idleMs: 20,
	});
	await thread.run("l1-edges", request("l1-edges"));
	expect(workers.started[0]?.terminated).toBe(false);
	await Bun.sleep(60);
	expect(workers.started[0]?.terminated).toBe(true);
	thread.close();
});

test("closing answers a running job at once, so stopping the server does not wait for it", async () => {
	const workers = fakeWorkers(null);
	const thread = new MaintenanceJobThread({ createWorker: workers.create });
	const running = thread.run("l1-edges", request("l1-edges"));
	thread.close();
	expect((await running).status).toBe(503);
	expect(workers.started[0]?.terminated).toBe(true);
});
