import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const maintenanceSource = readFileSync(
	resolve(import.meta.dir, "api-maintenance.ts"),
	"utf8",
);

describe("daily API maintenance", () => {
	test("wires revision-receipt cleanup into the bounded daily drain", () => {
		expect(maintenanceSource).toContain(
			"const SESSION_REVISION_RECEIPT_BUDGET_MS = 10_000",
		);
		expect(maintenanceSource).toContain(
			'runMaintenancePassLoop(\n\t\t"session-revision-receipts"',
		);
		expect(maintenanceSource).toContain(
			"() => runSessionRevisionReceiptCleanupPass()",
		);
	});

	test("repairs native lineage through a separately budgeted bounded drain", () => {
		expect(maintenanceSource).toContain(
			"const NATIVE_LINEAGE_BUDGET_MS = 10_000",
		);
		expect(maintenanceSource).toContain(
			'runMaintenancePassLoop(\n\t\t"native-session-lineage"',
		);
		expect(maintenanceSource).toContain(
			"runNativeMetadataDiscoveryPass(\n\t\t\t\tbatchSize",
		);
		expect(maintenanceSource).toContain(
			"repairNativeSessionLineagePass(\n\t\t\t\tbatchSize",
		);
		expect(maintenanceSource).toContain('nativeSessionLineage.status === "ok"');
	});
});
