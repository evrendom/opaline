import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
	GITHUB_WEBHOOK_HANDLERS,
	type GitHubWebhookIntent,
	mapGitHubWebhookEvent,
	readGitHubWebhookSecret,
	verifyGitHubWebhookSignature,
} from "./github-webhook-events.js";

const secret = "w".repeat(64);
const headSha = "a".repeat(40);
const body = new TextEncoder().encode('{"zen":"Keep it logically awesome."}');

function sign(bytes: Uint8Array, key = secret): string {
	return `sha256=${createHmac("sha256", key).update(bytes).digest("hex")}`;
}

const scope = { installation: { id: 42 }, repository: { id: 7 } };

describe("GitHub webhook signature", () => {
	test("accepts the HMAC-SHA256 of the exact body bytes", () => {
		expect(
			verifyGitHubWebhookSignature({ body, secret, signature: sign(body) }),
		).toBe(true);
	});

	test("rejects missing, malformed, wrong-secret and tampered signatures", () => {
		const tampered = new TextEncoder().encode(
			'{"zen":"Keep it logically awesome!"}',
		);
		for (const signature of [
			null,
			"",
			sign(body).replace("sha256=", "sha1="),
			sign(body).toUpperCase(),
			`${sign(body)}00`,
			sign(body, "x".repeat(64)),
			sign(tampered),
		]) {
			expect(verifyGitHubWebhookSignature({ body, secret, signature })).toBe(
				false,
			);
		}
	});

	test("reads an optional secret of at least 32 characters", () => {
		expect(readGitHubWebhookSecret({})).toBeNull();
		expect(
			readGitHubWebhookSecret({ GITHUB_REPOSITORY_APP_WEBHOOK_SECRET: " " }),
		).toBeNull();
		expect(
			readGitHubWebhookSecret({
				GITHUB_REPOSITORY_APP_WEBHOOK_SECRET: ` ${secret} `,
			}),
		).toBe(secret);
		expect(() =>
			readGitHubWebhookSecret({
				GITHUB_REPOSITORY_APP_WEBHOOK_SECRET: "short",
			}),
		).toThrow("at least 32 characters");
	});
});

describe("GitHub webhook event mapping", () => {
	test("maps pull request lifecycle events to a refresh by head SHA and PR id", () => {
		for (const action of [
			"opened",
			"reopened",
			"synchronize",
			"closed",
			"ready_for_review",
			"converted_to_draft",
		]) {
			expect(
				mapGitHubWebhookEvent("pull_request", {
					...scope,
					action,
					pull_request: { id: 9001, head: { sha: headSha } },
				}),
			).toEqual({
				action,
				intent: {
					kind: "refresh",
					installationId: "42",
					repositoryId: "7",
					commitShas: [headSha],
					pullRequestIds: ["9001"],
				},
			});
		}
		expect(
			mapGitHubWebhookEvent("pull_request", {
				...scope,
				action: "labeled",
				pull_request: { id: 9001, head: { sha: headSha } },
			}),
		).toBeNull();
	});

	test("maps settled CI signals to a refresh of the exact commit", () => {
		const refresh: GitHubWebhookIntent = {
			kind: "refresh",
			installationId: "42",
			repositoryId: "7",
			commitShas: [headSha],
			pullRequestIds: [],
		};
		expect(
			mapGitHubWebhookEvent("check_suite", {
				...scope,
				action: "completed",
				check_suite: { head_sha: headSha },
			}),
		).toEqual({ action: "completed", intent: refresh });
		expect(
			mapGitHubWebhookEvent("workflow_run", {
				...scope,
				action: "completed",
				workflow_run: { head_sha: headSha },
			}),
		).toEqual({ action: "completed", intent: refresh });
		expect(
			mapGitHubWebhookEvent("status", {
				...scope,
				state: "failure",
				sha: headSha,
			}),
		).toEqual({ action: "failure", intent: refresh });
		expect(
			mapGitHubWebhookEvent("check_suite", {
				...scope,
				action: "requested",
				check_suite: { head_sha: headSha },
			}),
		).toBeNull();
		expect(
			mapGitHubWebhookEvent("status", {
				...scope,
				state: "pending",
				sha: headSha,
			}),
		).toBeNull();
	});

	test("maps installation state changes and removed repositories", () => {
		expect(
			mapGitHubWebhookEvent("installation", {
				action: "deleted",
				installation: { id: 42 },
				repositories: [{ id: 7 }],
			}),
		).toEqual({
			action: "deleted",
			intent: { kind: "installation", installationId: "42", change: "deleted" },
		});
		expect(
			mapGitHubWebhookEvent("installation", {
				action: "suspend",
				installation: { id: 42 },
			})?.intent,
		).toEqual({
			kind: "installation",
			installationId: "42",
			change: "suspended",
		});
		expect(
			mapGitHubWebhookEvent("installation", {
				action: "unsuspend",
				installation: { id: 42 },
			})?.intent,
		).toEqual({
			kind: "installation",
			installationId: "42",
			change: "unsuspended",
		});
		expect(
			mapGitHubWebhookEvent("installation", {
				action: "new_permissions_accepted",
				installation: {
					id: 42,
					permissions: { checks: "read", nested: { ignored: true } },
				},
			})?.intent,
		).toEqual({
			kind: "installation_permissions",
			installationId: "42",
			permissions: { checks: "read" },
		});
		expect(
			mapGitHubWebhookEvent("installation_repositories", {
				action: "removed",
				installation: { id: 42 },
				repositories_removed: [{ id: 7 }, { id: 8 }],
			}),
		).toEqual({
			action: "removed",
			intent: {
				kind: "repositories_removed",
				installationId: "42",
				repositoryIds: ["7", "8"],
			},
		});
	});

	test("ignores installation creation and added repositories, which require the verified setup flow", () => {
		expect(
			mapGitHubWebhookEvent("installation", {
				action: "created",
				installation: { id: 42 },
			}),
		).toBeNull();
		expect(
			mapGitHubWebhookEvent("installation_repositories", {
				action: "added",
				installation: { id: 42 },
				repositories_added: [{ id: 7 }],
				repositories_removed: [],
			}),
		).toBeNull();
	});

	test("drops unknown events, prototype keys and malformed payloads", () => {
		expect(Object.keys(GITHUB_WEBHOOK_HANDLERS).sort()).toEqual([
			"check_suite",
			"installation",
			"installation_repositories",
			"pull_request",
			"status",
			"workflow_run",
		]);
		for (const event of [
			"ping",
			"check_run",
			"push",
			"constructor",
			"__proto__",
		]) {
			expect(
				mapGitHubWebhookEvent(event, { ...scope, action: "completed" }),
			).toBeNull();
		}
		for (const payload of [
			null,
			[],
			{
				...scope,
				action: "opened",
				pull_request: { id: 1, head: { sha: "HEAD" } },
			},
			{
				action: "opened",
				repository: { id: 7 },
				pull_request: { id: 1, head: { sha: headSha } },
			},
			{
				...scope,
				installation: { id: "42" },
				action: "opened",
				pull_request: { id: 1, head: { sha: headSha } },
			},
			{
				...scope,
				repository: { id: -1 },
				action: "opened",
				pull_request: { id: 1, head: { sha: headSha } },
			},
		]) {
			expect(mapGitHubWebhookEvent("pull_request", payload)).toBeNull();
		}
	});
});
