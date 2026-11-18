import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	SESSION_DETAIL_BODY_CHUNK_CODE_UNITS,
	SessionDetailTurnSchema,
} from "@rudel/api-routes";
import { createSessionDetailBodyStore } from "../services/session-detail-body-store.js";

test("retains large turn bodies compactly and decodes only the requested turn", () => {
	const bodies = Array.from({ length: 4 }, (_, index) =>
		SessionDetailTurnSchema.parse({
			revision: "1",
			turnId: `turn-${index}`,
			userItems: [],
			responseItems: [
				{
					kind: "summary",
					id: `summary-${index}`,
					text: "Hello 🌍 ".repeat(30_000),
				},
			],
		}),
	);
	let decoded = 0;
	const store = createSessionDetailBodyStore(
		bodies.map((body) => [body.turnId, body]),
		(value) => {
			decoded += 1;
			return SessionDetailTurnSchema.parse(value);
		},
	);
	expect(store.byteSize).toBeLessThan(30_000);
	expect(decoded).toBe(0);
	expect(store.get("turn-2")).toEqual(bodies[2]);
	expect(decoded).toBe(1);
	expect(store.get("missing")).toBeUndefined();
	expect(decoded).toBe(1);
	expect([...store.values()]).toEqual(bodies);
	expect(new Map(store).size).toBe(4);
});

test("records the chunk total and checksum only for bodies longer than one chunk", () => {
	const turn = (turnId: string, text: string) =>
		SessionDetailTurnSchema.parse({
			revision: "1",
			turnId,
			userItems: [],
			responseItems: [{ kind: "summary", id: turnId, text }],
		});
	const small = turn("small", "short");
	const large = turn(
		"large",
		"🌍".repeat(SESSION_DETAIL_BODY_CHUNK_CODE_UNITS),
	);
	const store = createSessionDetailBodyStore(
		[
			["small", small],
			["large", large],
		],
		(value) => SessionDetailTurnSchema.parse(value),
	);
	const json = JSON.stringify(large);
	expect(store.chunks("small")).toBeUndefined();
	expect(store.chunks("large")).toEqual({
		sha256: createHash("sha256").update(json).digest("hex"),
		totalCodeUnits: json.length,
	});
	expect(store.serialized("large")).toEqual({
		json,
		sha256: store.chunks("large")?.sha256 ?? "",
	});
	expect(store.serialized("small")?.json).toBe(JSON.stringify(small));
	expect(store.serialized("missing")).toBeUndefined();
});
