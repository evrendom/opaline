import { expect, test } from "bun:test";
import { createAnalyticsRequestGate } from "./analytics-request-gate.js";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("identical requests in flight share one run", async () => {
	const gate = createAnalyticsRequestGate({
		perScope: 2,
		total: 4,
		reuseMs: 0,
		maxEntries: 8,
	});
	const answer = deferred<string>();
	let runs = 0;
	const work = () => {
		runs++;
		return answer.promise;
	};

	const first = gate.run("org-1", "same", work);
	const second = gate.run("org-1", "same", work);
	await tick();
	answer.resolve("rows");

	expect(await Promise.all([first, second])).toEqual(["rows", "rows"]);
	expect(runs).toBe(1);
	expect(await gate.run("org-1", "same", async () => "fresh")).toBe("fresh");
});

test("a settled answer is reused only within reuseMs", async () => {
	let at = 0;
	const gate = createAnalyticsRequestGate({
		perScope: 1,
		total: 4,
		reuseMs: 30_000,
		maxEntries: 8,
		now: () => at,
	});

	expect(await gate.run("org-1", "org-1", async () => "first")).toBe("first");
	at = 29_999;
	expect(await gate.run("org-1", "org-1", async () => "second")).toBe("first");
	at = 30_000;
	expect(await gate.run("org-1", "org-1", async () => "third")).toBe("third");
});

test("a failed run is not reused", async () => {
	const gate = createAnalyticsRequestGate({
		perScope: 1,
		total: 4,
		reuseMs: 30_000,
		maxEntries: 8,
	});

	await expect(
		gate.run("org-1", "key", async () => {
			throw new Error("timeout");
		}),
	).rejects.toThrow("timeout");
	expect(await gate.run("org-1", "key", async () => "ok")).toBe("ok");
});

test("distinct requests wait for a slot of their workspace and of the instance", async () => {
	const gate = createAnalyticsRequestGate({
		perScope: 2,
		total: 3,
		reuseMs: 0,
		maxEntries: 8,
	});
	const started: string[] = [];
	const answers = new Map<string, ReturnType<typeof deferred<string>>>();
	const request = (scope: string, key: string) => {
		const answer = deferred<string>();
		answers.set(key, answer);
		return gate.run(scope, key, () => {
			started.push(key);
			return answer.promise;
		});
	};

	const runs = [
		request("org-1", "a"),
		request("org-1", "b"),
		request("org-1", "c"),
		request("org-2", "d"),
		request("org-2", "e"),
	];
	await tick();
	expect(started).toEqual(["a", "b", "d"]);

	answers.get("a")?.resolve("a");
	await tick();
	expect(started).toEqual(["a", "b", "d", "c"]);

	answers.get("d")?.resolve("d");
	await tick();
	expect(started).toEqual(["a", "b", "d", "c", "e"]);

	for (const key of ["b", "c", "e"]) answers.get(key)?.resolve(key);
	expect(await Promise.all(runs)).toEqual(["a", "b", "c", "d", "e"]);
});
