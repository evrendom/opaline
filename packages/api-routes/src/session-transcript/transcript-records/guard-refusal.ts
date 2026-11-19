// Each repository's guards word their refusals in their own way, so only generic shapes are read.

export const GUARD_DENIAL_KIND = "guard";

const REASON_MAX_CHARS = 512;
const LINE_MAX_CHARS = 400;
const ESCAPE = String.fromCharCode(27);
const ANSI = new RegExp(`${ESCAPE}\\[[0-?]*[ -/]*[@-~]`, "gu");

const SEGMENT_HEADER =
	/^(?:exit code:?\s*-?\d+|process exited with code -?\d+|process running with session id.*|wall time:?.*|output:|chunk id:.*|original token count:.*|total output lines:.*|script (?:completed|failed|running.*)|script error:|-{2,}\s*(?:result\s*)?\d+\s*-{2,}|\$ .+|> .+)$/iu;

const STRONG = [
	/^(?:🛑\s*)?STOP[:!]\s*\S/u,
	/^\[?BLOCKED\]?(?:[:!\s]|$)/u,
	/^Blocked(?: by [^:\n]{1,80})?:\s*\S/u,
	/^(?:PreToolUse|PermissionRequest)(?::\S{1,200})? hook (?:blocking )?error\b/u,
	/^\S{1,80} operation blocked by hook\b/u,
];

const FIRST_LINE = [
	/^(?:error:\s*)?(?:\[?denied\]?|access denied by (?:policy|guard|hook|rule))(?:[:.!\s]|$)/iu,
	/\bnot allowed\b/iu,
];

const NOT_A_GUARD =
	/\bmethod not allowed\b|\b405\b|\berror TS\d+|^\s*[|│]|^\s*\d+\s*[|→:]|^\d{4}-\d{2}-\d{2}[T ]|\$\{\w+\}/iu;
const PROGRAM_PREFIX = /^(?!(?:error|denied):)[\w.@/-]{1,40}: /iu;
const ENVELOPE_TEXT_KEYS = new Set([
	"output",
	"stdout",
	"stderr",
	"aggregated_output",
	"formatted_output",
	"text",
	"message",
	"error",
]);

export function readGuardRefusal(
	segments: readonly string[],
): string | undefined {
	for (const segment of segments) {
		const found = refusalIn(segment);
		if (found !== undefined) return found;
	}
	return undefined;
}

function refusalIn(text: string, depth = 0): string | undefined {
	const whole = envelopeTexts(text, depth);
	if (whole !== undefined) return readNested(whole, depth);
	let segmentStart = true;
	for (const raw of text.split("\n")) {
		const line = raw.replace(ANSI, "").replace(/\r$/u, "").trim();
		if (line === "") continue;
		if (SEGMENT_HEADER.test(line)) {
			segmentStart = true;
			continue;
		}
		const nested = envelopeTexts(line, depth);
		if (nested !== undefined) {
			const found = readNested(nested, depth);
			if (found !== undefined) return found;
			segmentStart = true;
			continue;
		}
		if (line.length <= LINE_MAX_CHARS && !NOT_A_GUARD.test(line)) {
			if (STRONG.some((pattern) => pattern.test(line))) return reason(line);
			if (
				segmentStart &&
				!PROGRAM_PREFIX.test(line) &&
				FIRST_LINE.some((pattern) => pattern.test(line))
			)
				return reason(line);
		}
		segmentStart = false;
	}
	return undefined;
}

function readNested(
	texts: readonly string[],
	depth: number,
): string | undefined {
	for (const nested of texts) {
		const found = refusalIn(nested, depth + 1);
		if (found !== undefined) return found;
	}
	return undefined;
}

function envelopeTexts(text: string, depth: number): string[] | undefined {
	if (depth > 3) return undefined;
	const trimmed = text.trim();
	if (!/^[[{]/u.test(trimmed) || !/[\]}]$/u.test(trimmed)) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return undefined;
	}
	const texts: string[] = [];
	collectTexts(parsed, texts, 0);
	return texts;
}

function collectTexts(value: unknown, into: string[], depth: number): void {
	if (depth > 6 || value === null || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const item of value) collectTexts(item, into, depth + 1);
		return;
	}
	for (const [key, field] of Object.entries(value)) {
		if (typeof field === "string") {
			if (ENVELOPE_TEXT_KEYS.has(key)) into.push(field);
		} else collectTexts(field, into, depth + 1);
	}
}

function reason(line: string): string {
	const chars = Array.from(line);
	return chars.length <= REASON_MAX_CHARS
		? line
		: chars.slice(0, REASON_MAX_CHARS).join("");
}
