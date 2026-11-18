import { describe, expect, test } from "bun:test";
import { createAnalysisLimiter } from "./concurrency.js";

const LIMITS = { perUser: 2, perProcess: 4, waitMs: 50 };

describe("analysis concurrency limiter", () => {
	test("caps one user at perUser and admits the waiter when a slot frees", async () => {
		const limiter = createAnalysisLimiter({ ...LIMITS, waitMs: 1_000 });
		const gate = Promise.withResolvers<void>();
		const started: string[] = [];
		const hold = (name: string) =>
			limiter.run(
				"alice",
				async () => {
					started.push(name);
					await gate.promise;
					return name;
				},
				undefined,
			);

		const calls = [hold("a"), hold("b"), hold("c")];
		await Promise.resolve();
		expect(started).toEqual(["a", "b"]);

		gate.resolve();
		expect(await Promise.all(calls)).toEqual(["a", "b", "c"]);
		expect(started).toEqual(["a", "b", "c"]);
	});

	test("fails a waiting call with a retryable per-user message", async () => {
		const limiter = createAnalysisLimiter(LIMITS);
		const gate = Promise.withResolvers<void>();
		const held = [1, 2].map(() =>
			limiter.run("alice", () => gate.promise, undefined),
		);

		await expect(
			limiter.run("alice", async () => "late", undefined),
		).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
			message:
				"2 analysis calls (find/read) are already running for you; wait for them to finish, then retry this call.",
		});
		expect(await limiter.run("bob", async () => "other user", undefined)).toBe(
			"other user",
		);

		gate.resolve();
		await Promise.all(held);
	});

	test("caps the process across users", async () => {
		const limiter = createAnalysisLimiter(LIMITS);
		const gate = Promise.withResolvers<void>();
		const held = ["a", "a", "b", "b"].map((user) =>
			limiter.run(user, () => gate.promise, undefined),
		);

		await expect(
			limiter.run("c", async () => "late", undefined),
		).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
			message:
				"Opaline is running too many analysis calls (find/read) right now; wait a few seconds, then retry this call.",
		});

		gate.resolve();
		await Promise.all(held);
		expect(await limiter.run("c", async () => "now", undefined)).toBe("now");
	});

	test("releases the slot when the call throws", async () => {
		const limiter = createAnalysisLimiter(LIMITS);
		const fail = () =>
			limiter.run(
				"alice",
				async () => {
					throw new Error("ClickHouse failed");
				},
				undefined,
			);

		await expect(fail()).rejects.toThrow("ClickHouse failed");
		await expect(fail()).rejects.toThrow("ClickHouse failed");
		expect(await limiter.run("alice", async () => "ok", undefined)).toBe("ok");
	});

	test("an aborted waiter leaves the queue without taking a slot", async () => {
		const limiter = createAnalysisLimiter({ ...LIMITS, waitMs: 1_000 });
		const gate = Promise.withResolvers<void>();
		const held = [1, 2].map(() =>
			limiter.run("alice", () => gate.promise, undefined),
		);
		const controller = new AbortController();
		const waiting = limiter.run(
			"alice",
			async () => "never",
			controller.signal,
		);

		controller.abort(new Error("client went away"));
		await expect(waiting).rejects.toThrow("client went away");

		gate.resolve();
		await Promise.all(held);
		let started = 0;
		const next = Promise.withResolvers<void>();
		const again = [1, 2].map(() =>
			limiter.run(
				"alice",
				async () => {
					started += 1;
					await next.promise;
				},
				undefined,
			),
		);
		await Promise.resolve();
		expect(started).toBe(2);
		next.resolve();
		await Promise.all(again);
	});
});
