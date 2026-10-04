import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const maintenanceSource = readFileSync(
	resolve(import.meta.dir, "api-maintenance.ts"),
	"utf8",
);

describe("daily API maintenance", () => {
	test("runs durable transcript retirement independently of publications under a maintenance deadline", () => {
		expect(maintenanceSource).toContain("runTranscriptRecordsRetirementPass({");
		expect(maintenanceSource).toContain(
			"TRANSCRIPT_RECORDS_RETIREMENT_BUDGET_MS = 10_000",
		);
		expect(maintenanceSource).toContain(
			'runMaintenanceStep("transcript-records"',
		);
		expect(maintenanceSource).toContain('transcriptRecords.status === "ok"');
	});
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

	test("repairs unfinished derived transcript data under its own budget", () => {
		expect(maintenanceSource).toContain(
			"DERIVED_RECORDS_RECONCILIATION_BUDGET_MS = 60_000",
		);
		expect(maintenanceSource).toContain('runMaintenanceStep("derived-records"');
		expect(maintenanceSource).toContain("assertNoClickHousePurgeTombstone");
		expect(maintenanceSource).toContain('derivedRecords.status === "ok"');
	});

	test("prunes coordination leases abandoned by crashed holders", () => {
		expect(maintenanceSource).toContain(
			"() => pruneExpiredPostgresLeases(sqlClient)",
		);
		expect(maintenanceSource).toContain('coordinationLeases.status === "ok"');
	});

	test("keeps native lineage out of heavyweight generic maintenance", () => {
		expect(maintenanceSource).not.toContain("runNativeMetadataDiscoveryPass");
		expect(maintenanceSource).not.toContain("repairNativeSessionLineagePass");
		expect(maintenanceSource).not.toContain("nativeSessionLineage");
	});
});
