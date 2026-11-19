import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
	GITHUB_WEBHOOK_PATH,
	type GitHubWebhookRequestDependencies,
	handleGitHubWebhookRequest,
} from "./github-webhook-http.js";

const secret = "h".repeat(64);
const url = `https://api.example.test${GITHUB_WEBHOOK_PATH}`;

// Every path exercised here must answer before a database is needed.
const withoutDatabase: GitHubWebhookRequestDependencies = {
	getDatabase: () => {
		throw new Error("The database must not be touched");
	},
	onRefreshScheduled: () => {
		throw new Error("No refresh may be scheduled");
	},
	secret,
};

function signedRequest(input: {
	readonly body: string;
	readonly delivery?: string;
	readonly event?: string;
	readonly signature?: string;
}): Request {
	const headers = new Headers({ "content-type": "application/json" });
	headers.set(
		"x-hub-signature-256",
		input.signature ??
			`sha256=${createHmac("sha256", secret).update(input.body).digest("hex")}`,
	);
	if (input.delivery !== "") {
		headers.set("x-github-delivery", input.delivery ?? crypto.randomUUID());
	}
	if (input.event !== "") headers.set("x-github-event", input.event ?? "ping");
	return new Request(url, { body: input.body, headers, method: "POST" });
}

describe("GitHub webhook endpoint", () => {
	test("accepts POST only", async () => {
		const response = await handleGitHubWebhookRequest(
			new Request(url),
			withoutDatabase,
		);
		expect(response.status).toBe(405);
		expect(response.headers.get("Allow")).toBe("POST");
	});

	test("rejects unsigned and mis-signed deliveries before reading state", async () => {
		const unsigned = await handleGitHubWebhookRequest(
			new Request(url, { body: "{}", method: "POST" }),
			withoutDatabase,
		);
		expect(unsigned.status).toBe(401);
		expect(await unsigned.json()).toEqual({
			error: "Missing GitHub signature",
		});

		const forged = await handleGitHubWebhookRequest(
			signedRequest({
				body: '{"action":"closed"}',
				event: "pull_request",
				signature: `sha256=${"0".repeat(64)}`,
			}),
			withoutDatabase,
		);
		expect(forged.status).toBe(401);
		expect(await forged.json()).toEqual({ error: "Invalid GitHub signature" });
	});

	test("rejects bodies over the payload ceiling", async () => {
		const response = await handleGitHubWebhookRequest(
			signedRequest({ body: "x".repeat(5 * 1024 * 1024 + 1) }),
			withoutDatabase,
		);
		expect(response.status).toBe(413);
	});

	test("requires delivery identity headers on signed deliveries", async () => {
		for (const headers of [
			{ delivery: "" },
			{ event: "" },
			{ delivery: "../../etc" },
			{ event: "Pull-Request" },
		]) {
			const response = await handleGitHubWebhookRequest(
				signedRequest({ body: "{}", ...headers }),
				withoutDatabase,
			);
			expect(response.status).toBe(400);
		}
	});

	test("rejects signed bodies that are not JSON", async () => {
		const response = await handleGitHubWebhookRequest(
			signedRequest({ body: "not json", event: "pull_request" }),
			withoutDatabase,
		);
		expect(response.status).toBe(400);
	});

	test("acknowledges pings and unsubscribed actions without storing anything", async () => {
		for (const input of [
			{ body: '{"zen":"Speak like a human."}', event: "ping" },
			{ body: '{"action":"created"}', event: "check_run" },
			{ body: '{"action":"labeled"}', event: "pull_request" },
		]) {
			const response = await handleGitHubWebhookRequest(
				signedRequest(input),
				withoutDatabase,
			);
			expect(response.status).toBe(202);
			expect(await response.json()).toEqual({ outcome: "ignored" });
		}
	});
});
