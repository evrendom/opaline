import { describe, expect, test } from "bun:test";
import {
	type HistoricalSkillContentRow,
	type HistoricalSkillVersionUseRow,
	resolveHistoricalSkillVersions,
} from "./historical-skills.service.js";

describe("historical skill detail version guardrails", () => {
	test("caps newest-first versions at 10 and rejects missing or oversized content", () => {
		const versionRows = Array.from(
			{ length: 11 },
			(_, index): HistoricalSkillVersionUseRow => ({
				agent: index % 2 === 0 ? "claude" : "codex",
				content_sha256: String(index).padStart(64, "0"),
				first_used_at: "2026-08-01T00:00:00Z",
				last_used_at: new Date(
					Date.UTC(2026, 7, 20, 0, 0, 0) - index * 1_000,
				).toISOString(),
				session_count: 1,
			}),
		);
		const contentRows: HistoricalSkillContentRow[] = versionRows
			.slice(0, 10)
			.filter((_, index) => index !== 5)
			.map((row) => ({
				content:
					row === versionRows[7]
						? "🙂".repeat(128 * 1024)
						: `content-${row.content_sha256}`,
				content_sha256: row.content_sha256,
			}));

		const resolved = resolveHistoricalSkillVersions(versionRows, contentRows);

		expect(resolved.versions).toHaveLength(8);
		expect(resolved.unavailableSessionCount).toBe(2);
		expect(
			resolved.versions.every((version) =>
				contentRows.some(
					(content) => content.content_sha256 === version.contentSha256,
				),
			),
		).toBe(true);
		expect(
			resolved.versions.some(
				(version) => version.contentSha256 === versionRows[10]?.content_sha256,
			),
		).toBe(false);
	});
});
