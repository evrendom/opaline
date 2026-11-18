import type {
	ClaudeTypePath,
	ClaudeTypesSnapshot,
} from "../../scripts/claude-types/oracle.js";
import snapshot from "./claude-types-0.3.287.json" with { type: "json" };
import { FACT_CATALOG, type FactEntry } from "./fact-catalog.js";
import { pathMatches } from "./fact-census.js";
import census from "./fact-mapping-census.json" with { type: "json" };

export const CLAUDE_TYPES_SNAPSHOT: ClaudeTypesSnapshot = {
	...snapshot,
	paths: snapshot.paths.map((entry) => {
		const direction = entry.direction;
		if (direction !== "input" && direction !== "result")
			throw new Error(`Invalid SDK direction ${direction}`);
		return { ...entry, direction };
	}),
};

export const CLAUDE_TYPE_EXCEPTIONS = [
	{
		path: "user.toolUseResult.allowedTools[]",
		reason:
			"Locally witnessed Skill allowed-tool list; Skill is outside the pinned ToolOutputSchemas union.",
	},
	{
		path: "user.toolUseResult.total_deferred_tools",
		reason:
			"Locally witnessed ToolSearch inventory count; ToolSearch is outside the pinned ToolOutputSchemas union.",
	},
	{
		path: "assistant.message.content[tool_use:SendMessage].input.recipient",
		reason:
			"Witnessed SendMessage recipient extension; SendMessage is outside the pinned ToolInputSchemas union.",
	},
	{
		path: "assistant.message.content[tool_use:SendMessage].input.to",
		reason:
			"Witnessed SendMessage recipient extension; AgentInput.name documents addressability, not this tool payload schema.",
	},
	{
		path: "user.toolUseResult.pin.*",
		reason:
			"Judge round 3: 89/89 SendMessage results identify the addressed sub-agent, not ArtifactOutput; these result identity fields lack a published SendMessage schema.",
	},
	{
		path: "user.toolUseResult.contentNotInModelContext",
		reason:
			"Locally observed CLI result extension; SDK 0.3.287 does not declare this field.",
	},
	{
		path: "user.toolUseResult.bashEditDiff.**",
		reason:
			"Locally observed Bash edit-diff extension; absent from published BashOutput. Not inferred from a Claude writer.",
	},
	{
		path: "user.toolUseResult.resumedAgentId",
		reason:
			"Local resume metadata is not the published AgentOutput.agentId declaration.",
	},
	{
		path: "assistant.message.content[tool_use:Skill].input.skill",
		reason:
			"Skill is used locally but not a member of the published ToolInputSchemas union.",
	},
	{
		path: "user.toolUseResult.matches[]",
		reason:
			"ToolSearch is used locally but omitted from the published input/output unions.",
	},
	{
		path: "user.toolUseResult.staleRecovered",
		reason:
			"Locally observed Edit extension; not declared in the pinned FileEditOutput.",
	},
] as const;

export function isClaudeToolPayload(path: string): boolean {
	return /\.input(?:[.[]|$)|^user\.toolUseResult(?:[.[]|$)/u.test(path);
}

export function claudeTypeMatches(
	pattern: string,
	pin: ClaudeTypesSnapshot = CLAUDE_TYPES_SNAPSHOT,
): readonly ClaudeTypePath[] {
	return pin.paths.filter(
		(entry) =>
			pathMatches(pattern, entry.path) || pathMatches(entry.path, pattern),
	);
}

export function claudeTypesCoverage(
	entries: readonly FactEntry[] = FACT_CATALOG,
	local: Readonly<Record<string, number>> = census.paths.claude_code,
	pin: ClaudeTypesSnapshot = CLAUDE_TYPES_SNAPSHOT,
) {
	const sources = entries.flatMap((entry) =>
		entry.agents.claude_code.sourceMappings
			.filter((source) => isClaudeToolPayload(source.path))
			.map((source) => ({
				fact: `${entry.view}/${entry.id}`,
				path: source.path,
			})),
	);
	const missing = sources.filter(
		(source) => claudeTypeMatches(source.path, pin).length === 0,
	);
	const noted = missing.filter((source) =>
		CLAUDE_TYPE_EXCEPTIONS.some((exception) =>
			pathMatches(exception.path, source.path),
		),
	);
	const distinct = [
		...new Map(
			pin.paths.map((entry) => [
				`${entry.tool}:${entry.direction}:${entry.path}`,
				entry,
			]),
		).values(),
	];
	const blindSpots = distinct.filter(
		(entry) =>
			!Object.keys(local).some((path) => pathMatches(entry.path, path)),
	);
	const localNotInSdk = Object.keys(local)
		.filter(isClaudeToolPayload)
		.filter((path) => claudeTypeMatches(path, pin).length === 0)
		.sort();
	return {
		version: pin.version,
		claudeCodeVersion: pin.claudeCodeVersion,
		declarations: pin.paths.length,
		tools: pin.tools.length,
		expectedPaths: distinct.length,
		catalogSources: sources.length,
		matches: sources.length - missing.length,
		noted,
		unaccounted: missing.filter((source) => !noted.includes(source)),
		observedPaths: distinct.length - blindSpots.length,
		blindSpots,
		localNotInSdk,
		resultCaveat:
			"toolUseResult has no tool discriminator in census notation: result-path witnesses are pooled across tools, not proof of a per-tool invocation. Unknown/MCP payloads do not declare arbitrary children.",
		envelopeNote:
			"sdk-tools.d.ts describes tool payloads, not tool_use ids/names, tool_result message envelopes, wireToolInputs, permissionDecision or attachment wrappers. Those catalog sources are explicitly outside this oracle's scope.",
	};
}
