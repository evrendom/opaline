import { describe, expect, test } from "bun:test";
import {
	REPOSITORY_EVIDENCE_PROTOCOL,
	RepositoryEvidenceInitInputSchema,
} from "@rudel/api-routes";
import { buildRepositoryEvidenceIndexRow } from "./repository-evidence-index.service.js";

const INDEXED_AT = new Date("2026-09-19T12:00:03.000Z");
const MANIFEST_HASH = "a".repeat(64);

describe("repository evidence index mapping", () => {
	test("maps available skills, instruction facets, plans, and partial coverage", () => {
		const row = buildRepositoryEvidenceIndexRow(
			makeEvidence(),
			makeManifest(),
			INDEXED_AT,
			"user-1",
		);

		expect(row.available_skills).toEqual([
			"clickhouse-best-practices",
			"testing-bun",
			"unknown-skill",
		]);
		// Retirement step 3: skill use is still validated but no longer stored.
		expect(row).not.toHaveProperty("skill_assessments");
		expect(row.context_facets).toEqual([
			[
				"agents-instructions",
				"repository",
				"present",
				"complete",
				"readable",
				1,
			],
			["claude-instructions", "repository", "absent", "complete", "unknown", 0],
			["plans", "repository", "unknown", "truncated", "truncated", 1],
		]);
		expect(row.coverage_status).toBe("partial");
		expect(row.user_id).toBe("user-1");
		expect(row.organization_id).toBe("organization-1");
		expect(row.repository_id).toBe("12345");
		expect(row.repository_provider).toBe("github");
		expect(row.repository_host).toBe("github.com");
		expect(row.repository_owner).toBe("opalinehq");
		expect(row.repository_name).toBe("athena");
		expect(row.worktree_id).toBe(`local-worktree:${"c".repeat(64)}`);
		expect(row.coverage_areas).toEqual([
			["git-state", "complete", ""],
			["available-skills", "partial", "User skill root was unavailable"],
		]);
		expect(row.capture_started_at).toBe("2026-09-19 12:00:00.000");
		expect(row.first_action_at).toBe("2026-09-19 12:00:01.000");
		expect(row.capture_completed_at).toBe("2026-09-19 12:00:02.000");
		expect(row.indexed_at).toBe("2026-09-19 12:00:03.000");
	});

	test.each([
		{
			name: "unknown facet enum",
			manifest: {
				...makeManifest(),
				contextIndex: {
					...makeManifest().contextIndex,
					facets: [
						{
							...makeManifest().contextIndex.facets[0],
							kind: "invented-instructions",
						},
					],
				},
			},
		},
		{
			name: "unknown skill discovery enum",
			manifest: {
				...makeManifest(),
				contextIndex: {
					...makeManifest().contextIndex,
					skills: [
						{
							...makeManifest().contextIndex.skills[0],
							discovery: "inferred",
						},
					],
				},
			},
		},
		{
			name: "unknown skill name source enum",
			manifest: {
				...makeManifest(),
				contextIndex: {
					...makeManifest().contextIndex,
					skills: [
						{
							...makeManifest().contextIndex.skills[0],
							nameSource: "manifest-label",
						},
					],
				},
			},
		},
		{
			name: "unknown skill-use reason",
			manifest: {
				...makeManifest(),
				contextIndex: {
					...makeManifest().contextIndex,
					skills: [
						{
							...makeManifest().contextIndex.skills[2],
							use: {
								evidenceScope: null,
								reason: "collector-guessed",
								status: "unknown",
							},
						},
					],
				},
			},
		},
		{
			name: "resource access with mismatched detail",
			manifest: {
				...makeManifest(),
				contextIndex: {
					...makeManifest().contextIndex,
					facets: [
						{
							...makeManifest().contextIndex.facets[0],
							resources: [
								{
									access: {
										reason: "read-error",
										status: "readable",
									},
									path: "AGENTS.md",
									rootId: "repository",
								},
							],
						},
					],
				},
			},
		},
	])("fails closed for $name", ({ manifest }) => {
		expect(() =>
			buildRepositoryEvidenceIndexRow(
				makeEvidence(),
				manifest,
				INDEXED_AT,
				"user-1",
			),
		).toThrow("Repository evidence");
	});
});

function makeEvidence() {
	return RepositoryEvidenceInitInputSchema.parse({
		capture: {
			baseGitCommit: null,
			contextId: "00000000-0000-4000-8000-000000000101",
			headGitCommit: null,
			parentContextId: null,
			timing: {
				captureCompletedAt: "2026-09-19T12:00:02.000Z",
				captureStartedAt: "2026-09-19T12:00:00.000Z",
				firstActionAt: "2026-09-19T12:00:01.000Z",
				firstActionBasis: "transcript-watermark",
				firstActionRelationship: "after-first-action",
				lifecycle: "checkpoint",
			},
			transcriptWatermark: {
				byteOffset: 128,
				eventOrdinal: 3,
				lastEventAt: "2026-09-19T12:00:01.000Z",
			},
		},
		coverage: [
			{ area: "git-state", reason: null, status: "complete" },
			{
				area: "available-skills",
				reason: "User skill root was unavailable",
				status: "partial",
			},
		],
		manifestObjectId: `sha256:${MANIFEST_HASH}`,
		objects: [
			{
				byteLength: 1,
				contentEncoding: "identity",
				filterVersion: 1,
				kind: "context-manifest",
				mediaType: "application/json",
				objectId: `sha256:${MANIFEST_HASH}`,
				sha256: MANIFEST_HASH,
			},
		],
		operationId: "00000000-0000-4000-8000-000000000102",
		organizationId: "organization-1",
		protocol: REPOSITORY_EVIDENCE_PROTOCOL,
		repository: {
			local: {
				installationId: "00000000-0000-4000-8000-000000000103",
				repositoryId: `local-repository:${"b".repeat(64)}`,
				worktreeId: `local-worktree:${"c".repeat(64)}`,
			},
			provider: {
				host: "github.com",
				name: "athena",
				nodeId: "R_athena",
				owner: "opalinehq",
				provider: "github",
				repositoryId: "12345",
			},
		},
		session: {
			agentId: "agent-1",
			parentAgentId: null,
			runId: "run-1",
			segmentId: "segment-1",
			sessionId: "session-1",
			source: "codex",
		},
	});
}

function makeManifest() {
	return {
		contextIndex: {
			facets: [
				{
					coverage: "complete",
					kind: "agents-instructions",
					presence: "present",
					resources: [
						{
							access: { status: "readable" },
							path: "AGENTS.md",
							rootId: "repository",
						},
					],
					rootId: "repository",
				},
				{
					coverage: "complete",
					kind: "claude-instructions",
					presence: "absent",
					resources: [],
					rootId: "repository",
				},
				{
					coverage: "truncated",
					kind: "plans",
					presence: "unknown",
					resources: [
						{
							access: {
								reason: "root-content-cap",
								status: "truncated",
							},
							path: "plans/current.md",
							rootId: "repository",
						},
					],
					rootId: "repository",
				},
			],
			skills: [
				{
					definitions: [
						{
							access: { status: "readable" },
							path: ".claude/skills/clickhouse-best-practices/SKILL.md",
							rootId: "repository",
						},
					],
					discovery: "present",
					name: "clickhouse-best-practices",
					nameSource: "definition-directory",
					use: {
						evidenceScope: { id: "session-1", kind: "session" },
						status: "observed-used",
					},
				},
				{
					definitions: [
						{
							access: {
								reason: "git-object",
								status: "reference-only",
							},
							path: ".claude/skills/testing-bun/SKILL.md",
							rootId: "repository",
						},
					],
					discovery: "present",
					name: "testing-bun",
					nameSource: "definition-directory",
					use: {
						evidenceScope: { id: "agent-1", kind: "agent" },
						status: "no-observed-use",
					},
				},
				{
					definitions: [
						{
							access: { reason: "read-error", status: "denied" },
							path: ".claude/skills/unknown-skill/SKILL.md",
							rootId: "repository",
						},
					],
					discovery: "present",
					name: "unknown-skill",
					nameSource: "definition-directory",
					use: {
						evidenceScope: { id: "run-1", kind: "run" },
						reason: "partial-evidence",
						status: "unknown",
					},
				},
			],
		},
	};
}
