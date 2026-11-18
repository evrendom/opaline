/**
 * Facts L1 already records exactly never become run questions
 * (docs/retro-architecture.md "Run questions"): a model must not guess what
 * the data knows. Each rule names where the fact is recorded, so the form can
 * tell the operator to query it with sql instead. The first matching rule
 * wins; a question that matches none is about meaning and may be asked.
 */
const RECORDED_FACTS: readonly { pattern: RegExp; fact: string }[] = [
	{
		// Whether CI was checked or how it ended, not every mention: "a CI fix" is about the work.
		pattern:
			/\b(?:check(?:ed|ing)?|watch(?:ed|ing)?|wait(?:ed|ing)? for|look(?:ed)? at)\s+(?:the\s+)?CI\b|\bCI\s+(?:ran|run|runs|pass(?:ed|es)?|fail(?:ed|s)?|green|red|status|result)|\bchecks? (?:ran|run|pass)/iu,
		fact: "CI checked or not (L1 edges)",
	},
	{
		pattern:
			/\b(?:shell|bash|sed|echo)\b.*\bedit|\bedit\w*\b.*\b(?:shell|bash|sed)\b/iu,
		fact: "shell edits (L1 records them per call)",
	},
	{ pattern: /\bpull requests?\b|\bPRs?\b/u, fact: "pr_urls, git_operations" },
	{
		pattern: /\b(?:commit|commits|committed|push|pushed|pushes)\b/iu,
		fact: "git_operations, commit_shas, pushed_branches",
	},
	{
		pattern:
			/\b(?:denied|deny|denies)\b|\bpermission (?:was |is )?(?:denied|refused)\b/iu,
		fact: "denied_calls",
	},
	{
		pattern: /\binterrupt(?:ed|s|ion)?\b/iu,
		fact: "interrupted_calls, interrupt_markers",
	},
	{ pattern: /\btime[sd]? ?out\b/iu, fact: "timed_out_calls" },
	{ pattern: /\bAPI errors?\b/iu, fact: "api_errors" },
	{ pattern: /\bretr(?:y|ied|ies)\b/iu, fact: "retry_attempts" },
	{ pattern: /\brefus(?:e|ed|al)\b/iu, fact: "refusals" },
	{ pattern: /\bcompact(?:ed|ion)?\b/iu, fact: "compactions" },
	{
		pattern:
			/\b(?:use|used|uses|using|invoke|invoked|run|ran) (?:a |the |any )?skills?\b/iu,
		fact: "skills",
	},
	{ pattern: /\bslash commands?\b/iu, fact: "slash_commands" },
	{ pattern: /\bsubagents?\b/iu, fact: "subagent_types" },
	{ pattern: /\bMCP\b/u, fact: "mcp_calls, mcp_servers" },
	{
		pattern: /\bnot found\b|\bno such file\b|\bENOENT\b/iu,
		fact: "not_found",
	},
	{
		pattern:
			/\b(?:cost|costs|dollars?)\b|\$\d|\btokens? (?:used|spent|count)\b|\b(?:input|output) tokens\b/iu,
		fact: "cost_usd",
	},
	{
		pattern: /\b(?:how long|minutes|hours|duration)\b/iu,
		fact: "minutes, active_minutes",
	},
	{ pattern: /\bwhich model\b|\bmodel was\b/iu, fact: "model, models" },
];

/** Where L1 records the fact a question asks about, or null when it asks about meaning. */
export function recordedFact(question: string): string | null {
	return (
		RECORDED_FACTS.find((rule) => rule.pattern.test(question))?.fact ?? null
	);
}
