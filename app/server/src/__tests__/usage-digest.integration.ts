import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import * as schema from "@rudel/sql-schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import { handleUsageDigestUnsubscribeRequest } from "../handlers/usage-digest-unsubscribe-http.js";
import { readUnsubscribeToken } from "../services/usage-digest/unsubscribe-token.js";
import {
	type DigestEmail,
	runUsageDigestPass,
	type UsageDigestConfig,
} from "../services/usage-digest/usage-digest.service.js";

const SECRET = "usage-digest-integration-secret-32-characters";
// Its own connection: files earlier in the integration run end the shared one.
const sqlClient = postgres(process.env.PG_CONNECTION_STRING ?? "", { max: 2 });
const database = drizzle(sqlClient, { schema });
const organizationIds: string[] = [];
const userIds: string[] = [];

afterAll(async () => {
	await sqlClient.end();
});

afterEach(async () => {
	if (organizationIds.length)
		await sqlClient`DELETE FROM organization WHERE id IN ${sqlClient(organizationIds)}`;
	if (userIds.length)
		await sqlClient`DELETE FROM "user" WHERE id IN ${sqlClient(userIds)}`;
	organizationIds.length = 0;
	userIds.length = 0;
});

async function createWorkspace(options: {
	ownSessionsOnly?: boolean;
	members: Array<{
		role: string;
		verified?: boolean;
		/** Last used Opaline before the digests' cut-off (2026-08-01). */
		inactive?: boolean;
		timeZone?: string;
	}>;
}): Promise<{ organizationId: string; userIds: string[] }> {
	const organizationId = `digest-org-${randomUUID()}`;
	organizationIds.push(organizationId);
	await sqlClient`
		INSERT INTO organization (id, name, slug, own_sessions_only)
		VALUES (${organizationId}, 'Digest Labs', ${`digest-${randomUUID().slice(0, 8)}`}, ${options.ownSessionsOnly ?? false})
	`;
	const ids: string[] = [];
	for (const member of options.members) {
		const userId = `digest-user-${randomUUID()}`;
		userIds.push(userId);
		ids.push(userId);
		await sqlClient`
			INSERT INTO "user" (id, name, email, email_verified, time_zone)
			VALUES (${userId}, 'Member', ${`${userId}@example.com`}, ${member.verified ?? true}, ${member.timeZone ?? null})
		`;
		const lastUsed = member.inactive
			? "2026-07-20T10:00:00Z"
			: "2026-10-01T10:00:00Z";
		await sqlClient`
			INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at)
			VALUES (${randomUUID()}, ${randomUUID()}, ${userId}, '2027-01-01T00:00:00Z', ${lastUsed}, ${lastUsed})
		`;
		await sqlClient`
			INSERT INTO member (id, organization_id, user_id, role)
			VALUES (${randomUUID()}, ${organizationId}, ${userId}, ${member.role})
		`;
	}
	return { organizationId, userIds: ids };
}

interface Activity {
	user: string;
	day: string;
	/** The UTC hour its sessions started; noon unless set. */
	hour?: number;
	sessions: number;
}

/** Answers the digest's two run index reads from each workspace's activity. */
function fakeClickhouse(
	activity: Record<string, Activity[]> = {},
): ClickHouseExecutor {
	return {
		async query<T>(statement: ClickHouseStatement): Promise<T[]> {
			const params = statement.query_params ?? {};
			const organizationId = String(params.organizationId ?? "");
			const within = (at: number, from: unknown, to: unknown) =>
				typeof from === "number" &&
				typeof to === "number" &&
				at >= from &&
				at < to;
			const rows = (activity[organizationId] ?? []).filter((row) => {
				const at = Date.parse(
					`${row.day}T${String(row.hour ?? 12).padStart(2, "0")}:00:00Z`,
				);
				return (
					within(at, params.from, params.to) ||
					within(at, params.previousFrom, params.previousTo)
				);
			});
			if (statement.query.includes("session_language_signals")) return [];
			if (statement.query.includes("ARRAY JOIN"))
				return rows.map((row) => ({
					user_id: row.user,
					kind: "command",
					name: "/review",
					uses: row.sessions,
				})) as T[];
			return rows.flatMap((row) =>
				Array.from({ length: row.sessions }, (_, index) => ({
					user_id: row.user,
					session_id: `${row.day}-${index}`,
					day: row.day,
					agent: "claude_code",
					repository: "github.com/acme/web",
					model: "claude-opus-5-5",
					runs: 3,
					prompts: 4,
					active_minutes: 20,
					cost_usd: 1.5,
					tool_calls: 50,
					failed_calls: 2,
					interrupts: 1,
					compactions: 0,
					api_errors_known_runs: 3,
					api_errors: 0,
					cache_read_tokens: 900,
					longest_run_minutes: 9,
					subagent_launches: 0,
					subagent_minutes: 0,
					subagent_runs: 0,
					subagent_cost_usd: 0,
					subagent_tool_calls: 0,
					subagent_failed_calls: 0,
					turn_errors: 0,
					timeouts: 0,
					refusals: 0,
					input_tokens: 1000,
				})),
			) as T[];
		},
		async execute() {},
		async insert() {},
		async close() {},
	};
}

function pass(
	clickhouse: ClickHouseExecutor,
	workspaceIds: string[],
	now: string,
): Promise<{
	emails: DigestEmail[];
	result: Awaited<ReturnType<typeof runUsageDigestPass>>;
}> {
	const emails: DigestEmail[] = [];
	const config: UsageDigestConfig = {
		enabled: true,
		organizationIds: new Set(workspaceIds),
		secret: SECRET,
		origin: "https://opaline.test",
		from: "Opaline <notifications@mail.opaline.test>",
	};
	return runUsageDigestPass({
		clickhouse,
		config,
		database,
		now: new Date(now),
		send: async (email) => {
			emails.push(email);
		},
	}).then((result) => ({ emails, result }));
}

const recipient = (email: DigestEmail) => email.to.replace("@example.com", "");

describe("usage digests", () => {
	test("the weekly digest reaches each active member who wants it once, with the team only where members may see it", async () => {
		const open = await createWorkspace({
			members: [{ role: "owner" }, { role: "member" }, { role: "member" }],
		});
		const [owner, teammate, optedOut] = open.userIds as [
			string,
			string,
			string,
		];
		await sqlClient`
			INSERT INTO usage_digest_preference (user_id, organization_id, weekly)
			VALUES (${optedOut}, ${open.organizationId}, false)
		`;
		const ownOnly = await createWorkspace({
			ownSessionsOnly: true,
			members: [
				{ role: "owner" },
				{ role: "member" },
				{ role: "member", verified: false },
			],
		});
		const [ownOnlyOwner, ownOnlyMember] = ownOnly.userIds as [
			string,
			string,
			string,
		];
		// A member who has not used Opaline since before August gets nothing.
		const stale = await createWorkspace({
			members: [{ role: "owner" }, { role: "member", inactive: true }],
		});
		const [staleOwner, staleMember] = stale.userIds as [string, string];
		const clickhouse = fakeClickhouse({
			[stale.organizationId]: [
				{ user: staleOwner, day: "2026-10-06", sessions: 1 },
				{ user: staleMember, day: "2026-10-06", sessions: 1 },
			],
			[open.organizationId]: [
				{ user: owner, day: "2026-10-06", sessions: 4 },
				{ user: teammate, day: "2026-10-07", sessions: 2 },
				{ user: owner, day: "2026-09-29", sessions: 2 },
			],
			[ownOnly.organizationId]: [
				{ user: ownOnlyOwner, day: "2026-10-06", sessions: 1 },
				{ user: ownOnlyMember, day: "2026-10-08", sessions: 3 },
			],
		});
		const workspaces = [
			open.organizationId,
			ownOnly.organizationId,
			stale.organizationId,
		];

		// No time zone known: 09:00 UTC.
		const first = await pass(clickhouse, workspaces, "2026-10-12T09:10:00Z");
		expect(first.emails.map(recipient).sort()).toEqual(
			[owner, teammate, ownOnlyOwner, ownOnlyMember, staleOwner].sort(),
		);
		const byRecipient = new Map(
			first.emails.map((email) => [recipient(email), email]),
		);
		expect(byRecipient.get(owner)?.text).toContain("Sessions: 4 (↑ 100%)");
		expect(byRecipient.get(owner)?.text).toContain("/review ×4");
		expect(byRecipient.get(teammate)?.text).toContain("Active members: 2");
		expect(byRecipient.get(ownOnlyOwner)?.text).toContain("Active members: 2");
		expect(byRecipient.get(ownOnlyMember)?.text).not.toContain(
			"Active members",
		);
		const unsubscribe = byRecipient.get(teammate)?.unsubscribeUrl ?? "";
		expect(
			readUnsubscribeToken(
				SECRET,
				new URL(unsubscribe).searchParams.get("token") ?? "",
			),
		).toEqual({
			kind: "weekly",
			userId: teammate,
			organizationId: open.organizationId,
		});

		const second = await pass(clickhouse, workspaces, "2026-10-12T10:10:00Z");
		expect(second.emails).toEqual([]);
		const rows = await sqlClient<
			{ status: string; outcome: string; recipients: number }[]
		>`
			SELECT status, outcome, recipients FROM usage_digest
			WHERE organization_id = ${open.organizationId} AND kind = 'weekly'
		`;
		expect([...rows]).toEqual([
			{ status: "done", outcome: "sent", recipients: 2 },
		]);
	});

	test("each member gets the weekly at 09:00 in their own time zone", async () => {
		const workspace = await createWorkspace({
			members: [
				{ role: "owner", timeZone: "Europe/Berlin" },
				{ role: "member", timeZone: "America/New_York" },
			],
		});
		const [berlin, newYork] = workspace.userIds as [string, string];
		const clickhouse = fakeClickhouse({
			[workspace.organizationId]: [
				{ user: berlin, day: "2026-10-06", sessions: 2 },
				{ user: newYork, day: "2026-10-07", sessions: 1 },
			],
		});
		const ids = [workspace.organizationId];
		const digest = () => sqlClient<{ status: string; recipients: number }[]>`
			SELECT status, recipients FROM usage_digest
			WHERE organization_id = ${workspace.organizationId} AND kind = 'weekly'
		`;

		// 09:00 in Berlin (UTC+2): Berlin only, and the digest stays open.
		const morning = await pass(clickhouse, ids, "2026-10-12T07:10:00Z");
		expect(morning.emails.map(recipient)).toEqual([berlin]);
		expect([...(await digest())]).toEqual([
			{ status: "pending", recipients: 1 },
		]);
		expect(
			(await pass(clickhouse, ids, "2026-10-12T12:10:00Z")).emails,
		).toEqual([]);
		// 09:00 in New York (UTC-4).
		const afternoon = await pass(clickhouse, ids, "2026-10-12T13:10:00Z");
		expect(afternoon.emails.map(recipient)).toEqual([newYork]);
		expect([...(await digest())]).toEqual([{ status: "done", recipients: 2 }]);
	});

	test("a quiet week sends one reminder, then nothing until sessions return", async () => {
		const workspace = await createWorkspace({ members: [{ role: "owner" }] });
		const clickhouse = fakeClickhouse();
		const first = await pass(
			clickhouse,
			[workspace.organizationId],
			"2026-10-12T09:10:00Z",
		);
		expect(first.emails.map((email) => email.subject)).toEqual([
			"No sessions reached Digest Labs last week",
		]);
		const next = await pass(
			clickhouse,
			[workspace.organizationId],
			"2026-10-19T09:10:00Z",
		);
		expect(next.emails).toEqual([]);
		expect(next.result.quiet).toBe(1);
	});

	test("the daily digest goes only to members who used their agents that day", async () => {
		const workspace = await createWorkspace({
			members: [{ role: "owner" }, { role: "member" }],
		});
		const [owner] = workspace.userIds as [string, string];
		const { emails } = await pass(
			fakeClickhouse({
				[workspace.organizationId]: [
					{ user: owner, day: "2026-10-13", sessions: 2 },
					// After 19:00: the next day's digest, not this one.
					{ user: owner, day: "2026-10-13", hour: 20, sessions: 5 },
				],
			}),
			[workspace.organizationId],
			"2026-10-13T19:10:00Z",
		);
		// The week before had no sessions, so that pass also sends the weekly
		// reminder to both members; the daily goes to the owner alone.
		const daily = emails.filter((email) =>
			email.subject.startsWith("Your Tuesday"),
		);
		expect(daily.map(recipient)).toEqual([owner]);
		expect(daily[0]?.subject).toBe("Your Tuesday in Digest Labs · Oct 13");
		expect(daily[0]?.text).toContain("Sessions: 2");
	});

	test("each member gets the daily at 19:00 on their own day, and not after their midnight", async () => {
		const workspace = await createWorkspace({
			members: [
				{ role: "owner", timeZone: "Europe/Berlin" },
				{ role: "member", timeZone: "America/New_York" },
				{ role: "member", timeZone: "Asia/Tokyo" },
			],
		});
		const [berlin, newYork, tokyo] = workspace.userIds as [
			string,
			string,
			string,
		];
		const clickhouse = fakeClickhouse({
			[workspace.organizationId]: [
				{ user: berlin, day: "2026-10-13", sessions: 2 },
				{ user: newYork, day: "2026-10-13", hour: 15, sessions: 1 },
				// 12:00 in Tokyo, whose Tuesday ended at 15:00 UTC.
				{ user: tokyo, day: "2026-10-13", hour: 3, sessions: 1 },
			],
		});
		const ids = [workspace.organizationId];
		const dailies = (emails: DigestEmail[]) =>
			emails.filter((email) => email.subject.startsWith("Your Tuesday"));
		const digest = () => sqlClient<{ status: string; recipients: number }[]>`
			SELECT status, recipients FROM usage_digest
			WHERE organization_id = ${workspace.organizationId} AND kind = 'daily'
				AND period_start = '2026-10-13'
		`;

		// 19:00 in Berlin (UTC+2). Tokyo's evening passed before the run.
		const berlinEvening = await pass(clickhouse, ids, "2026-10-13T17:10:00Z");
		expect(dailies(berlinEvening.emails).map(recipient)).toEqual([berlin]);
		expect(dailies(berlinEvening.emails)[0]?.text).toContain(
			"Active members: 3",
		);
		expect([...(await digest())]).toEqual([
			{ status: "pending", recipients: 1 },
		]);
		// 19:00 in New York (UTC-4).
		const newYorkEvening = await pass(clickhouse, ids, "2026-10-13T23:10:00Z");
		expect(dailies(newYorkEvening.emails).map(recipient)).toEqual([newYork]);
		expect([...(await digest())]).toEqual([{ status: "done", recipients: 2 }]);
		expect(
			dailies((await pass(clickhouse, ids, "2026-10-14T09:10:00Z")).emails),
		).toEqual([]);
	});

	test("the unsubscribe link asks first, and its POST turns that digest off", async () => {
		const workspace = await createWorkspace({ members: [{ role: "owner" }] });
		const [owner] = workspace.userIds as [string];
		const clickhouse = fakeClickhouse({
			[workspace.organizationId]: [
				{ user: owner, day: "2026-10-05", sessions: 1 },
			],
		});
		const { emails } = await pass(
			clickhouse,
			[workspace.organizationId],
			"2026-10-12T09:10:00Z",
		);
		const url = emails[0]?.unsubscribeUrl ?? "";
		const options = {
			secret: SECRET,
			settingsUrl: "https://opaline.test/settings/account",
			database,
		};
		const preference = () => sqlClient<{ weekly: boolean; daily: boolean }[]>`
			SELECT weekly, daily FROM usage_digest_preference
			WHERE user_id = ${owner} AND organization_id = ${workspace.organizationId}
		`;

		const confirm = await handleUsageDigestUnsubscribeRequest(
			new Request(url),
			options,
		);
		expect(confirm.status).toBe(200);
		expect(await confirm.text()).toContain('<form method="post">');
		expect([...(await preference())]).toEqual([]);

		const done = await handleUsageDigestUnsubscribeRequest(
			new Request(url, { method: "POST", body: "List-Unsubscribe=One-Click" }),
			options,
		);
		expect(done.status).toBe(200);
		expect([...(await preference())]).toEqual([{ weekly: false, daily: true }]);

		const forged = await handleUsageDigestUnsubscribeRequest(
			new Request(`${url}x`, { method: "POST" }),
			options,
		);
		expect(forged.status).toBe(400);
	});
});
