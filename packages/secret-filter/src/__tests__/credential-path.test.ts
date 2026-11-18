import { describe, expect, test } from "bun:test";
import { isHighRiskCredentialPath } from "../index.js";

describe("isHighRiskCredentialPath", () => {
	const highRisk = [
		".env",
		".env.local",
		".env.production",
		"config/.env.production",
		"apps/web/.ENV",
		".npmrc",
		".netrc",
		".pypirc",
		"deploy/credentials.json",
		"Service-Account.json",
		"home/.ssh/id_rsa",
		"home/.ssh/ID_ED25519",
		"certs/server.pem",
		"certs/SERVER.PEM",
		"keys/signing.key",
		"store/cert.p12",
		"store/cert.pfx",
		"a\\b\\.env",
	];
	for (const path of highRisk) {
		test(`classifies ${path} as high risk`, () => {
			expect(isHighRiskCredentialPath(path)).toBe(true);
		});
	}

	const allowed = [
		".env.example",
		"config/.ENV.Sample",
		".env.template",
		"src/environment.ts",
		"src/env.ts",
		"docs/id_rsa.md",
		"README.md",
		"src/keys.ts",
		"package.json",
	];
	for (const path of allowed) {
		test(`does not classify ${path} as high risk`, () => {
			expect(isHighRiskCredentialPath(path)).toBe(false);
		});
	}
});
