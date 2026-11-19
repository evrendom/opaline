import { expect, test } from "bun:test";
import { marksActivity } from "./vercel-function-handler.js";

const request = (path: string, headers: Record<string, string> = {}) =>
	new Request(`https://opaline.so${path}`, { headers });

test("credentialed requests mark activity; anonymous ones do not", () => {
	expect(
		marksActivity("credentialed", request("/rpc/x", { Cookie: "s=1" })),
	).toBe(true);
	expect(
		marksActivity(
			"credentialed",
			request("/api/ingest", { Authorization: "Bearer k" }),
		),
	).toBe(true);
	expect(
		marksActivity("credentialed", request("/rpc/x", { "X-API-Key": "k" })),
	).toBe(true);
	expect(marksActivity("credentialed", request("/pricing"))).toBe(false);
});

test("health probes, crons and webhooks follow their own rule", () => {
	expect(
		marksActivity("credentialed", request("/health/ready", { Cookie: "s=1" })),
	).toBe(false);
	expect(marksActivity("always", request("/health"))).toBe(false);
	expect(
		marksActivity(
			"never",
			request("/api/cron/l1-edges", { Authorization: "Bearer cron" }),
		),
	).toBe(false);
	expect(marksActivity("always", request("/api/webhooks/github"))).toBe(true);
});
