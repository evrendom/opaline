import { describe, expect, test } from "bun:test";
import { parseServiceStatus } from "@/features/service-status/service-status";

describe("parseServiceStatus", () => {
	test("reports an analytics outage only when ClickHouse is unavailable", () => {
		expect(
			parseServiceStatus({
				status: "unavailable",
				dependencies: {
					postgres: { status: "ok" },
					clickhouse: { status: "unavailable" },
				},
			}),
		).toBe("analytics-unavailable");
	});

	test("is ok when ClickHouse is ok, even if another dependency fails", () => {
		expect(
			parseServiceStatus({
				status: "unavailable",
				dependencies: {
					postgres: { status: "unavailable" },
					clickhouse: { status: "ok" },
				},
			}),
		).toBe("ok");
	});

	test("stays unknown for unreadable reports", () => {
		for (const body of [
			null,
			"down",
			{},
			{ dependencies: null },
			{ dependencies: {} },
			{ dependencies: { clickhouse: { status: "degraded" } } },
		]) {
			expect(parseServiceStatus(body)).toBe("unknown");
		}
	});

	test("uses the read check when writes are slow but reads work", () => {
		expect(
			parseServiceStatus({
				status: "unavailable",
				dependencies: {
					postgres: { status: "ok" },
					clickhouse: { status: "unavailable" },
					clickhouse_read: { status: "ok" },
				},
			}),
		).toBe("ok");
		expect(
			parseServiceStatus({
				status: "unavailable",
				dependencies: {
					postgres: { status: "ok" },
					clickhouse: { status: "unavailable" },
					clickhouse_read: { status: "unavailable" },
				},
			}),
		).toBe("analytics-unavailable");
	});
});
