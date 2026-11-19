import { describe, expect, test } from "bun:test";
import {
	decideProductionMigration,
	productionMigrationEnv,
} from "../../scripts/production-migration-gate.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "fedcba9876543210fedcba9876543210fedcba98";

describe("production migration gate", () => {
	test("migrates when no commit is confirmed", () => {
		expect(
			decideProductionMigration({
				clickHouseReachable: false,
				confirmedSha: undefined,
				deploySha: SHA,
			}),
		).toEqual({ action: "migrate" });
	});

	test("migrates whenever ClickHouse is reachable", () => {
		expect(
			decideProductionMigration({
				clickHouseReachable: true,
				confirmedSha: SHA,
				deploySha: SHA,
			}),
		).toEqual({ action: "migrate" });
	});

	test("skips only the exact confirmed commit while ClickHouse is unreachable", () => {
		expect(
			decideProductionMigration({
				clickHouseReachable: false,
				confirmedSha: SHA,
				deploySha: SHA,
			}).action,
		).toBe("skip");
		for (const [confirmedSha, deploySha] of [
			[OTHER, SHA],
			[SHA, undefined],
			[SHA.slice(0, 12), SHA.slice(0, 12)],
			[SHA.toUpperCase(), SHA.toUpperCase()],
		] as const) {
			expect(
				decideProductionMigration({
					clickHouseReachable: false,
					confirmedSha,
					deploySha,
				}).action,
			).toBe("migrate");
		}
	});
});

test("production forward migrations keep the cloud engines and s3 policy without probing", () => {
	expect(productionMigrationEnv({ CLICKHOUSE_URL: "https://ch" })).toEqual({
		CLICKHOUSE_URL: "https://ch",
		CLICKHOUSE_FLAVOR: "cloud",
	});
	expect(productionMigrationEnv({ CLICKHOUSE_FLAVOR: "auto" })).toEqual({
		CLICKHOUSE_FLAVOR: "auto",
	});
});
