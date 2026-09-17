import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import {
	CLI_CONNECTION_CODE_TTL_MS,
	CLI_CONNECTION_TTL_MS,
	type CliConnectionSnapshot,
	CliConnectionSnapshotSchema,
	type CliConnectionUpdate,
	isCliConnectionTerminal,
} from "@rudel/api-routes";
import { cliConnection, deviceCode, member } from "@rudel/sql-schema";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { db } from "../db.js";

type ConnectionRow = typeof cliConnection.$inferSelect;
type ConnectionTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];

export async function createCliConnection(input: {
	browserToken: string;
	source: string;
	returnOrigin: string;
}) {
	const now = Date.now();
	const code = randomBytes(32).toString("base64url");
	const browserHash = hashCliConnectionSecret(input.browserToken);
	const sourceHash = hashCliConnectionSecret(input.source);
	const snapshot: CliConnectionSnapshot = {
		id: randomUUID(),
		browserOrigin: input.returnOrigin,
		state: "waiting",
		revision: 0,
		createdAt: new Date(now).toISOString(),
		expiresAt: new Date(now + CLI_CONNECTION_TTL_MS).toISOString(),
		lastSeenAt: new Date(now).toISOString(),
		repositories: [],
		organizationId: null,
		totals: null,
		failureReason: null,
	};
	await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${`cli-create:${sourceHash}`}, 0))`,
		);
		const [recent] = await tx
			.select({ count: count() })
			.from(cliConnection)
			.where(
				and(
					eq(cliConnection.sourceHash, sourceHash),
					gt(cliConnection.createdAt, new Date(now - 60 * 60_000)),
				),
			);
		if ((recent?.count ?? 0) >= 20)
			throw new ORPCError("TOO_MANY_REQUESTS", {
				message: "Too many connection attempts. Try again later.",
			});
		await tx.execute(
			sql`delete from cli_connection where id in (select id from cli_connection where expires_at < now() - interval '1 day' limit 100)`,
		);
		await tx.insert(cliConnection).values({
			id: snapshot.id,
			browserHash,
			sourceHash,
			pairingHash: hashCliConnectionSecret(code),
			returnOrigin: input.returnOrigin,
			snapshot,
			expiresAt: new Date(snapshot.expiresAt),
			codeExpiresAt: new Date(now + CLI_CONNECTION_CODE_TTL_MS),
		});
	});
	return {
		connection: snapshot,
		code,
		codeExpiresAt: new Date(now + CLI_CONNECTION_CODE_TTL_MS).toISOString(),
	};
}

export async function redeemCliConnection(code: string, writerToken: string) {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(cliConnection)
			.where(eq(cliConnection.pairingHash, hashCliConnectionSecret(code)))
			.for("update");
		if (!row || row.codeExpiresAt.getTime() <= Date.now())
			throw new ORPCError("NOT_FOUND", {
				message:
					"This connection code expired. Copy a new command from the demo.",
			});
		const writerHash = hashCliConnectionSecret(writerToken);
		if (row.writerHash && row.writerHash !== writerHash)
			throw new ORPCError("CONFLICT", {
				message: "This code is already connected to another terminal.",
			});
		const current = liveSnapshot(row);
		if (row.writerHash) return current;
		const next = {
			...current,
			state: "scanning" as const,
			revision: current.revision + 1,
			lastSeenAt: new Date().toISOString(),
		};
		await persistConnection(tx, row.id, next, { writerHash });
		return next;
	});
}

export async function readBrowserCliConnection(
	id: string,
	browserToken: string,
) {
	const [row] = await db
		.select()
		.from(cliConnection)
		.where(
			and(
				eq(cliConnection.id, id),
				eq(cliConnection.browserHash, hashCliConnectionSecret(browserToken)),
			),
		);
	if (!row) throw new ORPCError("NOT_FOUND");
	const snapshot = CliConnectionSnapshotSchema.parse(row.snapshot);
	return row.expiresAt.getTime() <= Date.now() &&
		!isCliConnectionTerminal(snapshot.state)
		? { ...snapshot, state: "expired" as const }
		: snapshot;
}

export async function authorizeBrowserCliConnection(input: {
	id: string;
	browserToken: string;
	userId: string;
	userCode: string;
	organizationId: string;
}) {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(cliConnection)
			.where(
				and(
					eq(cliConnection.id, input.id),
					eq(
						cliConnection.browserHash,
						hashCliConnectionSecret(input.browserToken),
					),
				),
			)
			.for("update");
		if (!row) throw new ORPCError("NOT_FOUND");
		const current = liveSnapshot(row);
		if (
			current.state !== "awaiting_login" ||
			row.deviceUserCode !== input.userCode
		)
			throw new ORPCError("CONFLICT", {
				message: "The browser and terminal authorization do not match.",
			});
		const [device] = await tx
			.select()
			.from(deviceCode)
			.where(
				and(
					eq(deviceCode.userCode, input.userCode),
					gt(deviceCode.expiresAt, new Date()),
				),
			);
		if (
			!device ||
			(device.userId && device.userId !== input.userId) ||
			(row.userId && row.userId !== input.userId)
		)
			throw new ORPCError("FORBIDDEN", {
				message: "Sign in with the account used for this connection.",
			});
		const [membership] = await tx
			.select({ id: member.id })
			.from(member)
			.where(
				and(
					eq(member.userId, input.userId),
					eq(member.organizationId, input.organizationId),
				),
			);
		if (!membership)
			throw new ORPCError("FORBIDDEN", {
				message: "Choose a workspace you belong to.",
			});
		if (
			current.organizationId &&
			current.organizationId !== input.organizationId
		)
			throw new ORPCError("CONFLICT", {
				message: "This connection already has an upload destination.",
			});
		await persistConnection(
			tx,
			row.id,
			{
				...current,
				organizationId: input.organizationId,
				revision: current.revision + 1,
			},
			{ userId: input.userId },
		);
		const returnUrl = new URL("/welcome", row.returnOrigin);
		returnUrl.searchParams.set("connect", row.id);
		return { returnUrl: returnUrl.toString() };
	});
}

export async function updateCliConnection(
	id: string,
	input: CliConnectionUpdate,
	authenticatedUserId: string | null,
) {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(cliConnection)
			.where(
				and(
					eq(cliConnection.id, id),
					eq(
						cliConnection.writerHash,
						hashCliConnectionSecret(input.writerToken),
					),
				),
			)
			.for("update");
		if (!row) throw new ORPCError("NOT_FOUND");
		const current = liveSnapshot(row);
		const updateHash = hashCliConnectionSecret(JSON.stringify(input.update));
		if (
			input.sequence === row.clientSequence &&
			updateHash === row.lastUpdateHash
		)
			return current;
		if (
			input.sequence !== row.clientSequence + 1 ||
			isCliConnectionTerminal(current.state)
		)
			throw new ORPCError("CONFLICT", {
				message: "This connection has moved on. Restart from the demo.",
			});
		let next = {
			...current,
			revision: current.revision + 1,
			lastSeenAt: new Date().toISOString(),
		};
		let nextDeviceUserCode = row.deviceUserCode;
		switch (input.update.kind) {
			case "selection": {
				requireConnectionState(current, ["scanning"]);
				next = {
					...next,
					state: "awaiting_login",
					repositories: input.update.repositories,
				};
				break;
			}
			case "device": {
				requireConnectionState(current, ["awaiting_login"]);
				if (row.deviceUserCode) throw new ORPCError("CONFLICT");
				const [device] = await tx
					.select()
					.from(deviceCode)
					.where(
						and(
							eq(deviceCode.deviceCode, input.update.deviceCode),
							gt(deviceCode.expiresAt, new Date()),
						),
					);
				if (
					!device ||
					device.clientId !== "rudel-cli" ||
					device.status !== "pending"
				)
					throw new ORPCError("BAD_REQUEST", {
						message: "Invalid device authorization.",
					});
				nextDeviceUserCode = device.userCode;
				break;
			}
			case "bind": {
				if (current.organizationId !== input.update.organizationId)
					throw new ORPCError("FORBIDDEN", {
						message: "Upload to the workspace approved in your browser.",
					});
				requireConnectionState(current, ["awaiting_login"]);
				if (!authenticatedUserId || authenticatedUserId !== row.userId)
					throw new ORPCError("FORBIDDEN", {
						message: "Approve this connection in the original browser first.",
					});
				const [membership] = await tx
					.select({ id: member.id })
					.from(member)
					.where(
						and(
							eq(member.userId, authenticatedUserId),
							eq(member.organizationId, input.update.organizationId),
						),
					);
				if (!membership) throw new ORPCError("FORBIDDEN");
				next = {
					...next,
					state: "ready",
					organizationId: input.update.organizationId,
				};
				break;
			}
			case "status": {
				if (input.update.state === "uploading")
					requireConnectionState(current, ["ready"]);
				if (input.update.state === "completed") {
					requireConnectionState(current, ["ready", "uploading"]);
					if (
						!input.update.totals ||
						(input.update.totals.failed > 0 &&
							input.update.totals.uploaded + input.update.totals.skipped === 0)
					)
						throw new ORPCError("BAD_REQUEST");
				}
				next = {
					...next,
					state: input.update.state,
					totals: input.update.totals ?? null,
					failureReason: input.update.failureReason ?? null,
				};
				break;
			}
			case "heartbeat":
				break;
		}
		await persistConnection(tx, id, next, {
			clientSequence: input.sequence,
			lastUpdateHash: updateHash,
			deviceUserCode: nextDeviceUserCode,
		});
		return next;
	});
}

export function hashCliConnectionSecret(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function cliConnectionChannel(id: string): string {
	return `opaline_cli_${id.replaceAll("-", "")}`;
}

function liveSnapshot(row: ConnectionRow): CliConnectionSnapshot {
	if (row.expiresAt.getTime() <= Date.now())
		throw new ORPCError("GONE", {
			status: 410,
			message: "This connection expired. Copy a new command from the demo.",
		});
	return CliConnectionSnapshotSchema.parse(row.snapshot);
}

function requireConnectionState(
	snapshot: CliConnectionSnapshot,
	states: readonly CliConnectionSnapshot["state"][],
): void {
	if (!states.includes(snapshot.state))
		throw new ORPCError("CONFLICT", { message: "Invalid connection state." });
}

async function persistConnection(
	tx: ConnectionTransaction,
	id: string,
	snapshot: CliConnectionSnapshot,
	values: Partial<typeof cliConnection.$inferInsert>,
) {
	await tx
		.update(cliConnection)
		.set({ ...values, snapshot })
		.where(eq(cliConnection.id, id));
	await tx.execute(
		sql`select pg_notify(${cliConnectionChannel(id)}, ${String(snapshot.revision)})`,
	);
}
