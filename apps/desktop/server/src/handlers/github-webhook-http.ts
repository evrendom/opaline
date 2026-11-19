import { getLogger } from "@logtape/logtape";
import type postgres from "postgres";
import {
	type GitHubWebhookDeliveryResult,
	recordGitHubWebhookDelivery,
} from "../services/github-webhook-delivery.service.js";
import {
	GITHUB_WEBHOOK_DELIVERY_ID_PATTERN,
	GITHUB_WEBHOOK_EVENT_PATTERN,
	mapGitHubWebhookEvent,
	readGitHubWebhookSecret,
	verifyGitHubWebhookSignature,
} from "../services/github-webhook-events.js";

export const GITHUB_WEBHOOK_PATH = "/api/webhooks/github";
const MAX_GITHUB_WEBHOOK_BODY_BYTES = 5 * 1024 * 1024;
// Timers may fire marginally early; wake just after the refresh falls due.
const WAKE_SLACK_MS = 1_000;
const logger = getLogger(["opaline", "api", "github-webhook"]);

export interface GitHubWebhookRequestDependencies {
	readonly secret: string;
	/** Resolved only after the signature was verified. */
	readonly getDatabase: () => Promise<postgres.Sql>;
	/** Registers asynchronous collection work; never awaited by acknowledgment. */
	readonly onRefreshScheduled: (
		delayMs: number,
		collectionIds: readonly string[],
	) => void;
	readonly now?: () => Date;
}

/**
 * Verifies, deduplicates and maps one GitHub App delivery onto the durable
 * evidence queue, then acknowledges. Collection never runs in this request.
 */
export async function handleGitHubWebhookRequest(
	request: Request,
	dependencies: GitHubWebhookRequestDependencies,
): Promise<Response> {
	if (request.method !== "POST") {
		return new Response("Method Not Allowed", {
			headers: { Allow: "POST" },
			status: 405,
		});
	}
	const signature = request.headers.get("x-hub-signature-256");
	if (!signature) {
		return Response.json(
			{ error: "Missing GitHub signature" },
			{ status: 401 },
		);
	}
	if (
		Number(request.headers.get("content-length") ?? 0) >
		MAX_GITHUB_WEBHOOK_BODY_BYTES
	) {
		return Response.json(
			{ error: "Webhook payload too large" },
			{ status: 413 },
		);
	}
	const body = await readRequestBytesWithinLimit(
		request,
		MAX_GITHUB_WEBHOOK_BODY_BYTES,
	);
	if (!body) {
		return Response.json(
			{ error: "Webhook payload too large" },
			{ status: 413 },
		);
	}
	if (
		!verifyGitHubWebhookSignature({
			body,
			secret: dependencies.secret,
			signature,
		})
	) {
		return Response.json(
			{ error: "Invalid GitHub signature" },
			{ status: 401 },
		);
	}

	const deliveryId = request.headers.get("x-github-delivery") ?? "";
	const event = request.headers.get("x-github-event") ?? "";
	if (
		!GITHUB_WEBHOOK_DELIVERY_ID_PATTERN.test(deliveryId) ||
		!GITHUB_WEBHOOK_EVENT_PATTERN.test(event)
	) {
		return Response.json(
			{ error: "Missing GitHub delivery headers" },
			{ status: 400 },
		);
	}
	let payload: unknown;
	try {
		payload = JSON.parse(new TextDecoder().decode(body));
	} catch {
		return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
	}
	const mapped = mapGitHubWebhookEvent(event, payload);
	if (!mapped) return accepted("ignored");

	let result: GitHubWebhookDeliveryResult;
	try {
		result = await recordGitHubWebhookDelivery({
			action: mapped.action,
			database: await dependencies.getDatabase(),
			deliveryId,
			event,
			intent: mapped.intent,
			now: dependencies.now,
		});
	} catch (error) {
		logger.error(
			"GitHub webhook delivery could not be recorded (delivery_id={deliveryId} event={event} error={error})",
			{ deliveryId, error: String(error), event },
		);
		return Response.json(
			{ error: "GitHub webhook could not be recorded" },
			{ status: 500 },
		);
	}
	if (result.status !== "recorded") return accepted(result.status);
	if (result.refreshDueAt) {
		const now = (dependencies.now ?? (() => new Date()))();
		dependencies.onRefreshScheduled(
			Math.max(0, result.refreshDueAt.getTime() - now.getTime()) +
				WAKE_SLACK_MS,
			result.collectionIds,
		);
	}
	return accepted(result.outcome);
}

/**
 * Production wiring shared by the Bun server and the dedicated Vercel
 * function. Unsigned probes never initialize the database client or worker.
 */
export async function handleConfiguredGitHubWebhookRequest(
	request: Request,
	onRefreshScheduled?: GitHubWebhookRequestDependencies["onRefreshScheduled"],
): Promise<Response> {
	let secret: string | null;
	try {
		secret = readGitHubWebhookSecret();
	} catch {
		return Response.json(
			{ error: "GitHub webhooks are misconfigured" },
			{ status: 500 },
		);
	}
	if (!secret) {
		return Response.json(
			{ error: "GitHub webhooks are not configured" },
			{ status: 503 },
		);
	}
	return handleGitHubWebhookRequest(request, {
		getDatabase: async () => (await import("../db.js")).sqlClient,
		onRefreshScheduled:
			onRefreshScheduled ??
			((delayMs) => {
				import("../services/github-evidence-worker.service.js")
					.then(({ wakeGitHubEvidenceWorker }) =>
						wakeGitHubEvidenceWorker(delayMs),
					)
					.catch(() => {
						// The refresh is durable; the next maintenance pass picks it up.
					});
			}),
		secret,
	});
}

function accepted(outcome: string): Response {
	return Response.json({ outcome }, { status: 202 });
}

async function readRequestBytesWithinLimit(
	request: Request,
	limitBytes: number,
): Promise<Uint8Array | null> {
	if (!request.body) return new Uint8Array();
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		totalBytes += value.byteLength;
		if (totalBytes > limitBytes) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks);
}
