import { expect, test } from "bun:test";
import {
	BODY_PRIORITY,
	getBodySchedulerState,
	raiseBodyPriority,
	scheduleBodyRequest,
} from "./body-request-scheduler";

const tick = () => new Promise((done) => setTimeout(done, 0));

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test("caps requests in flight and starts a raised body's waiting ones first", async () => {
	const started: string[] = [];
	const gates: (() => void)[] = [];
	const signal = new AbortController().signal;
	const run = (key: string, label: string) =>
		scheduleBodyRequest(key, signal, () => {
			started.push(label);
			const gate = deferred();
			gates.push(gate.resolve);
			return gate.promise;
		});
	const all: Promise<void>[] = [];
	for (let index = 0; index < 8; index++)
		all.push(run("background", `background-${index}`));
	all.push(run("opened", "opened-0"));
	expect(started).toHaveLength(6);
	expect(getBodySchedulerState()).toEqual({ inFlight: 6, queued: 3 });
	raiseBodyPriority("opened", BODY_PRIORITY.urgent);
	expect(started.at(-1)).toBe("opened-0");
	gates[0]?.();
	gates[1]?.();
	await tick();
	expect(started).toContain("background-6");
	expect(started).not.toContain("background-7");
	for (let round = 0; round < 4; round++) {
		for (const gate of gates.splice(0)) gate();
		await tick();
	}
	await Promise.all(all);
	expect(getBodySchedulerState()).toEqual({ inFlight: 0, queued: 0 });
});

test("a waiting request whose signal aborts leaves the queue", async () => {
	const gates: (() => void)[] = [];
	const hold = new AbortController().signal;
	const holders = Array.from({ length: 6 }, () =>
		scheduleBodyRequest("holder", hold, () => {
			const gate = deferred();
			gates.push(gate.resolve);
			return gate.promise;
		}),
	);
	const controller = new AbortController();
	let ran = false;
	const waiting = scheduleBodyRequest("dropped", controller.signal, () => {
		ran = true;
		return Promise.resolve();
	});
	controller.abort();
	await expect(waiting).rejects.toBeDefined();
	for (const gate of gates) gate();
	await Promise.all(holders);
	expect(ran).toBe(false);
});
