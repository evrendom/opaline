import { filterKnownSecrets, getUtf8ByteLength } from "./filter.js";
import type { SecretFilterResult } from "./types.js";

/**
 * Credential redaction for text a tool returns (ported from the CLI's
 * context filter, `opalinehq/cli` local-context-source). The upload filter
 * (`filterSessionTextFields`) only knows vendor token formats; these rules
 * add what people write by hand:
 * - credential assignments in env, JSON, YAML and query forms
 *   (`password: x`, `INTERNAL_API_KEY=x`, `"apiKey": "x"`, `?token=x`) whose
 *   name has a credential word as one of its parts;
 * - credential flags (`--token x`, `--api-key=x`);
 * - `Authorization`-style `Bearer x` / `Basic x` / `Token x` values;
 * - passwords in connection strings (`postgres://user:pass@host`);
 * - JWT-shaped tokens.
 * Names and structure stay; only values become `[redacted]`. Plain words
 * such as `password` without a value are left alone.
 */

export const RETURNED_TEXT_REDACTION = "[redacted]";

const CREDENTIAL_ASSIGNMENT_RULE = "credential-assignment";
const CREDENTIAL_FLAG_RULE = "credential-flag";
const AUTHORIZATION_VALUE_RULE = "authorization-value";
const CONNECTION_STRING_RULE = "connection-string-password";
const JWT_RULE = "jwt";

type Redactor = (ruleId: string, original: string) => string;

// Unlike the CLI's list, "session" and "sessionid" are left out: session ids
// are how tools address runs, and they are not secrets.
const CREDENTIAL_WORDS: ReadonlySet<string> = new Set([
	"key",
	"apikey",
	"token",
	"tokens",
	"secret",
	"secrets",
	"password",
	"passwords",
	"passwd",
	"pwd",
	"pass",
	"credential",
	"credentials",
	"auth",
	"authorization",
	"cookie",
	"cookies",
	"pat",
]);
const CREDENTIAL_SUFFIXES = [
	"key",
	"token",
	"secret",
	"password",
	"passwd",
	"pwd",
];
const TYPE_NAMES: ReadonlySet<string> = new Set([
	"string",
	"str",
	"number",
	"int",
	"integer",
	"bool",
	"boolean",
	"bytes",
	"any",
	"unknown",
	"object",
	"promise",
	"secretstr",
	"optional",
	"text",
	"varchar",
	"uuid",
]);
const STOP_VALUES: ReadonlySet<string> = new Set([
	"true",
	"false",
	"null",
	"none",
	"nil",
	"undefined",
	"required",
	"optional",
	"enabled",
	"disabled",
	"redacted",
]);

// Quotes may be escaped, once or more (`\"password\": \"x\"`), as in
// JSON that a tool printed inside a string or in rendered tool text.
const ASSIGNMENT_PATTERN =
	/(?<![A-Za-z0-9_])((?:\\{0,4}["'])?)([A-Za-z_][A-Za-z0-9_.-]{0,80})\1([ \t]*(?::|=)[ \t]*)(?:(\\{0,4}")([^"\\\n]{1,4096})\4|'([^'\n]{1,4096})'|([^\s"'`,;&|)}\]\\]{1,4096}))/gu;
const FLAG_PATTERN =
	/(?<![A-Za-z0-9_-])(--?[A-Za-z][A-Za-z0-9-]{0,60})([ \t]+)(?!-)(?:"([^"\n]{1,4096})"|'([^'\n]{1,4096})'|([^\s"'`|;&]{1,4096}))/gu;
const AUTHORIZATION_PATTERN =
	/\b(Bearer|Basic|Token)([ \t]+)([A-Za-z0-9._~+/=-]{8,4096})/gu;
const CONNECTION_STRING_PATTERN =
	/\b([A-Za-z][A-Za-z0-9+.-]{1,30}:\/\/[^\s:/@"'`]{0,256}:)([^\s@/"'`]{1,512})(@)/gu;
const JWT_PATTERN =
	/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu;

/** Whether one of a name's parts (snake, kebab, dotted or camel case) is a credential word. */
function isCredentialName(name: string): boolean {
	const parts = name
		.replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
		.toLowerCase()
		.split(/[^a-z0-9]+/u)
		.filter((part) => part.length > 0);
	return parts.some(
		(part) =>
			CREDENTIAL_WORDS.has(part) ||
			CREDENTIAL_SUFFIXES.some(
				(suffix) => part.length > suffix.length && part.endsWith(suffix),
			),
	);
}

const LENGTH_MASK = /^[^\s…]{0,16}…\[\d+(?: chars\])?$/u;

/**
 * Whether a value next to a credential name is plausibly the credential
 * rather than prose, a type, a placeholder or a reference to one.
 */
function isCredentialValue(value: string, assigned = false): boolean {
	const trimmed = value.trim();
	if (trimmed.length < 4) return false;
	if (STOP_VALUES.has(trimmed.toLowerCase())) return false;
	if (/^\[redacted/iu.test(trimmed)) return false;
	if (LENGTH_MASK.test(trimmed)) return false;
	if (/^(?:\$|%|<|\{\{|process\.env|os\.environ|env\.|ENV\[)/u.test(trimmed))
		return false;
	if (/^\d+(?:\.\d+)?$/u.test(trimmed)) return false;
	// After `:` a bare type name is a declaration (`password: string`), not
	// a value; quoted or `=`-assigned words are values (`PASSWORD=hunter`).
	if (
		!assigned &&
		TYPE_NAMES.has(trimmed.replace(/[<[].*$/u, "").toLowerCase())
	)
		return false;
	// Dotted identifiers and calls are code references ("config.apiKey").
	if (/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/u.test(trimmed)) return false;
	if (/^[A-Za-z_][\w.]*\(/u.test(trimmed)) return false;
	return true;
}

/** Credential rules only (no vendor patterns); returns counts per rule. */
function redactCredentialText(
	text: string,
	redact: Redactor,
): SecretFilterResult {
	// Every rule needs one of these hints on the same line; most lines of code
	// and prose have none, so they are passed through untouched.
	if (!CREDENTIAL_HINT.test(text))
		return { text, counts: {}, redactedBytes: 0 };
	const counts: Record<string, number> = {};
	let redactedBytes = 0;
	const lines = text.split("\n");
	for (const [index, line] of lines.entries()) {
		if (!CREDENTIAL_HINT.test(line)) continue;
		const result = redactCredentialLine(line, redact);
		if (result.redactedBytes === 0) continue;
		lines[index] = result.text;
		redactedBytes += result.redactedBytes;
		for (const [ruleId, count] of Object.entries(result.counts))
			counts[ruleId] = (counts[ruleId] ?? 0) + count;
	}
	return {
		text: redactedBytes === 0 ? text : lines.join("\n"),
		counts,
		redactedBytes,
	};
}

const CREDENTIAL_HINT =
	/key|token|secret|pass|pwd|credential|auth|cookie|pat|bearer|basic|:\/\/|eyJ/iu;

function redactCredentialLine(
	text: string,
	redact: Redactor,
): SecretFilterResult {
	const counts: Record<string, number> = {};
	let redactedBytes = 0;
	const record = (ruleId: string, original: string) => {
		counts[ruleId] = (counts[ruleId] ?? 0) + 1;
		redactedBytes += getUtf8ByteLength(original);
		return redact(ruleId, original);
	};
	let result = text.replace(
		CONNECTION_STRING_PATTERN,
		(_match, prefix: string, password: string, at: string) =>
			isPlaceholder(password)
				? `${prefix}${password}${at}`
				: `${prefix}${record(CONNECTION_STRING_RULE, password)}${at}`,
	);
	result = result.replace(JWT_PATTERN, (token) => record(JWT_RULE, token));
	result = result.replace(
		AUTHORIZATION_PATTERN,
		(match, scheme: string, space: string, value: string) =>
			value.toLowerCase().startsWith("[redacted") ||
			!/\d|[._~+/=-]/u.test(value)
				? match
				: `${scheme}${space}${record(AUTHORIZATION_VALUE_RULE, value)}`,
	);
	result = replaceRescanning(result, ASSIGNMENT_PATTERN, (match) => {
		const [, quote = "", name = "", separator = "", doubleQuote = '"'] = match;
		const doubleQuoted = match[5];
		const singleQuoted = match[6];
		const value = doubleQuoted ?? singleQuoted ?? match[7] ?? "";
		const assigned =
			doubleQuoted !== undefined ||
			singleQuoted !== undefined ||
			separator.includes("=");
		if (!isCredentialName(name) || !isCredentialValue(value, assigned))
			return null;
		// `Authorization: Bearer x` is handled by the authorization rule.
		if (/^(?:Bearer|Basic|Token)$/u.test(value)) return null;
		const replacement = record(CREDENTIAL_ASSIGNMENT_RULE, value);
		const wrapped =
			doubleQuoted !== undefined
				? `${doubleQuote}${replacement}${doubleQuote}`
				: singleQuoted !== undefined
					? `'${replacement}'`
					: replacement;
		return `${quote}${name}${quote}${separator}${wrapped}`;
	});
	result = result.replace(
		FLAG_PATTERN,
		(
			match,
			flag: string,
			separator: string,
			doubleQuoted: string | undefined,
			singleQuoted: string | undefined,
			bare: string | undefined,
		) => {
			const value = doubleQuoted ?? singleQuoted ?? bare ?? "";
			if (
				!isCredentialName(flag.replace(/^-+/u, "")) ||
				!isCredentialValue(value)
			)
				return match;
			const replacement = record(CREDENTIAL_FLAG_RULE, value);
			return `${flag}${separator}${
				doubleQuoted !== undefined
					? `"${replacement}"`
					: singleQuoted !== undefined
						? `'${replacement}'`
						: replacement
			}`;
		},
	);
	return { text: result, counts, redactedBytes };
}

/**
 * Global replace that, when a match is rejected, resumes scanning where its
 * value starts (`valueGroupStart`), so a rejected match (`https://...`)
 * cannot hide an acceptable one inside its value (`?access_token=...`).
 */
function replaceRescanning(
	text: string,
	pattern: RegExp,
	replace: (match: RegExpExecArray) => string | null,
): string {
	const matcher = new RegExp(pattern.source, pattern.flags);
	const pieces: string[] = [];
	let cursor = 0;
	let match = matcher.exec(text);
	while (match !== null) {
		const replacement = replace(match);
		if (replacement === null) {
			// Skip the rejected name and separator, rescan the value.
			const head =
				(match[1] ?? "").length * 2 +
				(match[2] ?? "").length +
				(match[3] ?? "").length;
			matcher.lastIndex = match.index + Math.max(1, head);
		} else {
			pieces.push(text.slice(cursor, match.index), replacement);
			cursor = match.index + match[0].length;
			matcher.lastIndex = cursor;
		}
		match = matcher.exec(text);
	}
	pieces.push(text.slice(cursor));
	return pieces.join("");
}

function isPlaceholder(value: string): boolean {
	return /^(?:\*+|x+|\$\{?\w+\}?|<[^>]*>|\[redacted[^\]]*\]|password|pass|secret)$/iu.test(
		value,
	);
}

export function maskCredentialText(
	text: string,
	mask: (value: string) => string,
): string {
	return redactCredentialText(text, (_ruleId, value) => mask(value)).text;
}

/** Upload-time markers (`[REDACTED:openai-api-key]`) read the same as new ones. */
const KNOWN_SECRET_MARKER = /\[REDACTED:[a-z0-9-]+\]/gu;

/**
 * Text a plugin tool returns, with known secret formats and hand-written
 * credentials replaced by `[redacted]`. Never throws: if the known-format
 * filter cannot settle, the whole text is withheld.
 */
export function redactReturnedText(text: string): string {
	let known: string;
	try {
		known = filterKnownSecrets(text).text;
	} catch {
		return RETURNED_TEXT_REDACTION;
	}
	return redactCredentialText(
		known.replace(KNOWN_SECRET_MARKER, RETURNED_TEXT_REDACTION),
		() => RETURNED_TEXT_REDACTION,
	).text;
}

const MAX_RETURNED_DEPTH = 64;

/**
 * Every string inside a tool result (rendered text, structured content, app
 * data) passed through `redactReturnedText`; keys and other values stay.
 */
export function redactReturnedValue<T>(value: T, depth = 0): T {
	if (typeof value === "string") return redactReturnedText(value) as T;
	if (depth > MAX_RETURNED_DEPTH || value === null || typeof value !== "object")
		return value;
	if (Array.isArray(value))
		return value.map((item) => redactReturnedValue(item, depth + 1)) as T;
	return Object.fromEntries(
		Object.entries(value).map(([key, child]) => [
			key,
			redactReturnedValue(child, depth + 1),
		]),
	) as T;
}
