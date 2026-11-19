import { describe, expect, test } from "bun:test";
import {
	buildCanonicalRevisionDigestSql,
	type CanonicalSessionRevision,
	canonicalSessionRevisionDigest,
} from "../subagent-metrics-backfill.js";

const revision: CanonicalSessionRevision = {
	content: "héllo 🌍",
	filterVersion: 2,
	gitBranch: null,
	gitRemote: "https://github.com/rudel/rudel.git",
	gitSha: "",
	lastInteractionDateMs: 1_787_337_601_234,
	packageName: "rudel",
	packageType: "package.json",
	projectPath: "/workspace/rudel",
	sessionDateMs: 1_787_337_600_123,
	subagents: { "z-agent": "last", "ä-agent": "multibyte" },
	tag: undefined,
};

describe("canonical session revision digest", () => {
	test("is stable across map insertion order and emits lowercase SHA-256", () => {
		const reversed = {
			...revision,
			subagents: { "ä-agent": "multibyte", "z-agent": "last" },
		};
		const digest = canonicalSessionRevisionDigest(revision);

		expect(digest).toBe(canonicalSessionRevisionDigest(reversed));
		expect(digest).toBe(
			"2e28b1f9eb6d3723daa351c7dbea0754a40bbf8b5b2a64c7195d45a0a121674a",
		);
		expect(digest).toMatch(/^[0-9a-f]{64}$/u);
	});

	test("distinguishes nullable absence from an empty value", () => {
		expect(canonicalSessionRevisionDigest(revision)).not.toBe(
			canonicalSessionRevisionDigest({ ...revision, gitBranch: "" }),
		);
	});

	test("builds byte-length, millisecond-normalized ClickHouse parity SQL", () => {
		const sql = buildCanonicalRevisionDigestSql("cs", true);

		expect(sql).toContain("length(toString(cs.content))");
		expect(sql).toContain("toUnixTimestamp64Milli(cs.session_date)");
		expect(sql).toContain("arraySort(entry -> tupleElement(entry, 1)");
		expect(sql).toStartWith("lower(hex(SHA256(concat(");
	});
});
