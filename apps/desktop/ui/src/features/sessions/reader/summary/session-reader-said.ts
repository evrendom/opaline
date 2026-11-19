import {
	scanMemberLanguageSignals,
	scanModelLanguageSignals,
} from "@rudel/language-signals";

export const CONTEXT_WORDS = 8;

export type Snippet = {
	cutEnd: boolean;
	cutStart: boolean;
	parts: { match: boolean; text: string }[];
};

const flatten = (text: string) => text.replace(/\s+/gu, " ").trim();

const wordCount = (text: string) =>
	text.split(" ").filter((word) => word.length > 0).length;

export function snippetsOf(text: string, words: readonly string[]): Snippet[] {
	const flat = flatten(text);
	const hits: { end: number; start: number }[] = [];
	for (const word of new Set(words.map(flatten))) {
		if (!word) continue;
		for (
			let at = flat.indexOf(word);
			at >= 0;
			at = flat.indexOf(word, at + word.length)
		)
			hits.push({ end: at + word.length, start: at });
	}
	hits.sort((a, b) => a.start - b.start || b.end - a.end);
	const kept = hits.filter(
		(hit, index) => index === 0 || hit.start >= (hits[index - 1]?.end ?? 0),
	);
	const groups: (typeof kept)[] = [];
	for (const hit of kept) {
		const group = groups.at(-1);
		const last = group?.at(-1);
		if (
			group &&
			last &&
			wordCount(flat.slice(last.end, hit.start)) <= 2 * CONTEXT_WORDS
		)
			group.push(hit);
		else groups.push([hit]);
	}
	return groups.map((group) => {
		const first = group[0] as (typeof group)[number];
		const last = group.at(-1) as (typeof group)[number];
		const lead = flat.slice(0, first.start).split(" ");
		const tail = flat.slice(last.end).split(" ");
		const parts: Snippet["parts"] = [
			{ match: false, text: lead.slice(-(CONTEXT_WORDS + 1)).join(" ") },
		];
		group.forEach((hit, index) => {
			parts.push({ match: true, text: flat.slice(hit.start, hit.end) });
			const next = group[index + 1];
			if (next)
				parts.push({ match: false, text: flat.slice(hit.end, next.start) });
		});
		parts.push({
			match: false,
			text: tail.slice(0, CONTEXT_WORDS + 1).join(" "),
		});
		return {
			cutEnd: tail.length > CONTEXT_WORDS + 1,
			cutStart: lead.length > CONTEXT_WORDS + 1,
			parts: parts.filter((part) => part.text.length > 0),
		};
	});
}

export function openingOf(text: string): Snippet {
	const words = flatten(text).split(" ");
	const kept = words.slice(0, 2 * CONTEXT_WORDS + 1);
	return {
		cutEnd: words.length > kept.length,
		cutStart: false,
		parts: [{ match: false, text: kept.join(" ") }],
	};
}

export const frustratedWords = (text: string) => [
	...new Set(
		scanMemberLanguageSignals(text)
			.filter(
				(signal) =>
					signal.category === "negative" || signal.category === "swear",
			)
			.map((signal) => signal.matchedText),
	),
];

export function frustratedSnippets(text: string): Snippet[] {
	const words = frustratedWords(text);
	return words.length > 0 ? snippetsOf(text, words) : [openingOf(text)];
}

export function apologySnippets(messages: readonly string[]): Snippet[] {
	return messages.flatMap((text) => {
		const words = scanModelLanguageSignals(text)
			.filter((signal) => signal.category === "apology")
			.map((signal) => signal.matchedText);
		return words.length > 0 ? snippetsOf(text, words) : [];
	});
}
