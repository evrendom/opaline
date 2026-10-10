export const RUN_INDEX_PROVIDER_ERROR_KINDS = [
	"server_overloaded",
	"usage_limit_exceeded",
	"http_connection_failed",
	"response_stream_connection_failed",
	"response_stream_disconnected",
	"response_too_many_failed_attempts",
] as const;

export const RUN_INDEX_PR_URL_PATTERN =
	"https://github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[1-9][0-9]*\\b";

export function componentStringsSql(
	column: string,
	pathPattern: string,
): string {
	return `arrayMap(component -> JSONExtractString(component, 'value'),
		arrayFilter(component -> match(JSONExtractString(component, 'path'), '${pathPattern.replaceAll("\\", "\\\\")}'), JSONExtractArrayRaw(${column})))`;
}

export function skillNamesSql(column: string): string {
	return `arrayFilter(name -> name != '', arrayMap(component ->
		if(endsWith(JSONExtractString(component, 'path'), '.name'), JSONExtractString(component, 'value'),
			extract(replaceRegexpOne(JSONExtractString(component, 'value'), '/SKILL[.]md$', ''), '([^/]+)$')),
		arrayFilter(component -> endsWith(JSONExtractString(component, 'path'), '.name')
			OR position(JSONExtractString(component, 'path'), '.parsed_cmd[') > 0
			OR NOT arrayExists(named -> endsWith(JSONExtractString(named, 'path'), '.name'), JSONExtractArrayRaw(${column})),
			JSONExtractArrayRaw(${column}))))`;
}

export function providerErrorKindSql(column: string): string {
	const component = `arrayFirst(component -> endsWith(JSONExtractString(component, 'path'), '.codex_error_info'), JSONExtractArrayRaw(${column}))`;
	const kind = `if(JSONType(${component}, 'value') = 'String', JSONExtractString(${component}, 'value'), arrayElement(JSONExtractKeys(JSONExtractRaw(${component}, 'value')), 1))`;
	return `if(${kind} IN (${RUN_INDEX_PROVIDER_ERROR_KINDS.map((value) => `'${value}'`).join(", ")}), ${kind}, '')`;
}

export function httpStatusesSql(column: string): string {
	return `arrayFilter(status -> match(status, '^[1-5][0-9]{2}$'), arrayMap(component ->
		if(JSONType(component, 'value') = 'String', JSONExtractString(component, 'value'), JSONExtractRaw(component, 'value')),
		arrayFilter(component -> match(JSONExtractString(component, 'path'), '[.](http_status_code|status_code)$'), JSONExtractArrayRaw(${column}))))`;
}

interface Component {
	path: string;
	value: unknown;
}

export function readRunIndexComponentValues(
	facts: Readonly<Record<string, string | undefined>>,
) {
	const components = (key: string): Component[] => {
		const parsed: unknown = JSON.parse(facts[key] ?? "[]");
		return Array.isArray(parsed)
			? parsed.filter(
					(component: unknown): component is Component =>
						component !== null &&
						typeof component === "object" &&
						"path" in component &&
						typeof component.path === "string" &&
						"value" in component,
				)
			: [];
	};
	const skills = components("skill_components");
	const hasSkillName = skills.some((component) =>
		component.path.endsWith(".name"),
	);
	const names = skills.flatMap((component) => {
		if (typeof component.value !== "string") return [];
		if (component.path.endsWith(".name")) return [component.value];
		if (hasSkillName && !component.path.includes(".parsed_cmd[")) return [];
		return [
			component.value
				.replace(/\/SKILL[.]md$/u, "")
				.split("/")
				.at(-1) ?? "",
		];
	});
	const errors = components("api_errors_components");
	const info = errors.find((component) =>
		component.path.endsWith(".codex_error_info"),
	)?.value;
	const kind =
		typeof info === "string"
			? info
			: info !== null && typeof info === "object"
				? (Object.keys(info)[0] ?? "")
				: "";
	const apiError = RUN_INDEX_PROVIDER_ERROR_KINDS.some(
		(providerKind) => providerKind === kind,
	)
		? kind
		: "";
	const statuses =
		apiError === ""
			? []
			: errors.flatMap((component) => {
					const status = String(component.value);
					return /[.](http_status_code|status_code)$/u.test(component.path) &&
						/^[1-5][0-9]{2}$/u.test(status)
						? [status]
						: [];
				});
	const abortReason = components("abort_reason_components").find(
		(component) => typeof component.value === "string",
	)?.value;
	return {
		skills: [...new Set(names.filter((name) => name !== ""))].sort(),
		subagentTypes: [
			...new Set(
				components("subagent_type_components").flatMap((component) =>
					/[.]arguments[.]agent_type$/u.test(component.path) &&
					typeof component.value === "string" &&
					component.value !== ""
						? [component.value]
						: [],
				),
			),
		].sort(),
		abortReason: typeof abortReason === "string" ? abortReason : "",
		apiError,
		apiErrorStatuses: [...new Set(statuses)].sort(),
	};
}
