import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
	assertGitHubRepositoryEvidencePermissions,
	createGitHubAppJwt,
	createGitHubInstallationUrl,
	createGitHubInstallState,
	createGitHubUserAuthorizationUrl,
	readGitHubInstallationStateSecret,
	readGitHubRepositoryAppUserAuthorizationConfig,
	verifyGitHubAppJwtForTests,
	verifyGitHubInstallState,
	verifyGitHubUserAuthorizationState,
} from "./github-app.service.js";

const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = key.privateKey
	.export({
		format: "pem",
		type: "pkcs8",
	})
	.toString();
const config = { appId: "12345", privateKeyPem, slug: "opaline-evidence" };
const secret = "s".repeat(64);
const now = new Date("2026-09-19T12:00:00.000Z");

describe("GitHub App authentication", () => {
	test("creates a short-lived, valid RS256 app JWT", () => {
		const jwt = createGitHubAppJwt(config, now);
		expect(verifyGitHubAppJwtForTests(jwt, privateKeyPem)).toBe(true);
		const [, encodedPayload] = jwt.split(".");
		const payload = JSON.parse(
			Buffer.from(encodedPayload ?? "", "base64url").toString("utf8"),
		);
		expect(payload).toEqual({
			exp: 1789819710,
			iat: 1789819170,
			iss: "12345",
		});
	});

	test("round trips a signed organization installation state", () => {
		const state = createGitHubInstallState({
			nonce: "n".repeat(18),
			now,
			organizationId: "organization-1",
			stateSecret: secret,
			userId: "user-1",
			workspaceSlug: "acme",
		});
		expect(
			verifyGitHubInstallState({ now, state, stateSecret: secret }),
		).toEqual({
			organizationId: "organization-1",
			userId: "user-1",
			workspaceSlug: "acme",
		});
	});

	test("rejects tampered and expired installation state", () => {
		const state = createGitHubInstallState({
			nonce: "n".repeat(18),
			now,
			organizationId: "organization-1",
			stateSecret: secret,
			userId: "user-1",
			workspaceSlug: "acme",
		});
		expect(() =>
			verifyGitHubInstallState({
				now,
				state: `${state.slice(0, -1)}x`,
				stateSecret: secret,
			}),
		).toThrow("signature");
		expect(() =>
			verifyGitHubInstallState({
				now: new Date("2026-09-19T12:16:00.000Z"),
				state,
				stateSecret: secret,
			}),
		).toThrow("expired");
	});

	test("builds the GitHub installation URL without exposing state contents", () => {
		const url = new URL(
			createGitHubInstallationUrl({
				config,
				nonce: "n".repeat(18),
				now,
				organizationId: "organization-1",
				stateSecret: secret,
				userId: "user-1",
				workspaceSlug: "acme",
			}),
		);
		expect(url.origin).toBe("https://github.com");
		expect(url.pathname).toBe("/apps/opaline-evidence/installations/new");
		expect(url.searchParams.get("state")).not.toContain("organization-1");
	});

	test("binds GitHub user authorization to the exact installation with PKCE", () => {
		const url = new URL(
			createGitHubUserAuthorizationUrl({
				config: {
					callbackUrl: "https://api.opaline.so/api/github/setup",
					clientId: "Iv1.example",
					clientSecret: "not-sent-to-the-browser",
				},
				installationId: "24680",
				nonce: "n".repeat(18),
				now,
				organizationId: "organization-1",
				stateSecret: secret,
				userId: "user-1",
				workspaceSlug: "acme",
			}),
		);
		expect(url.origin).toBe("https://github.com");
		expect(url.pathname).toBe("/login/oauth/authorize");
		expect(url.searchParams.get("client_id")).toBe("Iv1.example");
		expect(url.searchParams.get("redirect_uri")).toBe(
			"https://api.opaline.so/api/github/setup",
		);
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("code_challenge")).toHaveLength(43);
		expect(
			verifyGitHubUserAuthorizationState({
				now,
				state: url.searchParams.get("state") ?? "",
				stateSecret: secret,
			}),
		).toEqual({
			installationId: "24680",
			organizationId: "organization-1",
			userId: "user-1",
			workspaceSlug: "acme",
		});
		expect(() =>
			verifyGitHubInstallState({
				now,
				state: url.searchParams.get("state") ?? "",
				stateSecret: secret,
			}),
		).toThrow("payload");
	});

	test("requires every read-only repository evidence permission", () => {
		const permissions = {
			actions: "read",
			checks: "read",
			contents: "read",
			metadata: "read",
			pull_requests: "read",
			statuses: "read",
		};
		expect(() =>
			assertGitHubRepositoryEvidencePermissions(permissions),
		).not.toThrow();
		for (const permission of [
			"actions",
			"checks",
			"contents",
			"metadata",
			"pull_requests",
			"statuses",
		] as const) {
			expect(() =>
				assertGitHubRepositoryEvidencePermissions({
					...permissions,
					[permission]: "none",
				}),
			).toThrow(permission);
		}
	});

	test("uses a dedicated installation-state secret with a safe auth fallback", () => {
		expect(
			readGitHubInstallationStateSecret({
				BETTER_AUTH_SECRET: "b".repeat(32),
				GITHUB_REPOSITORY_APP_STATE_SECRET: "g".repeat(32),
			}),
		).toBe("g".repeat(32));
		expect(
			readGitHubInstallationStateSecret({
				BETTER_AUTH_SECRET: "b".repeat(32),
			}),
		).toBe("b".repeat(32));
	});

	test("requires a complete repository App user authorization configuration", () => {
		expect(
			readGitHubRepositoryAppUserAuthorizationConfig({
				GITHUB_REPOSITORY_APP_CALLBACK_URL:
					"https://api.opaline.so/api/github/setup",
				GITHUB_REPOSITORY_APP_CLIENT_ID: "Iv1.example",
				GITHUB_REPOSITORY_APP_CLIENT_SECRET: "client-secret",
			}),
		).toEqual({
			callbackUrl: "https://api.opaline.so/api/github/setup",
			clientId: "Iv1.example",
			clientSecret: "client-secret",
		});
		expect(() =>
			readGitHubRepositoryAppUserAuthorizationConfig({
				GITHUB_REPOSITORY_APP_CLIENT_ID: "Iv1.example",
			}),
		).toThrow("CLIENT_SECRET");
	});
});
