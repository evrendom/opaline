const TEMPLATE_ENV_FILE_NAMES: ReadonlySet<string> = new Set([
	".env.example",
	".env.sample",
	".env.template",
]);
const CREDENTIAL_FILE_NAMES: ReadonlySet<string> = new Set([
	".env",
	".npmrc",
	".netrc",
	".pypirc",
	"credentials.json",
	"service-account.json",
	"id_rsa",
	"id_ed25519",
]);
const CREDENTIAL_FILE_EXTENSIONS: readonly string[] = [
	".pem",
	".key",
	".p12",
	".pfx",
];

/**
 * High-risk credential file policy shared by every collector that decides
 * whether file content (local files, git diffs, GitHub pull-request patches)
 * may be captured. The decision is made on the final path segment and is
 * case-insensitive; `.env.example`, `.env.sample` and `.env.template` are
 * allowed because they hold placeholders by convention.
 */
export function isHighRiskCredentialPath(path: string): boolean {
	const name = getLowerCaseBaseName(path);
	if (TEMPLATE_ENV_FILE_NAMES.has(name)) return false;
	return (
		CREDENTIAL_FILE_NAMES.has(name) ||
		name.startsWith(".env.") ||
		CREDENTIAL_FILE_EXTENSIONS.some((extension) => name.endsWith(extension))
	);
}

function getLowerCaseBaseName(path: string): string {
	const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "");
	return normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
}
