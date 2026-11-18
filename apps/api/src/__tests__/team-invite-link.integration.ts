import { afterEach, describe, expect, test } from "bun:test";
import assert from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { createAuth } from "../auth.js";
import { db, sqlClient } from "../db.js";
import {
	acceptTeamInviteLink,
	createTeamInviteLink,
	revokeTeamInviteLink,
} from "../services/team-invite-link.service.js";

interface TeamInviteFixture {
	candidateId: string;
	memberId: string;
	organizationId: string;
	ownerId: string;
	secondCandidateId: string;
}

const CONCURRENT_ACCEPTANCE_COUNT = 10;
const organizationIds: string[] = [];
const userIds: string[] = [];
const testAuth = createAuth(db, {
	appURL: "http://localhost:4010",
	attio: undefined,
	frontendURL: "http://localhost:4011",
	secret: "team-invite-integration-secret-at-least-32-characters",
});

afterEach(async () => {
	for (const organizationId of organizationIds) {
		await sqlClient`
			DELETE FROM organization
			WHERE id = ${organizationId}
		`;
	}
	for (const userId of userIds) {
		await sqlClient`
			DELETE FROM "user"
			WHERE id = ${userId}
		`;
	}
	organizationIds.length = 0;
	userIds.length = 0;
});

describe("team invite links", () => {
	test("stores a random token hash and invalidates the previous link on rotation", async () => {
		const fixture = await createTeamInviteFixture();
		const firstLink = await createTeamInviteLink({
			organizationId: fixture.organizationId,
			userId: fixture.ownerId,
		});
		assert(firstLink);

		const [storedInvite] = await sqlClient<
			Array<{
				creatorId: string;
				expiresAt: string;
				tokenHash: string;
			}>
		>`
			SELECT
				creator_id AS "creatorId",
				expires_at AS "expiresAt",
				token_hash AS "tokenHash"
			FROM team_invite_link
			WHERE organization_id = ${fixture.organizationId}
				AND revoked_at IS NULL
		`;
		assert(storedInvite);
		expect(storedInvite.creatorId).toBe(fixture.ownerId);
		expect(storedInvite.tokenHash).toBe(hashToken(firstLink.token));
		expect(storedInvite.tokenHash).not.toContain(firstLink.token);
		expect(Date.parse(storedInvite.expiresAt)).toBeGreaterThan(Date.now());

		const secondLink = await createTeamInviteLink({
			organizationId: fixture.organizationId,
			userId: fixture.ownerId,
		});
		assert(secondLink);
		expect(secondLink.token).not.toBe(firstLink.token);
		expect(
			await acceptTeamInviteLink({
				token: firstLink.token,
				userId: fixture.candidateId,
			}),
		).toEqual({ status: "missing" });

		const accepted = await acceptTeamInviteLink({
			token: secondLink.token,
			userId: fixture.candidateId,
		});
		expect(accepted).toEqual({
			organizationId: fixture.organizationId,
			organizationName: "Invite Test Organization",
			status: "joined",
		});
		expect(
			await acceptTeamInviteLink({
				token: secondLink.token,
				userId: fixture.candidateId,
			}),
		).toEqual({
			organizationId: fixture.organizationId,
			organizationName: "Invite Test Organization",
			status: "already_member",
		});
	});

	test("rejects an expired invite link", async () => {
		const fixture = await createTeamInviteFixture();
		const link = await createTeamInviteLink({
			organizationId: fixture.organizationId,
			userId: fixture.ownerId,
		});
		assert(link);

		await sqlClient`
			UPDATE team_invite_link
			SET expires_at = ${new Date(Date.now() - 1_000).toISOString()}
			WHERE organization_id = ${fixture.organizationId}
				AND revoked_at IS NULL
		`;

		expect(
			await acceptTeamInviteLink({
				token: link.token,
				userId: fixture.candidateId,
			}),
		).toEqual({ status: "missing" });
	});

	test("allows an owner to revoke a link and rejects revocation by a member", async () => {
		const fixture = await createTeamInviteFixture({ includeMember: true });
		const link = await createTeamInviteLink({
			organizationId: fixture.organizationId,
			userId: fixture.ownerId,
		});
		assert(link);

		expect(
			await revokeTeamInviteLink({
				organizationId: fixture.organizationId,
				userId: fixture.memberId,
			}),
		).toBe(false);
		expect(
			await revokeTeamInviteLink({
				organizationId: fixture.organizationId,
				userId: fixture.ownerId,
			}),
		).toBe(true);
		expect(
			await acceptTeamInviteLink({
				token: link.token,
				userId: fixture.candidateId,
			}),
		).toEqual({ status: "missing" });
	});

	test("lets a free workspace grow past three members", async () => {
		const fixture = await createTeamInviteFixture({ includeMember: true });
		const link = await createTeamInviteLink({
			organizationId: fixture.organizationId,
			userId: fixture.ownerId,
		});
		assert(link);

		expect(
			await acceptTeamInviteLink({
				token: link.token,
				userId: fixture.candidateId,
			}),
		).toMatchObject({ status: "joined" });
		expect(
			await acceptTeamInviteLink({
				token: link.token,
				userId: fixture.secondCandidateId,
			}),
		).toMatchObject({ status: "joined" });
		expect(
			await countMemberships(fixture.organizationId, fixture.secondCandidateId),
		).toBe(1);
	});

	test("marks a teammate who joins a paid workspace as paid", async () => {
		const fixture = await createTeamInviteFixture();
		await sqlClient`
			INSERT INTO billing_subscription (
				stripe_subscription_id, organization_id, purchaser_user_id,
				stripe_customer_id, stripe_subscription_item_id, plan,
				billing_period, status, seat_quantity, last_paid_amount,
				last_paid_currency, last_paid_at
			) VALUES (
				${`sub_${randomUUID()}`}, ${fixture.organizationId}, ${fixture.ownerId},
				${`cus_${randomUUID()}`}, ${`si_${randomUUID()}`}, 'business',
				'yearly', 'active', 2, 100800, 'usd', NOW()
			)
		`;
		const link = await createTeamInviteLink({
			organizationId: fixture.organizationId,
			userId: fixture.ownerId,
		});
		assert(link);

		expect(
			await acceptTeamInviteLink({
				token: link.token,
				userId: fixture.candidateId,
			}),
		).toMatchObject({ status: "joined" });

		const [traits] = await sqlClient<
			Array<{ properties: Record<string, boolean | number | string | null> }>
		>`
			SELECT properties
			FROM billing_analytics_outbox
			WHERE kind = 'traits' AND user_id = ${fixture.candidateId}
			ORDER BY occurred_at DESC, id DESC
			LIMIT 1
		`;
		assert(traits);
		expect(traits.properties).toMatchObject({
			billing_last_payment_amount: 100800,
			billing_last_payment_currency: "usd",
			billing_period: "yearly",
			billing_plan: "business",
			billing_seat_quantity: 2,
			billing_subscription_type: "business_yearly",
			has_paid_workspace: true,
			payment_status: "paid",
			was_invited_to_team: true,
		});
	});

	test("removing a teammate clears inherited paid workspace traits", async () => {
		const fixture = await createTeamInviteFixture();
		await insertPaidSubscription(fixture);
		const link = await createTeamInviteLink({
			organizationId: fixture.organizationId,
			userId: fixture.ownerId,
		});
		assert(link);
		await acceptTeamInviteLink({
			token: link.token,
			userId: fixture.candidateId,
		});
		const [member] = await sqlClient<Array<{ id: string }>>`
			SELECT id FROM member
			WHERE organization_id = ${fixture.organizationId}
				AND user_id = ${fixture.candidateId}
		`;
		assert(member);
		const sessionToken = randomUUID();
		await sqlClient`
			INSERT INTO session (
				id, token, user_id, expires_at, active_organization_id
			) VALUES (
				${randomUUID()}, ${sessionToken}, ${fixture.ownerId},
				${new Date(Date.now() + 60_000).toISOString()},
				${fixture.organizationId}
			)
		`;

		await testAuth.api.removeMember({
			body: {
				memberIdOrEmail: member.id,
				organizationId: fixture.organizationId,
			},
			headers: new Headers({ authorization: `Bearer ${sessionToken}` }),
		});

		expect(
			await countMemberships(fixture.organizationId, fixture.candidateId),
		).toBe(0);
		const traits = await readLatestBillingTraits(fixture.candidateId);
		expect(traits).toMatchObject({
			billing_last_payment_amount: null,
			billing_period: "none",
			billing_plan: "free",
			billing_seat_quantity: 0,
			billing_subscription_type: "free",
			has_paid_workspace: false,
			payment_status: "free",
			was_invited_to_team: false,
		});
	});

	test("accepts the same invite concurrently without duplicate membership", async () => {
		const fixture = await createTeamInviteFixture();
		const link = await createTeamInviteLink({
			organizationId: fixture.organizationId,
			userId: fixture.ownerId,
		});
		assert(link);

		const acceptInvite = () =>
			acceptTeamInviteLink({
				token: link.token,
				userId: fixture.candidateId,
			});
		const acceptances = await Promise.all(
			Array.from({ length: CONCURRENT_ACCEPTANCE_COUNT }, acceptInvite),
		);

		expect(
			acceptances.filter(({ status }) => status === "joined"),
		).toHaveLength(1);
		expect(
			acceptances.filter(({ status }) => status === "already_member"),
		).toHaveLength(CONCURRENT_ACCEPTANCE_COUNT - 1);
		expect(
			await countMemberships(fixture.organizationId, fixture.candidateId),
		).toBe(1);
	});

	test("avoids the acceptance and revocation lock cycle", async () => {
		const fixture = await createTeamInviteFixture();
		const link = await createTeamInviteLink({
			organizationId: fixture.organizationId,
			userId: fixture.ownerId,
		});
		assert(link);

		const lockClient = createPostgresClient();
		let revocation: Promise<boolean> | undefined;
		await lockClient.begin(async (transaction) => {
			await transaction.unsafe(
				`
				SELECT id
				FROM team_invite_link
				WHERE token_hash = $1
				FOR UPDATE
				`,
				[hashToken(link.token)],
			);

			revocation = revokeTeamInviteLink({
				organizationId: fixture.organizationId,
				userId: fixture.ownerId,
			});
			await waitForBlockedInviteUpdate();

			await transaction.unsafe(
				`
				INSERT INTO member (id, organization_id, user_id, role)
				VALUES ($1, $2, $3, 'member')
				`,
				[randomUUID(), fixture.organizationId, fixture.candidateId],
			);
		});

		assert(revocation);
		expect(await revocation).toBe(true);
		await lockClient.end();
		expect(
			await countMemberships(fixture.organizationId, fixture.candidateId),
		).toBe(1);
	});

	test("accepts or rejects the old link cleanly during rotation", async () => {
		const fixture = await createTeamInviteFixture();
		const oldLink = await createTeamInviteLink({
			organizationId: fixture.organizationId,
			userId: fixture.ownerId,
		});
		assert(oldLink);

		const [oldLinkAcceptance, newLink] = await Promise.all([
			acceptTeamInviteLink({
				token: oldLink.token,
				userId: fixture.candidateId,
			}),
			createTeamInviteLink({
				organizationId: fixture.organizationId,
				userId: fixture.ownerId,
			}),
		]);
		assert(newLink);

		expect(["joined", "missing"]).toContain(oldLinkAcceptance.status);
		expect(
			await acceptTeamInviteLink({
				token: oldLink.token,
				userId: fixture.secondCandidateId,
			}),
		).toEqual({ status: "missing" });
		expect(
			await acceptTeamInviteLink({
				token: newLink.token,
				userId: fixture.secondCandidateId,
			}),
		).toEqual({
			organizationId: fixture.organizationId,
			organizationName: "Invite Test Organization",
			status: "joined",
		});
		expect(await countActiveInvites(fixture.organizationId)).toBe(1);
	});

	test("accepts or rejects a link cleanly during revocation", async () => {
		const fixture = await createTeamInviteFixture();
		const link = await createTeamInviteLink({
			organizationId: fixture.organizationId,
			userId: fixture.ownerId,
		});
		assert(link);

		const [acceptance, revoked] = await Promise.all([
			acceptTeamInviteLink({
				token: link.token,
				userId: fixture.candidateId,
			}),
			revokeTeamInviteLink({
				organizationId: fixture.organizationId,
				userId: fixture.ownerId,
			}),
		]);

		expect(revoked).toBe(true);
		expect(["joined", "missing"]).toContain(acceptance.status);
		expect(
			await acceptTeamInviteLink({
				token: link.token,
				userId: fixture.secondCandidateId,
			}),
		).toEqual({ status: "missing" });
		expect(
			await countMemberships(fixture.organizationId, fixture.candidateId),
		).toBe(acceptance.status === "joined" ? 1 : 0);
	});

	test("keeps exactly one active link after concurrent creation", async () => {
		const fixture = await createTeamInviteFixture();
		const [firstLink, secondLink] = await Promise.all([
			createTeamInviteLink({
				organizationId: fixture.organizationId,
				userId: fixture.ownerId,
			}),
			createTeamInviteLink({
				organizationId: fixture.organizationId,
				userId: fixture.ownerId,
			}),
		]);
		assert(firstLink);
		assert(secondLink);

		const links = [firstLink, secondLink];
		const activeTokenHash = await getActiveTokenHash(fixture.organizationId);
		const activeLink = links.find(
			(link) => hashToken(link.token) === activeTokenHash,
		);
		const inactiveLink = links.find(
			(link) => hashToken(link.token) !== activeTokenHash,
		);
		assert(activeLink);
		assert(inactiveLink);

		expect(await countActiveInvites(fixture.organizationId)).toBe(1);
		expect(
			await acceptTeamInviteLink({
				token: inactiveLink.token,
				userId: fixture.candidateId,
			}),
		).toEqual({ status: "missing" });
		expect(
			await acceptTeamInviteLink({
				token: activeLink.token,
				userId: fixture.candidateId,
			}),
		).toEqual({
			organizationId: fixture.organizationId,
			organizationName: "Invite Test Organization",
			status: "joined",
		});
	});
});

async function createTeamInviteFixture(
	options: { includeMember?: boolean } = {},
): Promise<TeamInviteFixture> {
	const ownerId = randomUUID();
	const candidateId = randomUUID();
	const memberId = randomUUID();
	const organizationId = randomUUID();
	const secondCandidateId = randomUUID();
	const uniqueSuffix = randomUUID();
	userIds.push(ownerId, candidateId, memberId, secondCandidateId);
	organizationIds.push(organizationId);

	await sqlClient`
		INSERT INTO "user" (id, name, email)
		VALUES
			(${ownerId}, 'Invite Test Owner', ${`owner-${uniqueSuffix}@example.com`}),
			(${candidateId}, 'Invite Test Candidate', ${`candidate-${uniqueSuffix}@example.com`}),
			(${memberId}, 'Invite Test Member', ${`member-${uniqueSuffix}@example.com`}),
			(${secondCandidateId}, 'Second Invite Test Candidate', ${`second-candidate-${uniqueSuffix}@example.com`})
	`;
	await sqlClient`
		INSERT INTO organization (id, name, slug)
		VALUES (
			${organizationId},
			'Invite Test Organization',
			${`invite-test-${uniqueSuffix}`}
		)
	`;
	await sqlClient`
		INSERT INTO member (id, organization_id, user_id, role)
		VALUES (${randomUUID()}, ${organizationId}, ${ownerId}, 'owner')
	`;
	if (options.includeMember) {
		await sqlClient`
			INSERT INTO member (id, organization_id, user_id, role)
			VALUES (${randomUUID()}, ${organizationId}, ${memberId}, 'member')
		`;
	}

	return {
		candidateId,
		memberId,
		organizationId,
		ownerId,
		secondCandidateId,
	};
}

async function countMemberships(organizationId: string, userId: string) {
	const [membership] = await sqlClient<Array<{ count: string }>>`
		SELECT COUNT(*) AS count
		FROM member
		WHERE organization_id = ${organizationId}
			AND user_id = ${userId}
	`;
	assert(membership);
	return Number(membership.count);
}

async function insertPaidSubscription(fixture: TeamInviteFixture) {
	await sqlClient`
		INSERT INTO billing_subscription (
			stripe_subscription_id, organization_id, purchaser_user_id,
			stripe_customer_id, stripe_subscription_item_id, plan,
			billing_period, status, seat_quantity, last_paid_amount,
			last_paid_currency, last_paid_at
		) VALUES (
			${`sub_${randomUUID()}`}, ${fixture.organizationId}, ${fixture.ownerId},
			${`cus_${randomUUID()}`}, ${`si_${randomUUID()}`}, 'basic',
			'monthly', 'active', 2, 5000, 'usd', NOW()
		)
	`;
}

async function readLatestBillingTraits(userId: string) {
	const [traits] = await sqlClient<
		Array<{ properties: Record<string, boolean | number | string | null> }>
	>`
		SELECT properties
		FROM billing_analytics_outbox
		WHERE kind = 'traits' AND user_id = ${userId}
		ORDER BY occurred_at DESC, id DESC
		LIMIT 1
	`;
	assert(traits);
	return traits.properties;
}

async function countActiveInvites(organizationId: string) {
	const [activeInvites] = await sqlClient<Array<{ count: string }>>`
		SELECT COUNT(*) AS count
		FROM team_invite_link
		WHERE organization_id = ${organizationId}
			AND revoked_at IS NULL
	`;
	assert(activeInvites);
	return Number(activeInvites.count);
}

async function getActiveTokenHash(organizationId: string) {
	const [activeInvite] = await sqlClient<Array<{ tokenHash: string }>>`
		SELECT token_hash AS "tokenHash"
		FROM team_invite_link
		WHERE organization_id = ${organizationId}
			AND revoked_at IS NULL
	`;
	assert(activeInvite);
	return activeInvite.tokenHash;
}

async function waitForBlockedInviteUpdate() {
	const deadline = Date.now() + 2_000;

	while (Date.now() < deadline) {
		const [blockedUpdate] = await sqlClient<Array<{ pid: number }>>`
			SELECT pid
			FROM pg_stat_activity
			WHERE datname = current_database()
				AND pid <> pg_backend_pid()
				AND wait_event_type = 'Lock'
				AND query LIKE '%UPDATE team_invite_link%'
			LIMIT 1
		`;
		if (blockedUpdate) {
			return;
		}
		await Bun.sleep(20);
	}

	throw new Error("Revocation did not block while updating the invite row");
}

function createPostgresClient(): postgres.Sql {
	const connectionString = process.env.PG_CONNECTION_STRING;
	if (!connectionString) {
		throw new Error("PG_CONNECTION_STRING is required for integration tests");
	}
	return postgres(connectionString, { max: 1 });
}

function hashToken(token: string) {
	return createHash("sha256").update(token).digest("base64url");
}
