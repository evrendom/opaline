import {
	ESCAPE_AWARE_TRAILING_DELIMITER,
	GITLEAKS_TRAILING_DELIMITER,
	GITLEAKS_VERSION,
	LOCAL_RULE_SOURCE_ID,
	SELECTED_RULES,
	type SelectedRule,
} from "./ruleset-config.js";

const VENDOR_PATH = new URL("../vendor/gitleaks.toml", import.meta.url);
const OUTPUT_PATH = new URL("../src/generated-rules.ts", import.meta.url);

interface ParsedGitleaksRule {
	readonly id: string;
	readonly regex: string;
	readonly keywords: readonly string[];
	readonly allowlists: readonly ParsedAllowlist[];
}

interface ParsedAllowlist {
	readonly regexes: readonly string[];
}

interface GeneratedRule {
	readonly id: string;
	readonly sourceId: string;
	readonly regexSource: string;
	readonly caseInsensitive: boolean;
	readonly secretGroup: number;
	readonly allowlistRegexSources: readonly string[];
	readonly keywords: readonly string[];
	readonly origin: "gitleaks" | "override" | "local";
}

async function main(): Promise<void> {
	const source = await Bun.file(VENDOR_PATH).text();
	const parsed: unknown = Bun.TOML.parse(source);
	const rules = parseRules(parsed);
	const generatedRules = SELECTED_RULES.map((selection) =>
		buildGeneratedRule(selection, rules),
	);
	await Bun.write(OUTPUT_PATH, renderModule(generatedRules));
}

function parseRules(value: unknown): readonly ParsedGitleaksRule[] {
	if (!isRecord(value) || !Array.isArray(value.rules)) {
		throw new Error("Vendored Gitleaks TOML does not contain a rules array");
	}

	return value.rules.map((rule) => {
		if (
			!isRecord(rule) ||
			typeof rule.id !== "string" ||
			typeof rule.regex !== "string"
		) {
			throw new Error("Vendored Gitleaks TOML contains an invalid rule");
		}

		if (
			!Array.isArray(rule.keywords) ||
			!rule.keywords.every((keyword) => typeof keyword === "string")
		) {
			throw new Error(`Vendored Gitleaks rule has no keywords: ${rule.id}`);
		}

		return {
			id: rule.id,
			regex: rule.regex,
			keywords: rule.keywords,
			allowlists: parseAllowlists(rule.allowlists),
		};
	});
}

function parseAllowlists(value: unknown): readonly ParsedAllowlist[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new Error("Gitleaks rule allowlists must be an array");
	}

	return value.map((allowlist) => {
		if (!isRecord(allowlist) || allowlist.regexes === undefined) {
			return { regexes: [] };
		}
		if (
			!Array.isArray(allowlist.regexes) ||
			!allowlist.regexes.every((regex) => typeof regex === "string")
		) {
			throw new Error("Gitleaks allowlist regexes must be strings");
		}
		return { regexes: allowlist.regexes };
	});
}

function buildGeneratedRule(
	selection: SelectedRule,
	rules: readonly ParsedGitleaksRule[],
): GeneratedRule {
	const isLocal = selection.sourceId === LOCAL_RULE_SOURCE_ID;
	const sourceRule = isLocal
		? undefined
		: rules.find((rule) => rule.id === selection.sourceId);
	if (!isLocal && !sourceRule) {
		throw new Error(`Vendored Gitleaks rule is missing: ${selection.sourceId}`);
	}
	const regex = selection.regexOverride ?? sourceRule?.regex;
	if (regex === undefined) {
		throw new Error(`Local rule needs a regex: ${selection.ruleId}`);
	}

	const normalized = normalizeRegex(regex);
	const allowlistRegexSources = [
		...(sourceRule?.allowlists ?? []).flatMap((allowlist) =>
			allowlist.regexes.map((regex) => normalizeRegex(regex).source),
		),
		...(selection.allowlistRegexes ?? []),
	];

	if (selection.regexOverride !== undefined && !selection.keywords) {
		throw new Error(
			`Rule ${selection.ruleId} overrides its regex without keywords`,
		);
	}
	const keywords = selection.keywords ?? sourceRule?.keywords ?? [];
	if (
		keywords.length === 0 ||
		keywords.some((keyword) => keyword !== keyword.toLowerCase())
	) {
		throw new Error(`Rule ${selection.ruleId} needs lowercase keywords`);
	}
	const regexSource = makeEscapeAware(normalized.source);

	return {
		id: selection.ruleId,
		sourceId: selection.sourceId,
		regexSource,
		caseInsensitive: normalized.caseInsensitive,
		secretGroup: selection.secretGroup,
		allowlistRegexSources,
		keywords,
		origin: isLocal
			? "local"
			: selection.regexOverride === undefined
				? "gitleaks"
				: "override",
	};
}

/**
 * Lets a rule end before an escaped quote: see ESCAPE_AWARE_TRAILING_DELIMITER
 * in ruleset-config.ts.
 */
function makeEscapeAware(source: string): string {
	return source
		.split(GITLEAKS_TRAILING_DELIMITER)
		.join(ESCAPE_AWARE_TRAILING_DELIMITER);
}

function normalizeRegex(regex: string): {
	readonly source: string;
	readonly caseInsensitive: boolean;
} {
	const caseInsensitiveIndex = regex.indexOf("(?i)");
	if (caseInsensitiveIndex < 0) {
		rejectUnsupportedModifiers(regex);
		return { source: regex, caseInsensitive: false };
	}
	if (regex.lastIndexOf("(?i)") !== caseInsensitiveIndex) {
		throw new Error("Selected rule uses multiple case-insensitive modifiers");
	}
	if (caseInsensitiveIndex > 0) {
		const inlineSource = regex.slice(caseInsensitiveIndex);
		const inlineClassMatch = inlineSource.match(
			/^\(\?i\)(\[(?:\\.|[^\]\\])+\])((?:\{\d+(?:,\d*)?\}|[+*?])?)(?=\))/u,
		);
		const characterClass = inlineClassMatch?.[1];
		if (!inlineClassMatch || !characterClass) {
			throw new Error(
				"Selected rule uses an unsupported mid-pattern case-insensitive modifier",
			);
		}
		const expandedClass =
			expandAsciiCaseInsensitiveCharacterClass(characterClass);
		const source = `${regex.slice(0, caseInsensitiveIndex)}${expandedClass}${inlineClassMatch[2] ?? ""}${inlineSource.slice(inlineClassMatch[0].length)}`;
		rejectUnsupportedModifiers(source);
		return {
			source,
			caseInsensitive: false,
		};
	}

	const source = regex.slice(4);
	rejectUnsupportedModifiers(source);
	return {
		source,
		caseInsensitive: true,
	};
}

function expandAsciiCaseInsensitiveCharacterClass(source: string): string {
	const body = source.slice(1, -1);
	let expanded = "";

	for (let index = 0; index < body.length; index += 1) {
		const character = body[index];
		if (character === "\\") {
			const escaped = body[index + 1];
			if (!escaped || /[A-Za-z]/u.test(escaped)) {
				throw new Error(
					"Case-insensitive character class contains an unsupported escape",
				);
			}
			expanded += `${character}${escaped}`;
			index += 1;
			continue;
		}
		const range = body.slice(index, index + 3);
		if (range === "a-z" || range === "A-Z") {
			expanded += "a-zA-Z";
			index += 2;
			continue;
		}
		if (range === "0-9") {
			expanded += range;
			index += 2;
			continue;
		}
		if (
			character === "-" ||
			(body[index + 1] === "-" && body[index + 2] !== undefined)
		) {
			throw new Error(
				"Case-insensitive character class contains an unsupported range",
			);
		}
		if (character && /[A-Za-z]/u.test(character)) {
			expanded += `${character.toLowerCase()}${character.toUpperCase()}`;
			continue;
		}
		const codePoint = character?.codePointAt(0);
		if (codePoint === undefined || codePoint > 0x7f) {
			throw new Error(
				"Case-insensitive character class must contain ASCII characters",
			);
		}
		expanded += character;
	}

	return `[${expanded}]`;
}

function rejectUnsupportedModifiers(regex: string): void {
	if (/\(\?[ims-]/u.test(regex)) {
		throw new Error(
			"Selected rule uses unsupported regular expression modifiers",
		);
	}
}

function renderModule(rules: readonly GeneratedRule[]): string {
	const entries = rules
		.map(
			(rule) => `${RULE_ORIGIN_COMMENTS[rule.origin]}\t{
\t\tid: ${JSON.stringify(rule.id)},
\t\tsourceId: ${JSON.stringify(rule.sourceId)},
\t\tregexSource: ${JSON.stringify(rule.regexSource)},
\t\tcaseInsensitive: ${rule.caseInsensitive},
\t\tsecretGroup: ${rule.secretGroup},
\t\tallowlistRegexSources: ${JSON.stringify(rule.allowlistRegexSources)},
\t\tkeywords: ${JSON.stringify(rule.keywords)},
\t},`,
		)
		.join("\n");

	return `// Generated by scripts/generate-rules.ts. Do not edit by hand.
// Source: Gitleaks ${GITLEAKS_VERSION} config/gitleaks.toml.

import type { SecretRule } from "./types.js";

export const GITLEAKS_VERSION = ${JSON.stringify(GITLEAKS_VERSION)};

export const GENERATED_SECRET_RULES: readonly SecretRule[] = [
${entries}
];
`;
}

const RULE_ORIGIN_COMMENTS: Readonly<Record<GeneratedRule["origin"], string>> =
	{
		gitleaks: "",
		override:
			"\t// Local regex override applied from scripts/ruleset-config.ts.\n",
		local: "\t// Local rule defined in scripts/ruleset-config.ts.\n",
	};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

await main();
