/**
 * Exit codes are only reported when the transcript transport recorded one, and
 * only from recognized transport framing, read structurally:
 *
 * - a JSON envelope (`{"metadata":{"exit_code":N},"output":"..."}` or
 *   `{"chunk_id":"...","exit_code":N,"output":"..."}`), or
 * - the metadata preamble Codex prepends to the output (`Chunk ID:`,
 *   `Wall time:`, `Process exited with code N`, `Exit code: N`, ... up to the
 *   first line that is not preamble or the `Output:` marker).
 *
 * Everything after the framing is application output. It is never scanned:
 * a test that prints `{"exit_code":1}` or `Process exited with code 1` must not
 * change the recorded result. A structured end event from the transcript still
 * outranks anything read here (see `readOutput` in `codex-records.ts`).
 */

const PROCESS_EXIT_PREAMBLE = /^Process exited with code\s+(-?\d+)\s*$/iu;
const EXIT_CODE_PREAMBLE = /^Exit code:?\s+(-?\d+)\s*$/iu;
const OUTPUT_MARKER = /^Output:\s*$/u;
const PREAMBLE_LINE =
	/^(?:Chunk ID:|Wall time:?|Process running with session ID|Original token count:|Script completed|Script failed|Script running)/iu;
const CLAUDE_EXIT_PREFIX_PATTERN = /^\s*Exit code:?\s+(-?\d+)/u;
const PREAMBLE_MAX_LINES = 8;

/**
 * Exit code recorded in a Codex tool output, or null when the transport
 * recorded none. `output` is the raw `output` payload: a string or the list of
 * text blocks. When the blocks hold several results (a script that ran several
 * commands) the first non-zero code wins, otherwise 0.
 */
export function readCodexExitCode(output: unknown): number | null {
	const codes: number[] = [];
	for (const text of readTransportTexts(output)) {
		const code = readEnvelopeExitCode(text) ?? readPreambleExitCode(text);
		if (code !== null) codes.push(code);
	}
	if (codes.length === 0) return null;
	return codes.find((code) => code !== 0) ?? 0;
}

/** Exit code in the first line of a Claude Code Bash error result. */
export function readClaudeExitCode(resultText: string): number | null {
	const match = CLAUDE_EXIT_PREFIX_PATTERN.exec(resultText.slice(0, 256));
	if (match?.[1] === undefined) return null;
	const value = Number(match[1]);
	return Number.isSafeInteger(value) ? value : null;
}

function readTransportTexts(output: unknown): string[] {
	if (typeof output === "string") return [output];
	if (!Array.isArray(output)) return [];
	return output.flatMap((block) => {
		if (typeof block === "string") return [block];
		if (
			typeof block === "object" &&
			block !== null &&
			"text" in block &&
			typeof block.text === "string"
		) {
			return [block.text];
		}
		return [];
	});
}

function readEnvelopeExitCode(text: string): number | null {
	const trimmed = text.trimStart();
	if (!trimmed.startsWith("{")) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	if ("metadata" in parsed) {
		const code = readCode(readField(parsed.metadata, "exit_code"));
		if (code !== null) return code;
	}
	// A bare `{"exit_code":N}` is indistinguishable from printed output; the
	// top-level form counts only with the exec envelope's sibling fields.
	const isExecEnvelope =
		"chunk_id" in parsed || "wall_time_seconds" in parsed || "output" in parsed;
	return isExecEnvelope ? readCode(readField(parsed, "exit_code")) : null;
}

function readPreambleExitCode(text: string): number | null {
	const lines = text.trimStart().split("\n", PREAMBLE_MAX_LINES + 1);
	for (const rawLine of lines.slice(0, PREAMBLE_MAX_LINES)) {
		const line = rawLine.replace(/\r$/u, "");
		if (OUTPUT_MARKER.test(line)) return null;
		const match =
			PROCESS_EXIT_PREAMBLE.exec(line) ?? EXIT_CODE_PREAMBLE.exec(line);
		if (match?.[1] !== undefined) return readCode(Number(match[1]));
		if (!PREAMBLE_LINE.test(line)) return null;
	}
	return null;
}

function readField(value: unknown, key: string): unknown {
	return typeof value === "object" && value !== null
		? Reflect.get(value, key)
		: undefined;
}

function readCode(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value)
		? value
		: null;
}
