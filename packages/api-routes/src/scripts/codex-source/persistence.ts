import { groupEnd, type Token, tokenizeRust } from "./rust-source.js";

export type HistoryModes = "both" | "legacy" | "paginated" | "none";

export interface PersistenceDecision {
	readonly file: string;
	readonly line: number;
	readonly decision: string;
	readonly modes: HistoryModes;
}

export function rustFunction(tokens: readonly Token[], name: string): Token[] {
	const start = tokens.findIndex(
		(token, position) =>
			token.text === "fn" && tokens[position + 1]?.text === name,
	);
	if (start < 0) throw new Error(`Missing source function ${name}`);
	let opening = start + 2;
	while (opening < tokens.length && tokens[opening]?.text !== "{") {
		if (tokens[opening]?.text === "(") opening = groupEnd(tokens, opening);
		else opening++;
	}
	return tokens.slice(opening + 1, groupEnd(tokens, opening) - 1);
}

export function persistenceMatch(
	source: string,
	functionName: string,
	enumName: string,
): Map<string, PersistenceDecision> {
	const body = rustFunction(tokenizeRust(source), functionName);
	const match = body.findIndex((token) => token.text === "match");
	const opening = body.findIndex(
		(token, position) => position > match && token.text === "{",
	);
	if (match < 0 || opening < 0)
		throw new Error(`Missing persistence match in ${functionName}`);
	const decisions = new Map<string, PersistenceDecision>();
	const arms: Token[][] = [];
	const inner = body.slice(opening + 1, groupEnd(body, opening) - 1);
	let cursor = 0;
	while (cursor < inner.length) {
		if (inner[cursor]?.text === ",") {
			cursor++;
			continue;
		}
		const start = cursor;
		while (
			cursor < inner.length &&
			!(inner[cursor]?.text === "=" && inner[cursor + 1]?.text === ">")
		) {
			if (["{", "(", "["].includes(inner[cursor]?.text ?? ""))
				cursor = groupEnd(inner, cursor);
			else cursor++;
		}
		cursor += 2;
		if (inner[cursor]?.text === "{") cursor = groupEnd(inner, cursor);
		else
			while (cursor < inner.length && inner[cursor]?.text !== ",") {
				if (["{", "(", "["].includes(inner[cursor]?.text ?? ""))
					cursor = groupEnd(inner, cursor);
				else cursor++;
			}
		arms.push(inner.slice(start, cursor));
	}
	for (const arm of arms) {
		const arrow = arm.findIndex(
			(token, position) =>
				token.text === "=" && arm[position + 1]?.text === ">",
		);
		if (arrow < 0)
			throw new Error(`Unsupported persistence arm in ${functionName}`);
		const pattern = arm.slice(0, arrow);
		const expression = arm
			.slice(arrow + 2)
			.map((token) => token.text)
			.join(" ");
		let modes: HistoryModes;
		if (expression === "false" || expression === "None") modes = "none";
		else if (/ThreadHistoryMode :: Legacy/u.test(expression)) modes = "legacy";
		else if (/ThreadHistoryMode :: Paginated/u.test(expression))
			modes = "paginated";
		else if (expression === "true" || /^Some \(/u.test(expression))
			modes = "both";
		else if (
			[
				"persisted_item_completed_event",
				"should_persist_response_item",
				"persisted_event_msg",
			].some((delegate) => expression.includes(`${delegate} (`))
		)
			modes = "both";
		else
			throw new Error(
				`Unknown persistence expression in ${functionName}: ${expression}`,
			);
		for (let position = 0; position < pattern.length; position++) {
			if (
				pattern[position]?.text !== enumName ||
				pattern[position + 1]?.text !== "::"
			)
				continue;
			const name = pattern[position + 2]?.text;
			if (name !== undefined)
				decisions.set(name, {
					file: "codex-rs/rollout/src/policy.rs",
					line: pattern[position]?.line ?? 0,
					decision: expression,
					modes,
				});
		}
	}
	return decisions;
}

export function completedItemPolicy(
	source: string,
	variant: string,
): PersistenceDecision {
	const body = rustFunction(
		tokenizeRust(source),
		"persisted_item_completed_event",
	);
	const legacy = body.findIndex(
		(token, position) =>
			token.text === "ThreadHistoryMode" &&
			body[position + 2]?.text === "Legacy",
	);
	if (legacy < 0) throw new Error("Missing legacy ItemCompleted policy");
	const opening = body.findIndex(
		(token, position) => position > legacy && token.text === "{",
	);
	const legacyBody = body.slice(opening + 1, groupEnd(body, opening) - 1);
	const expression = legacyBody.map((token) => token.text).join(" ");
	const supported = new Set([
		"FunctionCallOutput",
		"Plan",
		"Extension",
		"SubAgentActivity",
	]);
	const names = legacyBody.flatMap((token, position) =>
		token.text === "TurnItem" && legacyBody[position + 1]?.text === "::"
			? [legacyBody[position + 2]?.text ?? ""]
			: [],
	);
	if (names.some((name) => !supported.has(name)))
		throw new Error(
			"New legacy ItemCompleted condition; review the source adapter",
		);
	if (
		!expression.includes("ExtensionItem :: Sleep") ||
		!expression.includes("SubAgentActivityKind :: Completed")
	)
		throw new Error("Changed conditional ItemCompleted policy");
	return {
		file: "codex-rs/rollout/src/policy.rs",
		line: body[legacy]?.line ?? 0,
		modes: supported.has(variant) ? "both" : "paginated",
		decision: supported.has(variant)
			? `Paginated: persisted (output truncation may apply). Legacy: ${expression}`
			: "Legacy: not persisted; Paginated: persisted (output truncation may apply).",
	};
}
