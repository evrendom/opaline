import { describe, expect, test } from "bun:test";
import { getClickHouseSessionPurgePlans } from "../services/org-session.service.js";

/**
 * Raw transcripts, transcript records and the run index have no TTL: they are
 * kept until a deletion request (docs/l1-retention.md), so account and
 * workspace deletion is their only cleanup. This pins that every ClickHouse
 * table that holds an owner is purged, so a new table cannot be added
 * without deciding how it is deleted.
 */

interface Definition {
	readonly kind: string;
	readonly name: string;
	readonly columns?: readonly { readonly name: string }[];
}

const snapshot = (await Bun.file(
	new URL(
		"../../../../packages/ch-schema/chx/meta/snapshot.json",
		import.meta.url,
	),
).json()) as { definitions: readonly Definition[] };

const OWNER_COLUMNS = ["organization_id", "user_id", "workspace_id"] as const;
const owned = [
	...new Map(
		snapshot.definitions
			.filter((definition) => definition.kind === "table")
			.map((definition) => [definition.name, definition] as const),
	).values(),
].filter((definition) =>
	definition.columns?.some((column) =>
		(OWNER_COLUMNS as readonly string[]).includes(column.name),
	),
);

/** Tables that hold raw transcripts or data derived from them. */
const TRANSCRIPT_DERIVED = [
	"claude_sessions",
	"codex_sessions",
	"transcript_records",
	"transcript_chunks",
	"transcript_chunk_hits",
	"run_index",
	"run_requests",
	"call_facts",
	// Received setup: each run's setup file versions and the texts themselves.
	"run_setup",
	"setup_texts",
	"l1_edges",
	"l1_edges_by_target",
	"l1_edge_resolutions",
	"usage_events",
	"session_git_observations",
	"session_lineage",
	"session_language_signals",
	"session_analytics",
	"skill_receipts",
	"skill_uses",
	"skill_version_contents",
	"repository_session_evidence_index",
	// Background task outputs and large tool outputs, with the evidence index.
	"session_saved_outputs",
	// Screenshots and pasted images of a session, with the evidence index.
	"session_images",
	"session_context_snapshots",
	"weekly_totals",
	// Findings' cited runs with their measures, by the run's owner.
	"analysis_finding_runs",
	"session_inventory",
];
/** Workspace-scoped GitHub facts: deleted with the workspace, not with an account. */
const WORKSPACE_ONLY = [
	"github_pull_requests",
	"github_pull_request_details",
	"github_pull_request_commits",
	"github_ci_runs",
	"github_ci_run_pull_requests",
	"github_ci_jobs",
];

describe("ClickHouse deletion covers every owned table", () => {
	const organizationPlans = getClickHouseSessionPurgePlans("organization_id");
	const accountPlans = getClickHouseSessionPurgePlans("user_id");

	test("the snapshot lists the tables this test relies on", () => {
		const names = owned.map((definition) => definition.name);
		for (const name of [...TRANSCRIPT_DERIVED, ...WORKSPACE_ONLY])
			expect(names).toContain(name);
	});

	test("workspace deletion purges every table that has an owner column", () => {
		for (const definition of owned) {
			const column = definition.columns?.some(
				(candidate) => candidate.name === "workspace_id",
			)
				? "workspace_id"
				: "organization_id";
			expect(
				organizationPlans.some(
					(plan) =>
						plan.table === `rudel.${definition.name}` && plan.column === column,
				),
			).toBe(true);
		}
	});

	test("account deletion purges every table that names a user", () => {
		for (const definition of owned) {
			const named = definition.columns?.some(
				(candidate) => candidate.name === "user_id",
			);
			const plan = accountPlans.find(
				(candidate) => candidate.table === `rudel.${definition.name}`,
			);
			if (named) expect(plan?.column).toBe("user_id");
			else expect(plan).toBeUndefined();
		}
		for (const name of WORKSPACE_ONLY)
			expect(accountPlans.some((plan) => plan.table === `rudel.${name}`)).toBe(
				false,
			);
	});

	test("every transcript-derived table is purged both ways, under the owner it carries", () => {
		for (const name of TRANSCRIPT_DERIVED) {
			expect(
				organizationPlans.filter((plan) => plan.table === `rudel.${name}`),
			).toEqual([{ column: "organization_id", table: `rudel.${name}` }]);
			expect(
				accountPlans.filter((plan) => plan.table === `rudel.${name}`),
			).toEqual([{ column: "user_id", table: `rudel.${name}` }]);
		}
	});

	test("nothing is purged twice", () => {
		for (const plans of [organizationPlans, accountPlans])
			expect(new Set(plans.map((plan) => plan.table)).size).toBe(plans.length);
	});
});
