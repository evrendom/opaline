import { expect, test } from "bun:test";
import { SessionDetailTurnSchema } from "@rudel/api-routes";
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
