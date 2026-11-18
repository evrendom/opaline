import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { handleNativeSessionLineageMaintenanceRequest } from "./native-session-lineage-maintenance.js";

const nativeMaintenanceSource = readFileSync(
	resolve(import.meta.dir, "native-session-lineage-maintenance.ts"),
	"utf8",
);

describe("native session lineage maintenance", () => {
	test("rejects requests without the cron secret before running maintenance", async () => {
		const response = await handleNativeSessionLineageMaintenanceRequest(
			new Request("https://example.test/api/cron/native-lineage"),
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Unauthorized" });
	});

	test("owns a bounded native-only maintenance drain", () => {
		expect(nativeMaintenanceSource).toContain(
			"const INVOCATION_BUDGET_MS = 50_000",
		);
		expect(nativeMaintenanceSource).toContain(
			"const NATIVE_LINEAGE_BUDGET_MS = 45_000",
		);
		expect(nativeMaintenanceSource).toContain("const MAX_BATCH_SIZE = 25");
		expect(nativeMaintenanceSource).toContain("const MAX_PASSES = 50");
		expect(nativeMaintenanceSource).toContain(
			'import("../services/session-native-metadata-discovery.service.js")',
		);
		expect(nativeMaintenanceSource).toContain(
			'import("../services/session-native-lineage.service.js")',
		);
		expect(nativeMaintenanceSource).not.toContain("api-maintenance");
		expect(nativeMaintenanceSource).not.toContain("r2-ingest");
		expect(nativeMaintenanceSource).not.toContain("clickhouse-purge");
	});
});
