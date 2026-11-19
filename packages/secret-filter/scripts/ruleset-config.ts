export const GITLEAKS_VERSION = "v8.30.1";
export const GITLEAKS_CONFIG_SHA256 =
	"e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf";
export const GITLEAKS_CONFIG_URL = `https://raw.githubusercontent.com/gitleaks/gitleaks/${GITLEAKS_VERSION}/config/gitleaks.toml`;

/** Rules that are not adapted from Gitleaks use this source id. */
export const LOCAL_RULE_SOURCE_ID = "opaline";

export interface SelectedRule {
	readonly sourceId: string;
	readonly ruleId: string;
	readonly secretGroup: number;
	readonly regexOverride?: string;
	/** Extra allowlist patterns, matched against the secret group. */
	readonly allowlistRegexes?: readonly string[];
	/**
	 * Lowercase literals of which at least one occurs, ignoring case, in every
	 * match; text without any of them skips the rule. Required with a regex
	 * override, otherwise taken from Gitleaks.
	 */
	readonly keywords?: readonly string[];
}

/**
 * Gitleaks scans decoded files; Opaline scans transcripts, which are JSON, so a
 * secret usually sits inside a JSON string, next to escape sequences. The
 * filter matches a view of the text in which escaped line breaks and tabs
 * (`\n`, and `\\n` one JSON level deeper) are spaces, so `\b` and `\s` work
 * as in a decoded file. A secret inside quotes is still followed by `\"`, so
 * the generator rewrites Gitleaks' trailing delimiter group to one that
 * accepts any backslash.
 */
export const GITLEAKS_TRAILING_DELIMITER = String.raw`(?:[\x60'"\s;]|\\[nr]|$)`;
export const ESCAPE_AWARE_TRAILING_DELIMITER = String.raw`(?:[\x60'"\s;]|\\|$)`;

const PEM_BASE64 = "[A-Za-z0-9+/=]";
const PEM_HEADER = "-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----";
const PEM_FOOTER = "-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----";
/** Base64 lines separated by whitespace. */
const PEM_LINES = `(?:\\s+${PEM_BASE64}+)*`;
/** Unquoted name/value separators in env files, YAML, JSON, INI and shells. */
const ASSIGNMENT = String.raw`\\*["']?(?:[ \t]*(?::=|=>|[:=])[ \t]*|[ \t]+)\\*["']?`;

/**
 * Generated rules, in the order they are applied. Order matters: a later rule
 * sees the markers of earlier ones (`[REDACTED:aws-access-key-id]` next to a
 * secret key, a token inside a connection string).
 */
export const SELECTED_RULES: readonly SelectedRule[] = [
	{
		// Gitleaks pins one key length and the `admin01` version.
		sourceId: "anthropic-admin-api-key",
		ruleId: "anthropic-admin-api-key",
		secretGroup: 1,
		regexOverride: `\\b(sk-ant-admin\\d{2}-[A-Za-z0-9_-]{32,})`,
		keywords: ["sk-ant-admin"],
	},
	{
		// Also Claude Code OAuth access/refresh tokens (`oat`, `ort`) and
		// claude.ai session keys (`sid`), which Gitleaks does not cover.
		sourceId: "anthropic-api-key",
		ruleId: "anthropic-api-key",
		secretGroup: 1,
		regexOverride: `\\b(sk-ant-(?:api|oat|ort|sid)\\d{2}-[A-Za-z0-9_-]{32,})`,
		keywords: ["sk-ant-"],
	},
	{
		// An AWS secret access key (40 mixed-case base64 characters, so not a
		// hex digest) next to its access key id (CSV exports, `id secret`
		// pairs). Runs before the id rule so a custom redaction
		// marker cannot hide the id; Opaline's own marker is accepted too, for
		// text an older filter already processed.
		sourceId: LOCAL_RULE_SOURCE_ID,
		ruleId: "aws-secret-access-key-pair",
		secretGroup: 1,
		regexOverride: String.raw`(?:\[REDACTED:aws-access-key-id(?::[0-9a-f]{1,64})?\]|(?:AKIA|ASIA)[A-Z2-7]{16}(?![A-Za-z0-9]))(?:[\s,;:|'"=]|\\+"){1,8}((?=[A-Za-z0-9/+]{0,39}[a-z])(?=[A-Za-z0-9/+]{0,39}[A-Z])[A-Za-z0-9/+]{40})(?![A-Za-z0-9/+=])`,
		allowlistRegexes: ["EXAMPLE"],
		keywords: ["akia", "asia", "[redacted:aws-access-key-id"],
	},
	{
		sourceId: "aws-access-token",
		ruleId: "aws-access-key-id",
		secretGroup: 1,
	},
	{
		// The value of a name that says "AWS secret (access) key" or "secret
		// access key" (AWS_SECRET_ACCESS_KEY, aws_secret_access_key,
		// SecretAccessKey, R2_SECRET_ACCESS_KEY): any length, since the name
		// alone identifies it.
		sourceId: LOCAL_RULE_SOURCE_ID,
		ruleId: "aws-secret-access-key",
		secretGroup: 1,
		regexOverride: `(?i)(?:aws[_.-]?secret(?:[_.-]?access)?[_.-]?key|secret[_. -]?access[_. -]?key)${ASSIGNMENT}([A-Za-z0-9/+=]{16,128})(?![A-Za-z0-9/+=_-])`,
		allowlistRegexes: ["EXAMPLE"],
		keywords: ["secret"],
	},
	{
		sourceId: "gcp-api-key",
		ruleId: "google-api-key",
		secretGroup: 1,
	},
	{
		sourceId: "github-app-token",
		ruleId: "github-app-token",
		secretGroup: 0,
	},
	{
		sourceId: "github-fine-grained-pat",
		ruleId: "github-fine-grained-pat",
		secretGroup: 0,
	},
	{
		sourceId: "github-oauth",
		ruleId: "github-oauth",
		secretGroup: 0,
	},
	{
		sourceId: "github-pat",
		ruleId: "github-pat",
		secretGroup: 0,
	},
	{
		sourceId: "gitlab-pat",
		ruleId: "gitlab-pat",
		secretGroup: 0,
	},
	{
		// Header and payload are base64url JSON objects (`{"` encodes as eyJ);
		// a signature is required, so unsigned example tokens stay readable.
		// Gitleaks relies on an entropy check this filter does not run.
		sourceId: "jwt",
		ruleId: "jwt",
		secretGroup: 1,
		regexOverride: `\\b(eyJ[A-Za-z0-9_-]{15,}\\.eyJ[A-Za-z0-9_-]{15,}\\.[A-Za-z0-9_-]{16,})`,
		keywords: ["eyj"],
	},
	{
		sourceId: "npm-access-token",
		ruleId: "npm-access-token",
		secretGroup: 1,
	},
	{
		// Gitleaks requires the T3BlbkFJ marker at fixed offsets; project,
		// service-account and admin keys vary in length, and legacy keys are 48
		// characters with or without the marker.
		sourceId: "openai-api-key",
		ruleId: "openai-api-key",
		secretGroup: 1,
		regexOverride: `\\b(sk-(?:proj|svcacct|admin|None)-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}(?![A-Za-z0-9_-]))`,
		keywords: ["sk-"],
	},
	{
		// Also a key cut off by the end of a JSON string (a block split over
		// several JSON fields), and escaped line breaks at any JSON depth.
		sourceId: "private-key",
		ruleId: "private-key",
		secretGroup: 0,
		regexOverride: `(?i)${PEM_HEADER}(?:[A-Za-z0-9+/=\\s-]{64,}?KEY(?: BLOCK)?-----|[A-Za-z0-9+/=\\s-]+\\\\*$|\\s*${PEM_BASE64}{40,}${PEM_LINES}\\s*(?=\\\\*["']))`,
		keywords: ["-----begin"],
	},
	{
		// The tail of a key whose header sits in another JSON string: at least
		// one full base64 line (padding only at its end), starting a string or
		// a line, before an END PRIVATE KEY footer.
		sourceId: LOCAL_RULE_SOURCE_ID,
		ruleId: "private-key-fragment",
		secretGroup: 1,
		regexOverride: `(?i)(?:^|["'\\s])([A-Za-z0-9+/]{64,}={0,2}${PEM_LINES}\\s*${PEM_FOOTER})`,
		keywords: ["-----end"],
	},
	{
		sourceId: "sendgrid-api-token",
		ruleId: "sendgrid-api-token",
		secretGroup: 1,
	},
	{
		sourceId: "slack-bot-token",
		ruleId: "slack-bot-token",
		secretGroup: 0,
	},
	{
		sourceId: "slack-user-token",
		ruleId: "slack-user-token",
		secretGroup: 0,
	},
	{
		// Gitleaks' keyword is hooks.slack.com, but the dots in the regex
		// match any character.
		sourceId: "slack-webhook-url",
		ruleId: "slack-webhook-url",
		secretGroup: 0,
		keywords: ["hooks"],
	},
	{
		sourceId: "stripe-access-token",
		ruleId: "stripe-access-token",
		secretGroup: 1,
	},
	{
		sourceId: "twilio-api-key",
		ruleId: "twilio-api-key",
		secretGroup: 0,
	},
	{
		// The password of `scheme://user:password@host`; scheme, user and host
		// stay readable. The password runs to the last `@` of the authority.
		// Not a password: variables and templates (`$DB_PASSWORD`, `${pw}`,
		// `<password>`, `%s`), masks, globs, regex fragments, markers, and
		// placeholder or local-default words such as `password` or `postgres`.
		// (No back-reference to the user name: JavaScriptCore and V8 disagree on
		// one inside a lookahead, and both filters must agree byte for byte.)
		sourceId: LOCAL_RULE_SOURCE_ID,
		ruleId: "connection-string-password",
		secretGroup: 1,
		regexOverride: String.raw`(?i):\/\/[^\s:/?#@"'\\]{0,256}:([^\s/?#"'\\]{1,256})@`,
		allowlistRegexes: [
			String.raw`^(?:[$<{[(*|^\])]|%[sd(])`,
			String.raw`^(?:x+|\.\.\.|\u2026)$`,
			"^(?:your|my)?[_-]?(?:db[_-]?)?(?:pass(?:word|wd)?|pwd|pw|secret|token|changeme|changeit|example|placeholder|redacted|test|postgres|mysql|root|admin|guest|default|user)$",
		],
		keywords: ["://"],
	},
	{
		// `Authorization: Bearer|Token|Basic <value>` in headers, curl
		// commands and request dumps. Runs last, so known token formats keep
		// their own marker.
		sourceId: LOCAL_RULE_SOURCE_ID,
		ruleId: "authorization-header",
		secretGroup: 1,
		regexOverride: `(?i)authorization${ASSIGNMENT}(?:bearer|token|basic)[ \\t]+([\\w.~+/=-]{16,})`,
		allowlistRegexes: ["^(?:(?:your|my)[_-]|x+$)"],
		keywords: ["authorization"],
	},
];
