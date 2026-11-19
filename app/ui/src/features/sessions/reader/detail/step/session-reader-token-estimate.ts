/** Characters a token, by tokenizer: Claude's from Opus 4.7 on (Opus 4.7,
 * 4.8, 5, 5.5, Fable, Mythos, Sonnet 5, Haiku 5.5) makes about 30% more
 * tokens of the same text than the one before it; OpenAI's about 4. */
const CHARS_PER_TOKEN = {
	claude: 3.5,
	"claude-new": 2.7,
	openai: 4,
} as const;

type Tokenizer = keyof typeof CHARS_PER_TOKEN;

const NEW_CLAUDE_TOKENIZER =
	/^claude-(?:opus-4-[7-9]|opus-[5-9]|fable|mythos|sonnet-[5-9]|haiku-[5-9])/u;

function tokenizerOf(model: string | null): Tokenizer {
	if (!model) return "claude";
	if (NEW_CLAUDE_TOKENIZER.test(model)) return "claude-new";
	if (/^(?:gpt-|o\d|codex)/u.test(model)) return "openai";
	return "claude";
}

const TOKENIZER_LABELS: Record<Tokenizer, string> = {
	claude: "Claude's earlier tokenizer",
	"claude-new": "Claude's tokenizer from Opus 4.7 on",
	openai: "OpenAI's tokenizer",
};

export function estimateTokens(
	characters: number,
	model: string | null,
): { charsPerToken: number; tokenizer: string; tokens: number } {
	const tokenizer = tokenizerOf(model);
	const charsPerToken = CHARS_PER_TOKEN[tokenizer];
	return {
		charsPerToken,
		tokenizer: TOKENIZER_LABELS[tokenizer],
		tokens: Math.round(characters / charsPerToken),
	};
}

export function formatWindowShare(share: number): string {
	const percent = share * 100;
	if (percent > 0 && percent < 0.1) return "<0.1%";
	return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}
