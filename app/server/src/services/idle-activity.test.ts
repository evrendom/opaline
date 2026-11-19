import { beforeEach, describe, expect, test } from "bun:test";
import {
	ACTIVITY_OBJECT_KEY,
	type ActivityStore,
	cronGate,
	decideCronGate,
	idleCronResponse,
	markActivity,
	r2ActivityStore,
	resetActivityMarkThrottle,
} from "./idle-activity.js";

const at = (iso: string) => new Date(iso);

function memoryStore(initial: Date | null = null) {
	const state = { at: initial, reads: 0, writes: 0, failRead: false };
	const store: ActivityStore = {
		async read() {
			state.reads += 1;
			if (state.failRead) throw new Error("r2 down");
			return state.at;
		},
		async write(date) {
			state.writes += 1;
			state.at = date;
		},
	};
	return { state, store };
}

describe("decideCronGate", () => {
	test("runs within 30 minutes of the last activity", () => {
		expect(
			decideCronGate(at("2026-11-02T03:29:00Z"), at("2026-11-02T03:00:00Z")),
		).toEqual({ run: true, reason: "active" });
	});

	test("skips once the last activity is 30 minutes old", () => {
		expect(
			decideCronGate(at("2026-11-02T03:30:00Z"), at("2026-11-02T03:00:00Z")),
		).toEqual({ run: false, lastActivityAt: "2026-11-02T03:00:00.000Z" });
	});

	test("runs at the hourly sweep minute however old the activity is", () => {
		expect(
			decideCronGate(at("2026-11-02T03:10:00Z"), at("2026-10-01T00:00:00Z")),
		).toEqual({ run: true, reason: "sweep" });
	});

	test("runs when no activity was ever recorded", () => {
		expect(decideCronGate(at("2026-11-02T03:30:00Z"), null)).toEqual({
			run: true,
			reason: "unknown",
		});
	});
});

describe("cronGate", () => {
	test("does not read the marker at the sweep minute", async () => {
		const { state, store } = memoryStore(at("2026-10-01T00:00:00Z"));
		expect(await cronGate(at("2026-11-02T04:10:30Z"), store)).toEqual({
			run: true,
			reason: "sweep",
		});
		expect(state.reads).toBe(0);
	});

	test("runs when the marker cannot be read", async () => {
		const { state, store } = memoryStore(at("2026-10-01T00:00:00Z"));
		state.failRead = true;
		expect(await cronGate(at("2026-11-02T04:30:00Z"), store)).toEqual({
			run: true,
			reason: "unknown",
		});
	});

	test("runs without a configured store", async () => {
		expect((await cronGate(at("2026-11-02T04:30:00Z"), null)).run).toBe(true);
	});
});

test("idleCronResponse answers only skipped gates", async () => {
	expect(idleCronResponse({ run: true, reason: "active" })).toBeNull();
	const response = idleCronResponse({
		run: false,
		lastActivityAt: "2026-11-02T03:00:00.000Z",
	});
	expect(response?.status).toBe(200);
	expect(await response?.json()).toEqual({
		ok: true,
		skipped: "idle",
		lastActivityAt: "2026-11-02T03:00:00.000Z",
	});
});

describe("markActivity", () => {
	beforeEach(() => resetActivityMarkThrottle());

	test("writes at most once a minute per instance", async () => {
		const { state, store } = memoryStore();
		await markActivity(at("2026-11-02T03:00:00Z"), store);
		expect(markActivity(at("2026-11-02T03:00:59Z"), store)).toBeNull();
		await markActivity(at("2026-11-02T03:01:00Z"), store);
		expect(state.writes).toBe(2);
		expect(state.at).toEqual(at("2026-11-02T03:01:00Z"));
	});

	test("retries on the next request after a failed write", async () => {
		let attempts = 0;
		const store: ActivityStore = {
			read: async () => null,
			write: async () => {
				attempts += 1;
				if (attempts === 1) throw new Error("r2 down");
			},
		};
		await markActivity(at("2026-11-02T03:00:00Z"), store);
		await markActivity(at("2026-11-02T03:00:10Z"), store);
		expect(attempts).toBe(2);
	});

	test("does nothing without a configured store", () => {
		expect(markActivity(at("2026-11-02T03:00:00Z"), null)).toBeNull();
	});
});

describe("r2ActivityStore", () => {
	test("keeps the time in the marker object's metadata", async () => {
		const objects = new Map<string, Record<string, string>>();
		const store = r2ActivityStore({
			async headObject(key) {
				const metadata = objects.get(key);
				return metadata ? { byteLength: 0, metadata } : null;
			},
			async putObject(input) {
				objects.set(input.objectKey, { ...input.metadata });
			},
		});
		expect(await store.read()).toBeNull();
		await store.write(at("2026-11-02T03:00:00Z"));
		expect(objects.get(ACTIVITY_OBJECT_KEY)).toEqual({
			at: "2026-11-02T03:00:00.000Z",
		});
		expect(await store.read()).toEqual(at("2026-11-02T03:00:00Z"));
	});

	test("reads an unparseable time as no activity", async () => {
		const store = r2ActivityStore({
			headObject: async () => ({ byteLength: 0, metadata: { at: "soon" } }),
			putObject: async () => {},
		});
		expect(await store.read()).toBeNull();
	});
});
