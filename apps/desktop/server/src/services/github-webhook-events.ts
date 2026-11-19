import { createHmac, timingSafeEqual } from "node:crypto";
import {
	type SweepCheck,
	type SweepPullRequest,
	type SweepRun,
	type SweepStatus,
	sweepCheckSchema,
	sweepPullRequestSchema,
	sweepRunSchema,
	sweepStatusSchema,
} from "@rudel/repo-intelligence-source-github";
import { z } from "zod";

export type GitHubOutcomeEvent =
	| { kind: "pull_request"; data: SweepPullRequest }
	| { kind: "actions_run"; data: SweepRun }
	| { kind: "check_suite"; data: SweepCheck }
	| { kind: "status"; data: SweepStatus };

/**
 * Pure GitHub App webhook handling: signature verification and the mapping
 * from a verified event onto a small intent that the delivery ledger applies
 * to the existing evidence collection queue. Nothing here touches a database
 * or GitHub, so a new event (for example `pull_request_review` or `push`) is
 * one entry in GITHUB_WEBHOOK_HANDLERS plus, if needed, one intent kind.
 */

const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/u;
const MIN_WEBHOOK_SECRET_LENGTH = 32;

export const GITHUB_WEBHOOK_DELIVERY_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/u;
export const GITHUB_WEBHOOK_EVENT_PATTERN = /^[a-z_]{1,64}$/u;

export type GitHubWebhookIntent =
	| {
			/** Re-collect session-linked evidence for these commits or pull requests. */
			readonly kind: "refresh";
			readonly installationId: string;
			readonly repositoryId: string;
			readonly commitShas: readonly string[];
			readonly pullRequestIds: readonly string[];
			readonly outcome?: GitHubOutcomeEvent;
			readonly refreshSessionEvidence?: boolean;
	  }
	| {
			readonly kind: "installation";
			readonly installationId: string;
			readonly change: "deleted" | "suspended" | "unsuspended";
	  }
	| {
			readonly kind: "installation_permissions";
			readonly installationId: string;
			readonly permissions: Readonly<Record<string, string>>;
	  }
	| {
			readonly kind: "repositories_removed";
			readonly installationId: string;
			readonly repositoryIds: readonly string[];
	  };

export interface GitHubWebhookEvent {
	readonly action: string;
	readonly intent: GitHubWebhookIntent;
}

type GitHubWebhookHandler = (payload: unknown) => GitHubWebhookEvent | null;

const githubId = z
	.number()
	.int()
	.positive()
	.max(Number.MAX_SAFE_INTEGER)
	.transform(String);
const commitSha = z.string().regex(/^[0-9a-f]{40}$/u);
const reference = z.object({ id: githubId });
const action = z.string().min(1).max(64);

const PULL_REQUEST_ACTIONS = new Set([
	"closed",
	"converted_to_draft",
	"opened",
	"ready_for_review",
	"reopened",
	"synchronize",
]);

const pullRequestPayload = z.object({
	action,
	installation: reference,
	repository: reference,
	pull_request: z.object({ id: githubId, head: z.object({ sha: commitSha }) }),
});
const checkSuitePayload = z.object({
	action,
	installation: reference,
	repository: reference,
	check_suite: z.object({ head_sha: commitSha }),
});
const workflowRunPayload = z.object({
	action,
	installation: reference,
	repository: reference,
	workflow_run: z.object({ head_sha: commitSha }),
});
const statusPayload = z.object({
	state: z.enum(["error", "failure", "success", "pending"]),
	installation: reference,
	repository: reference,
	sha: commitSha,
});
const installationPayload = z.object({
	action,
	installation: z.object({
		id: githubId,
		permissions: z.record(z.string(), z.unknown()).optional(),
	}),
});
const installationRepositoriesPayload = z.object({
	action: z.literal("removed"),
	installation: reference,
	repositories_removed: z.array(reference).min(1),
});

const INSTALLATION_CHANGES: ReadonlyMap<
	string,
	"deleted" | "suspended" | "unsuspended"
> = new Map([
	["deleted", "deleted"],
	["suspend", "suspended"],
	["unsuspend", "unsuspended"],
]);

function refreshCommit(
	parsed: {
		readonly installation: { readonly id: string };
		readonly repository: { readonly id: string };
	},
	eventAction: string,
	sha: string,
): GitHubWebhookEvent {
	return {
		action: eventAction,
		intent: {
			kind: "refresh",
			installationId: parsed.installation.id,
			repositoryId: parsed.repository.id,
			commitShas: [sha],
			pullRequestIds: [],
		},
	};
}

/**
 * Subscribed events. `check_run` is deliberately absent: it fires once per job,
 * and `check_suite.completed` / `workflow_run.completed` already signal the
 * moment a commit's checks settle. Installation creation and added
 * repositories are ignored because a binding requires the verified setup flow,
 * which intersects the installation with the administrator's own access.
 */
export const GITHUB_WEBHOOK_HANDLERS: Readonly<
	Record<string, GitHubWebhookHandler>
> = {
	pull_request(payload) {
		const parsed = pullRequestPayload.safeParse(payload);
		if (
			!parsed.success ||
			(!PULL_REQUEST_ACTIONS.has(parsed.data.action) &&
				!outcomeEvent("pull_request", payload).outcome)
		)
			return null;
		return {
			action: parsed.data.action,
			intent: {
				kind: "refresh",
				installationId: parsed.data.installation.id,
				repositoryId: parsed.data.repository.id,
				commitShas: [parsed.data.pull_request.head.sha],
				pullRequestIds: [parsed.data.pull_request.id],
				...outcomeEvent("pull_request", payload),
				...(!PULL_REQUEST_ACTIONS.has(parsed.data.action)
					? { refreshSessionEvidence: false }
					: {}),
			},
		};
	},
	check_suite(payload) {
		const parsed = checkSuitePayload.safeParse(payload);
		return parsed.success &&
			(parsed.data.action === "completed" ||
				outcomeEvent("check_suite", payload).outcome)
			? withOutcome(
					refreshCommit(
						parsed.data,
						parsed.data.action,
						parsed.data.check_suite.head_sha,
					),
					"check_suite",
					payload,
				)
			: null;
	},
	workflow_run(payload) {
		const parsed = workflowRunPayload.safeParse(payload);
		return parsed.success &&
			(parsed.data.action === "completed" ||
				outcomeEvent("actions_run", payload).outcome)
			? withOutcome(
					refreshCommit(
						parsed.data,
						parsed.data.action,
						parsed.data.workflow_run.head_sha,
					),
					"actions_run",
					payload,
				)
			: null;
	},
	status(payload) {
		const parsed = statusPayload.safeParse(payload);
		return parsed.success &&
			(parsed.data.state !== "pending" ||
				outcomeEvent("status", payload).outcome)
			? withOutcome(
					refreshCommit(parsed.data, parsed.data.state, parsed.data.sha),
					"status",
					payload,
				)
			: null;
	},
	installation(payload) {
		const parsed = installationPayload.safeParse(payload);
		if (!parsed.success) return null;
		const installationId = parsed.data.installation.id;
		if (parsed.data.action === "new_permissions_accepted") {
			const permissions = Object.fromEntries(
				Object.entries(parsed.data.installation.permissions ?? {}).filter(
					(entry): entry is [string, string] => typeof entry[1] === "string",
				),
			);
			return {
				action: parsed.data.action,
				intent: {
					kind: "installation_permissions",
					installationId,
					permissions,
				},
			};
		}
		const change = INSTALLATION_CHANGES.get(parsed.data.action);
		return change
			? {
					action: parsed.data.action,
					intent: { kind: "installation", installationId, change },
				}
			: null;
	},
	installation_repositories(payload) {
		const parsed = installationRepositoriesPayload.safeParse(payload);
		if (!parsed.success) return null;
		return {
			action: parsed.data.action,
			intent: {
				kind: "repositories_removed",
				installationId: parsed.data.installation.id,
				repositoryIds: parsed.data.repositories_removed.map(({ id }) => id),
			},
		};
	},
};

function withOutcome(
	event: GitHubWebhookEvent,
	kind: GitHubOutcomeEvent["kind"],
	payload: unknown,
): GitHubWebhookEvent {
	return event.intent.kind === "refresh"
		? {
				...event,
				intent: {
					...event.intent,
					...outcomeEvent(kind, payload),
					...(((kind === "actions_run" || kind === "check_suite") &&
						event.action !== "completed") ||
					(kind === "status" && event.action === "pending")
						? { refreshSessionEvidence: false }
						: {}),
				},
			}
		: event;
}

function outcomeEvent(
	kind: GitHubOutcomeEvent["kind"],
	payload: unknown,
): { outcome?: GitHubOutcomeEvent } {
	const envelope = z
		.object({
			pull_request: z.unknown().optional(),
			workflow_run: z.unknown().optional(),
			check_suite: z.unknown().optional(),
		})
		.safeParse(payload);
	if (!envelope.success) return {};
	if (kind === "pull_request") {
		const result = sweepPullRequestSchema.safeParse(envelope.data.pull_request);
		return result.success ? { outcome: { kind, data: result.data } } : {};
	}
	if (kind === "actions_run") {
		const result = sweepRunSchema.safeParse(envelope.data.workflow_run);
		return result.success ? { outcome: { kind, data: result.data } } : {};
	}
	if (kind === "check_suite") {
		const result = sweepCheckSchema.safeParse(envelope.data.check_suite);
		return result.success ? { outcome: { kind, data: result.data } } : {};
	}
	const result = sweepStatusSchema.safeParse(payload);
	return result.success ? { outcome: { kind, data: result.data } } : {};
}

export function mapGitHubWebhookEvent(
	event: string,
	payload: unknown,
): GitHubWebhookEvent | null {
	const handler = Object.hasOwn(GITHUB_WEBHOOK_HANDLERS, event)
		? GITHUB_WEBHOOK_HANDLERS[event]
		: undefined;
	return handler ? handler(payload) : null;
}

/** Verifies `X-Hub-Signature-256` over the exact request bytes. */
export function verifyGitHubWebhookSignature(input: {
	readonly body: Uint8Array;
	readonly secret: string;
	readonly signature: string | null;
}): boolean {
	const match = SIGNATURE_PATTERN.exec(input.signature ?? "");
	if (!match?.[1]) return false;
	const expected = createHmac("sha256", input.secret)
		.update(input.body)
		.digest();
	return timingSafeEqual(expected, Buffer.from(match[1], "hex"));
}

export function readGitHubWebhookSecret(
	environment: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
	const secret = environment.GITHUB_REPOSITORY_APP_WEBHOOK_SECRET?.trim();
	if (!secret) return null;
	if (secret.length < MIN_WEBHOOK_SECRET_LENGTH) {
		throw new Error(
			`GITHUB_REPOSITORY_APP_WEBHOOK_SECRET must contain at least ${MIN_WEBHOOK_SECRET_LENGTH} characters`,
		);
	}
	return secret;
}
