const LEAD =
	"too large to page through here. If the opaline CLI is available, to compute on all of it, run:";

export function pullCommand(scope: {
	repository?: unknown;
	from: string;
	to: string;
}): string {
	const repository =
		typeof scope.repository === "string" && scope.repository !== ""
			? ` --repo ${shellWord(scope.repository)}`
			: "";
	return `opaline pull${repository} --from ${scope.from} --to ${scope.to}`;
}

export function pullPatternCommand(
	id: string,
	scope: { repository?: unknown; from: string; to: string },
): string {
	return pullCommand(scope).replace(
		"opaline pull",
		`opaline pull --pattern ${shellWord(id)}`,
	);
}

export function sqlOutCommand(query: string): string {
	return `opaline sql "${query.replace(/["$`\\]/gu, "\\$&")}" --out rows.jsonl`;
}

export function cliHint(command: string): string {
	return `${LEAD} ${command}`;
}

function shellWord(value: string): string {
	return /^[\w./:@~+-]+$/u.test(value)
		? value
		: `'${value.replaceAll("'", "'\\''")}'`;
}
