export interface GeneratedCall {
	readonly tool: "measures" | "patterns";
	readonly action: string;
	readonly input: Readonly<Record<string, unknown>>;
}

export function recordedSqlArgs(
	statement: {
		readonly query: string;
		readonly title: string;
		readonly analysis?: string;
		readonly measure?: { readonly from?: string; readonly to?: string };
	},
	call?: GeneratedCall,
): Record<string, unknown> {
	const trace = statement.analysis ? { analysis: statement.analysis } : {};
	if (!call)
		return { query: statement.query, title: statement.title, ...trace };
	const { analysis: _analysis, workspace: _workspace, ...input } = call.input;
	const { from, to } = statement.measure ?? {};
	return {
		title: statement.title,
		call: {
			tool: call.tool,
			action: call.action,
			...input,
			...(from ? { from } : {}),
			...(to ? { to } : {}),
		},
		...trace,
	};
}
