type JsonSchema = Record<string, unknown>;

interface SearchableTool {
	readonly name: string;
	readonly title: string;
	readonly description: string;
	readonly inputSchema: JsonSchema;
}

interface Issue {
	readonly path: readonly PropertyKey[];
	readonly message: string;
	readonly code?: string;
}

const SEARCH_FIELD_WEIGHT = { name: 3, title: 2, description: 1 } as const;
type SearchField = keyof typeof SEARCH_FIELD_WEIGHT;
const ORDERED_FIELDS: readonly SearchField[] = ["name", "title", "description"];
const MAX_CLOSEST = 5;
const MAX_PARAM_HINT = 200;

export function closestTools(
	tools: readonly SearchableTool[],
	query: string,
): string[] {
	const tokens = [
		...new Set(
			query
				.replace(/[^a-z0-9]+/giu, " ")
				.toLowerCase()
				.split(/\s+/u)
				.filter(Boolean),
		),
	];
	const scored: { name: string; tokensMatched: number; score: number }[] = [];
	for (const tool of tools) {
		const haystack: Record<SearchField, string> = {
			name: tool.name.toLowerCase(),
			title: tool.title.toLowerCase(),
			description: tool.description.toLowerCase(),
		};
		let tokensMatched = 0;
		let score = 0;
		for (const token of tokens) {
			const field = ORDERED_FIELDS.find((name) =>
				haystack[name].includes(token),
			);
			if (field) {
				tokensMatched += 1;
				score += SEARCH_FIELD_WEIGHT[field];
			}
		}
		if (tokensMatched > 0)
			scored.push({ name: tool.name, tokensMatched, score });
	}
	scored.sort(
		(a, b) =>
			b.score - a.score ||
			b.tokensMatched - a.tokensMatched ||
			a.name.localeCompare(b.name),
	);
	return scored.slice(0, MAX_CLOSEST).map((match) => match.name);
}

export function unknownToolMessage(
	name: unknown,
	tools: readonly SearchableTool[],
): string {
	const asked = String(name);
	const closest = closestTools(tools, asked);
	return closest.length
		? `No tool is named "${asked}". These are the closest matches by its words: ${closest.join(", ")}.`
		: `No tool is named "${asked}". The tools are: ${tools.map((tool) => tool.name).join(", ")}.`;
}

export function validationMessage(
	tool: SearchableTool,
	issues: readonly Issue[],
): string {
	const properties = (tool.inputSchema.properties ?? {}) as Record<
		string,
		JsonSchema
	>;
	const parts = issues.map((issue) => {
		const path = issue.path.map(String).join(".");
		if (issue.code === "unrecognized_keys" || !path)
			return `${issue.message}; this tool takes: ${Object.keys(properties).join(", ")}`;
		const property =
			issue.path.length === 1 ? properties[String(issue.path[0])] : undefined;
		return `parameter "${path}": ${issue.message}${property ? `${parameterHint(property)}; resend it as ${shapeOf(property)}` : ""}`;
	});
	return `Invalid input for "${tool.name}": ${[...new Set(parts)].join("; ")}`;
}

function parameterHint(property: JsonSchema): string {
	const description =
		typeof property.description === "string" ? property.description.trim() : "";
	if (!description) return "";
	return ` (${description.length > MAX_PARAM_HINT ? `${description.slice(0, MAX_PARAM_HINT).trimEnd()}...` : description})`;
}

function shapeOf(property: JsonSchema): string {
	if (Array.isArray(property.enum))
		return `one of: ${property.enum.map(String).join(", ")}`;
	const type = property.type;
	if (type === "array") {
		const items = (property.items ?? {}) as JsonSchema;
		if (items.properties)
			return `an array of objects with ${Object.keys(items.properties as JsonSchema).join(", ")}`;
		return `an array of ${shapeOf(items)}`;
	}
	if (type === "integer" || type === "number") {
		const range =
			typeof property.minimum === "number" &&
			typeof property.maximum === "number"
				? ` from ${property.minimum} to ${property.maximum}`
				: "";
		return `${type === "integer" ? "an integer" : "a number"}${range}`;
	}
	if (type === "boolean") return "true or false";
	if (type === "string")
		return property.format === "date" ? "a date, YYYY-MM-DD" : "a string";
	return "a JSON value";
}

const RECOVERY_HINTS: Readonly<Record<string, string>> = {
	find: [
		"The most common cause is a call that scans too much data and runs out of time, not a bug in your arguments.",
		"",
		"Narrow the call and retry:",
		"1. Shorten from..to (one week instead of four).",
		"2. Add filters: repository, agent, sessionId, toolGroup, kind or reaction.",
		"3. Lower limit, or pass latest to read only the newest sessions.",
		'4. Aggregate first (source=runs or calls with groupBy, or verbosity: "summary"), then open single rows.',
	].join("\n"),
	read: [
		"Narrow the call and retry:",
		"1. Pass fewer refs per call.",
		"2. Use depth exchange instead of turn.",
		"3. Lower maxChars.",
	].join("\n"),
	run: [
		"Narrow the call and retry:",
		"1. Expand fewer ids at once.",
		"2. Ask for fewer sections.",
		"3. Lower maxChars.",
	].join("\n"),
	sql: [
		"Narrow the query and retry:",
		"1. Shorten the time range.",
		"2. Add filters on members or sessions.",
		"3. Select fewer columns and lower the LIMIT.",
		"4. Aggregate with GROUP BY before ordering.",
	].join("\n"),
};

export function recoveryHint(toolName: unknown): string | undefined {
	return typeof toolName === "string" ? RECOVERY_HINTS[toolName] : undefined;
}
