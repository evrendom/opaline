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
			"TRANSCRIPT_RECORDS_RETIREMENT_BUDGET_MS = 60_000",
		);
		expect(maintenanceSource).toContain(
			'runMaintenanceStep("transcript-records"',
		);
		expect(maintenanceSource).toContain('transcriptRecords.status === "ok"');
	});
	test("expires stored sql results after their retention", () => {
		expect(maintenanceSource).toContain(
			'runMaintenanceStep("sql-results", () =>\n\t\texpireSqlResults(sqlClient),',
		);
		expect(maintenanceSource).toContain('sqlResults.status === "ok"');
	});
	test("retires superseded run index generations under their own budget", () => {
		expect(maintenanceSource).toContain("runRunIndexRetirementPass({");
		expect(maintenanceSource).toContain(
			"RUN_INDEX_RETIREMENT_BUDGET_MS = 10_000",
		);
		expect(maintenanceSource).toContain('runMaintenanceStep("run-index"');
		expect(maintenanceSource).toContain('runIndex.status === "ok"');
	});
	test("queues missing or stale run index builds from a daily census", () => {
		expect(maintenanceSource).toContain("requeueStaleRunIndexScopes({");
		expect(maintenanceSource).toContain("RUN_INDEX_CENSUS_BUDGET_MS = 30_000");
		expect(maintenanceSource).toContain(
			'runMaintenanceStep("run-index-census"',
		);
		expect(maintenanceSource).toContain('runIndexCensus.status === "ok"');
	});
	test("re-queues missing or stale edge builds from a daily census, never an upload path", () => {
		expect(maintenanceSource).toContain("requeueStaleL1EdgeScopes({");
		expect(maintenanceSource).toContain("L1_EDGE_CENSUS_BUDGET_MS = 30_000");
		expect(maintenanceSource).toContain('runMaintenanceStep("l1-edge-census"');
		expect(maintenanceSource).toContain('l1EdgeCensus.status === "ok"');
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
