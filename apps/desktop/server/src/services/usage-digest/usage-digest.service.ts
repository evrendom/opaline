import { randomUUID } from "node:crypto";
import { getLogger } from "@logtape/logtape";
import { buildOrganizationPath } from "@rudel/api-routes/organization-paths";
import {
	buildQuietWeekEmail,
	buildUsageDigestEmail,
	type EmailContent,
} from "@rudel/api-routes/usage-digest-email";
import {
	member,
	organization,
	session,
	usageDigest,
	usageDigestDelivery,
	usageDigestPreference,
	user,
} from "@rudel/sql-schema";
import { and, desc, eq, lt, ne, or, sql } from "drizzle-orm";
import { Resend } from "resend";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import { db } from "../../db.js";
import { getFrontendOrigin } from "../../frontend-origin.js";
import {
	OPALINE_AUTOMATED_EMAIL_SENDER,
	OPALINE_REPLY_TO,
} from "../../resend-config.js";
import {
	addDays,
	type DigestKind,
	type DigestPeriod,
	duePeriods,
	FALLBACK_TIME_ZONE,
	periodOf,
	sendDeadline,
	sendTime,
} from "./schedule.js";
import {
	createUnsubscribeToken,
	UNSUBSCRIBE_PATH,
} from "./unsubscribe-token.js";
import { readDigestReport } from "./usage.js";

const logger = getLogger(["rudel", "api", "usage-digest"]);

const KINDS: readonly DigestKind[] = ["weekly", "daily"];
const LEASE_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
/** Stop claiming workspaces after this long, so a run ends well inside its function limit. */
const CLAIM_BUDGET_MS = 180_000;
/** Resend allows two requests a second per team by default. */
const SEND_INTERVAL_MS = 600;
const ADMIN_ROLES = new Set(["owner", "admin"]);
/** Only members who used Opaline since then get the digests, not everyone who once signed up. */
const ACTIVE_SINCE = "2026-08-01T00:00:00Z";

export interface UsageDigestConfig {
	/** Only the exact value `true` of USAGE_DIGEST_ENABLED sends anything. */
	enabled: boolean;
	/** USAGE_DIGEST_ORG_IDS: the workspaces it sends to; null for every workspace. */
	organizationIds: ReadonlySet<string> | null;
	/** Signs unsubscribe links (BETTER_AUTH_SECRET). */
	secret: string;
	/** The public web origin links in the email open. */
	origin: string;
	/** USAGE_DIGEST_FROM, or the automated email sender. */
	from: string;
}

export function readUsageDigestConfig(
	env: Record<string, string | undefined> = process.env,
): UsageDigestConfig {
	const ids = (env.USAGE_DIGEST_ORG_IDS ?? "")
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
	return {
		enabled: env.USAGE_DIGEST_ENABLED === "true",
		organizationIds: ids.length ? new Set(ids) : null,
		secret: env.BETTER_AUTH_SECRET ?? "",
		origin: getFrontendOrigin(),
		from: env.USAGE_DIGEST_FROM?.trim() || OPALINE_AUTOMATED_EMAIL_SENDER,
	};
}

export interface DigestEmail extends EmailContent {
	to: string;
	unsubscribeUrl: string;
	idempotencyKey: string;
}

export type SendDigestEmail = (email: DigestEmail) => Promise<void>;

export interface UsageDigestPassResult {
	enqueued: number;
	sent: number;
	nudged: number;
	quiet: number;
	failed: number;
	emails: number;
}

type Database = typeof db;

interface Recipient {
	userId: string;
	email: string;
	role: string;
	/** Where their send time is; null until the app has seen them since it started asking. */
	timeZone: string | null;
}

interface Workspace {
	id: string;
	name: string;
	slug: string;
	ownSessionsOnly: boolean;
}

const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});
const WEEKDAY = new Intl.DateTimeFormat("en-US", {
	weekday: "long",
	timeZone: "UTC",
});

export function periodLabels(period: DigestPeriod): {
	periodLabel: string;
	comparisonLabel: string;
} {
	const first = new Date(`${period.start}T00:00:00Z`);
	if (period.kind === "weekly")
		return {
			periodLabel: `${MONTH_DAY.format(first)} to ${MONTH_DAY.format(new Date(`${addDays(period.end, -1)}T00:00:00Z`))}`,
			comparisonLabel: "the week before",
		};
	const day = WEEKDAY.format(first);
	return {
		periodLabel: `${day}, ${MONTH_DAY.format(first)}`,
		comparisonLabel: `the ${day} before`,
	};
}

function workspaceLink(
	origin: string,
	slug: string,
	relativePath: string,
): string {
	try {
		return `${origin}${buildOrganizationPath(slug, relativePath)}`;
	} catch {
		return origin;
	}
}

function unsubscribeUrl(
	config: UsageDigestConfig,
	kind: DigestKind,
	userId: string,
	organizationId: string,
): string {
	const token = createUnsubscribeToken(config.secret, {
		kind,
		userId,
		organizationId,
	});
	return `${config.origin}${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`;
}

/**
 * The members who get this kind of digest: those with a verified email who
 * used Opaline (a session in use) since ACTIVE_SINCE, unless they turned the
 * digest off for the workspace. Also how many verified members the
 * workspace has in all.
 */
async function readRecipients(
	database: Database,
	organizationId: string,
	kind: DigestKind,
): Promise<{ recipients: Recipient[]; members: number }> {
	const rows = await database
		.select({
			userId: user.id,
			email: user.email,
			role: member.role,
			timeZone: user.timeZone,
			daily: usageDigestPreference.daily,
			weekly: usageDigestPreference.weekly,
			active: sql<boolean>`EXISTS (SELECT 1 FROM ${session} WHERE ${session.userId} = ${user.id} AND ${session.updatedAt} >= ${ACTIVE_SINCE}::timestamptz)`,
		})
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.leftJoin(
			usageDigestPreference,
			and(
				eq(usageDigestPreference.userId, member.userId),
				eq(usageDigestPreference.organizationId, member.organizationId),
			),
		)
		.where(
			and(
				eq(member.organizationId, organizationId),
				eq(user.emailVerified, true),
			),
		)
		.orderBy(user.id);
	return {
		recipients: rows
			.filter(
				(row) =>
					row.active && ((kind === "daily" ? row.daily : row.weekly) ?? true),
			)
			.map(({ userId, email, role, timeZone }) => ({
				userId,
				email,
				role,
				timeZone,
			})),
		members: rows.length,
	};
}

/** Whether the workspace's last weekly digest already said the week was quiet. */
async function alreadyNudged(
	database: Database,
	organizationId: string,
	period: DigestPeriod,
): Promise<boolean> {
	const [last] = await database
		.select({ outcome: usageDigest.outcome })
		.from(usageDigest)
		.where(
			and(
				eq(usageDigest.organizationId, organizationId),
				eq(usageDigest.kind, "weekly"),
				eq(usageDigest.status, "done"),
				lt(usageDigest.periodStart, period.start),
			),
		)
		.orderBy(desc(usageDigest.periodStart))
		.limit(1);
	return last?.outcome === "nudge" || last?.outcome === "quiet";
}

type Outcome = "sent" | "nudge" | "quiet" | "no_recipients";

/**
 * One workspace's digest for one period, to the members whose send time has
 * come (sendTime) and not passed (sendDeadline), and who have not had it
 * yet. `waiting` counts those whose send time is still ahead, so the digest
 * stays open for a later run.
 */
async function deliver(input: {
	database: Database;
	clickhouse: ClickHouseExecutor;
	config: UsageDigestConfig;
	send: SendDigestEmail;
	digestId: string;
	workspace: Workspace;
	period: DigestPeriod;
	now: Date;
}): Promise<{ outcome: Outcome; emails: number; waiting: number }> {
	const { config, digestId, period, workspace } = input;
	const { recipients, members } = await readRecipients(
		input.database,
		workspace.id,
		period.kind,
	);
	const delivered = new Set(
		(
			await input.database
				.select({ userId: usageDigestDelivery.userId })
				.from(usageDigestDelivery)
				.where(eq(usageDigestDelivery.digestId, digestId))
		).map((row) => row.userId),
	);
	const zone = (recipient: Recipient) =>
		recipient.timeZone ?? FALLBACK_TIME_ZONE;
	const open = recipients.filter(
		(recipient) => !delivered.has(recipient.userId),
	);
	const waiting = open.filter(
		(recipient) => sendTime(period, zone(recipient)) > input.now,
	).length;
	const due = open.filter((recipient) => {
		const deadline = sendDeadline(period, zone(recipient));
		return (
			sendTime(period, zone(recipient)) <= input.now &&
			(!deadline || input.now < deadline)
		);
	});
	if (recipients.length === 0)
		return { outcome: "no_recipients", emails: 0, waiting: 0 };
	// Nobody's send time yet: no ClickHouse read until someone is due.
	if (due.length === 0) return { outcome: "no_recipients", emails: 0, waiting };
	const labels = periodLabels(period);
	const settingsUrl = `${workspaceLink(config.origin, workspace.slug, "settings/account")}#email-digests`;
	/** Records that the member is done with this digest, sent or not. */
	const done = (recipient: Recipient) =>
		input.database
			.insert(usageDigestDelivery)
			.values({ digestId, userId: recipient.userId })
			.onConflictDoNothing();
	const send = async (
		recipient: Recipient,
		build: (unsubscribeUrl: string) => EmailContent,
	) => {
		const unsubscribe = unsubscribeUrl(
			config,
			period.kind,
			recipient.userId,
			workspace.id,
		);
		await input.send({
			...build(unsubscribe),
			to: recipient.email,
			unsubscribeUrl: unsubscribe,
			idempotencyKey: `usage-digest/${digestId}/${recipient.userId}`,
		});
		await done(recipient);
	};

	// The weekly reads the same UTC week for everyone; the daily reads each
	// member's own day, once per time zone.
	const byZone = new Map<string, Recipient[]>();
	for (const recipient of due) {
		const key = period.kind === "weekly" ? FALLBACK_TIME_ZONE : zone(recipient);
		byZone.set(key, [...(byZone.get(key) ?? []), recipient]);
	}
	let emails = 0;
	let active = false;
	for (const [timeZone, group] of byZone) {
		const report = await readDigestReport(
			input.clickhouse,
			workspace.id,
			period,
			timeZone,
		);
		if (report.team.activeMembers > 0) active = true;
		else if (period.kind === "weekly") {
			if (await alreadyNudged(input.database, workspace.id, period))
				return { outcome: "quiet", emails: 0, waiting: 0 };
			for (const recipient of group)
				await send(recipient, (unsubscribe) =>
					buildQuietWeekEmail({
						workspaceName: workspace.name,
						periodLabel: labels.periodLabel,
						setupUrl: workspaceLink(
							config.origin,
							workspace.slug,
							"settings/sessions",
						),
						settingsUrl,
						unsubscribeUrl: unsubscribe,
						assetOrigin: config.origin,
					}),
				);
			return { outcome: "nudge", emails: group.length, waiting };
		}
		for (const recipient of group) {
			const you = report.members.get(recipient.userId) ?? null;
			// The daily goes only to members who used their agents that day.
			if (period.kind === "daily" && !you) {
				await done(recipient);
				continue;
			}
			const seesTeam =
				report.team.activeMembers > (you ? 1 : 0) &&
				(!workspace.ownSessionsOnly || ADMIN_ROLES.has(recipient.role));
			await send(recipient, (unsubscribe) =>
				buildUsageDigestEmail({
					kind: period.kind,
					workspaceName: workspace.name,
					...labels,
					you,
					team: seesTeam ? report.team : null,
					// Alone in the workspace: the team section asks for teammates.
					inviteUrl:
						members === 1
							? workspaceLink(config.origin, workspace.slug, "settings/members")
							: null,
					workspaceUrl: workspaceLink(
						config.origin,
						workspace.slug,
						"sessions",
					),
					settingsUrl,
					unsubscribeUrl: unsubscribe,
					assetOrigin: config.origin,
				}),
			);
			emails += 1;
		}
	}
	return {
		outcome: emails ? "sent" : active ? "no_recipients" : "quiet",
		emails,
		waiting,
	};
}

function claimable(now: Date) {
	return or(
		eq(usageDigest.status, "pending"),
		and(eq(usageDigest.status, "claimed"), lt(usageDigest.leaseExpiresAt, now)),
	);
}

/**
 * The hourly pass: enqueue every workspace's due daily and weekly digests,
 * then claim and send them one workspace at a time, each to the members
 * whose send time has come. A digest with members still to come goes back to
 * pending for a later pass; so does one whose sending failed, until it
 * failed MAX_ATTEMPTS times. Only the open periods (duePeriods) are ever
 * sent, so a weekly never arrives after the next one and a daily never the
 * day after; an older one still open is closed as expired.
 */
export async function runUsageDigestPass(input: {
	clickhouse: ClickHouseExecutor;
	config: UsageDigestConfig;
	send: SendDigestEmail;
	database?: Database;
	now?: Date;
}): Promise<UsageDigestPassResult> {
	const database = input.database ?? db;
	const now = input.now ?? new Date();
	const started = Date.now();
	const result: UsageDigestPassResult = {
		enqueued: 0,
		sent: 0,
		nudged: 0,
		quiet: 0,
		failed: 0,
		emails: 0,
	};
	if (!input.config.enabled) return result;
	if (!input.config.secret)
		throw new Error("BETTER_AUTH_SECRET is required to sign unsubscribe links");

	const workspaces = (
		await database
			.select({
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				ownSessionsOnly: organization.ownSessionsOnly,
			})
			.from(organization)
	).filter(
		(workspace) =>
			input.config.organizationIds === null ||
			input.config.organizationIds.has(workspace.id),
	);
	const byId = new Map(
		workspaces.map((workspace) => [workspace.id, workspace]),
	);

	for (const kind of KINDS) {
		const periods = duePeriods(kind, now);
		const [oldest] = periods;
		if (!oldest || workspaces.length === 0) continue;
		await database
			.update(usageDigest)
			.set({
				status: "done",
				outcome: sql`coalesce(${usageDigest.outcome}, 'expired')`,
				leaseToken: null,
				leaseExpiresAt: null,
				completedAt: now,
			})
			.where(
				and(
					eq(usageDigest.kind, kind),
					lt(usageDigest.periodStart, oldest.start),
					ne(usageDigest.status, "done"),
				),
			);
		for (const period of periods) {
			const enqueued = await database
				.insert(usageDigest)
				.values(
					workspaces.map((workspace) => ({
						id: randomUUID(),
						organizationId: workspace.id,
						kind,
						periodStart: period.start,
					})),
				)
				.onConflictDoNothing()
				.returning({ id: usageDigest.id });
			result.enqueued += enqueued.length;

			const candidates = await database
				.select({
					id: usageDigest.id,
					organizationId: usageDigest.organizationId,
				})
				.from(usageDigest)
				.where(
					and(
						eq(usageDigest.kind, kind),
						eq(usageDigest.periodStart, period.start),
						claimable(now),
					),
				)
				.orderBy(usageDigest.createdAt);

			for (const candidate of candidates) {
				const workspace = byId.get(candidate.organizationId);
				if (!workspace) continue;
				if (Date.now() - started > CLAIM_BUDGET_MS) return result;
				const leaseToken = randomUUID();
				const [claimed] = await database
					.update(usageDigest)
					.set({
						status: "claimed",
						leaseToken,
						leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
					})
					.where(and(eq(usageDigest.id, candidate.id), claimable(now)))
					.returning({ attemptCount: usageDigest.attemptCount });
				if (!claimed) continue;
				const owned = and(
					eq(usageDigest.id, candidate.id),
					eq(usageDigest.leaseToken, leaseToken),
				);
				try {
					const delivered = await deliver({
						database,
						clickhouse: input.clickhouse,
						config: input.config,
						send: input.send,
						digestId: candidate.id,
						workspace,
						period: periodOf(kind, period.start),
						now,
					});
					const finished = delivered.waiting === 0;
					await database
						.update(usageDigest)
						.set({
							status: finished ? "done" : "pending",
							// A pass that sent names the outcome; one that only closes keeps an earlier one.
							outcome: delivered.emails
								? delivered.outcome
								: finished
									? sql`coalesce(${usageDigest.outcome}, ${delivered.outcome})`
									: undefined,
							recipients: sql`${usageDigest.recipients} + ${delivered.emails}`,
							leaseToken: null,
							leaseExpiresAt: null,
							completedAt: finished ? new Date() : null,
						})
						.where(owned);
					result.emails += delivered.emails;
					if (finished) {
						if (delivered.outcome === "sent") result.sent += 1;
						else if (delivered.outcome === "nudge") result.nudged += 1;
						else result.quiet += 1;
					}
				} catch (error) {
					result.failed += 1;
					const attempts = claimed.attemptCount + 1;
					const gaveUp = attempts >= MAX_ATTEMPTS;
					await database
						.update(usageDigest)
						.set({
							status: gaveUp ? "done" : "pending",
							outcome: gaveUp ? "failed" : undefined,
							attemptCount: attempts,
							lastError: String(error).slice(0, 1000),
							leaseToken: null,
							leaseExpiresAt: null,
							completedAt: gaveUp ? new Date() : null,
						})
						.where(owned);
					logger.error(
						"Usage digest {digestId} for workspace {organizationId} failed (attempt {attempts}): {error}",
						{
							digestId: candidate.id,
							organizationId: candidate.organizationId,
							attempts,
							error: String(error),
						},
					);
				}
			}
		}
	}
	return result;
}

/**
 * Sends through Resend one email at a time, spaced to stay under its rate
 * limit, with one-click unsubscribe headers (RFC 8058) and an idempotency key
 * per member and digest, so a retried pass never sends the same email twice.
 */
export function createResendDigestSender(config: {
	apiKey: string;
	from: string;
}): SendDigestEmail {
	const resend = new Resend(config.apiKey);
	let lastSentAt = 0;
	return async (email) => {
		const wait = lastSentAt + SEND_INTERVAL_MS - Date.now();
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		lastSentAt = Date.now();
		const response = await resend.emails.send(
			{
				from: config.from,
				// Replies reach a person, not the notifications sender.
				replyTo: OPALINE_REPLY_TO,
				to: email.to,
				subject: email.subject,
				html: email.html,
				text: email.text,
				headers: {
					"List-Unsubscribe": `<${email.unsubscribeUrl}>`,
					"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
				},
			},
			{ idempotencyKey: email.idempotencyKey },
		);
		if (response.error)
			throw new Error(
				`Resend rejected a usage digest (${response.error.name}): ${response.error.message}`,
			);
	};
}

// --- Preferences: the settings card and the unsubscribe link -------------

export interface UsageDigestPreferenceRow {
	organizationId: string;
	organizationName: string;
	daily: boolean;
	weekly: boolean;
}

export async function listUsageDigestPreferences(
	userId: string,
	database: Database = db,
): Promise<UsageDigestPreferenceRow[]> {
	const rows = await database
		.select({
			organizationId: organization.id,
			organizationName: organization.name,
			daily: usageDigestPreference.daily,
			weekly: usageDigestPreference.weekly,
		})
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.leftJoin(
			usageDigestPreference,
			and(
				eq(usageDigestPreference.userId, member.userId),
				eq(usageDigestPreference.organizationId, member.organizationId),
			),
		)
		.where(eq(member.userId, userId))
		.orderBy(organization.name);
	return rows.map((row) => ({
		organizationId: row.organizationId,
		organizationName: row.organizationName,
		daily: row.daily ?? true,
		weekly: row.weekly ?? true,
	}));
}

/**
 * Turns one digest on or off for a member of the workspace. False when the
 * user is not (or no longer) a member, so nothing is stored for them.
 */
export async function setUsageDigestPreference(
	input: {
		userId: string;
		organizationId: string;
		kind: DigestKind;
		enabled: boolean;
	},
	database: Database = db,
): Promise<boolean> {
	const [membership] = await database
		.select({ id: member.id })
		.from(member)
		.where(
			and(
				eq(member.userId, input.userId),
				eq(member.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!membership) return false;
	const column = input.kind === "daily" ? "daily" : "weekly";
	await database
		.insert(usageDigestPreference)
		.values({
			userId: input.userId,
			organizationId: input.organizationId,
			[column]: input.enabled,
		})
		.onConflictDoUpdate({
			target: [
				usageDigestPreference.userId,
				usageDigestPreference.organizationId,
			],
			set: { [column]: input.enabled, updatedAt: sql`now()` },
		});
	return true;
}
