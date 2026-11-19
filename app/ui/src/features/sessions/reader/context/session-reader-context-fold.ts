import { kindWord } from "./session-reader-context-bar";
import { categoryOf, ownKey } from "./session-reader-context-groups";
import type {
	ContextItem,
	ContextKind,
	ContextPart,
} from "./session-reader-context-map";

export const isOther = (part: ContextPart) => part.key.startsWith("other:");

const partsWord = (part: ContextPart) =>
	part.key === "group:agent"
		? "subagents"
		: part.key === "group:commands"
			? "commands"
			: isOther(part) || part.key === "earlier" || part.key === "compacted"
				? "parts"
				: "tools";

export function tileCount(part: ContextPart): string | null {
	if (part.parts) return `${part.parts} ${partsWord(part)}`;
	if (part.files) return `${part.files} files`;
	return /^(?:(?:program|tools?):|mcp$|skills$)/u.test(ownKey(part.key)) &&
		part.count > 1
		? `${part.count}×`
		: null;
}

export function kindNote(part: ContextPart): string | null {
	const word = kindWord(part.kind);
	return part.parts || word === part.label ? null : word;
}

export function tileName(part: ContextPart) {
	const count = tileCount(part);
	if (!count) return part.label;
	return part.files
		? `${part.label} · ${part.files}`
		: `${part.label} · ${count}`;
}

function itemsOf(part: ContextPart): ContextItem[] {
	if (part.key.startsWith("group:") || isOther(part)) return part.items ?? [];
	return [
		part.files
			? { count: 1, label: tileName(part), tokens: part.tokens }
			: { count: part.count, label: part.label, tokens: part.tokens },
	];
}

const sum = (
	parts: readonly ContextPart[],
	of: (part: ContextPart) => number,
) => parts.reduce((total, part) => total + of(part), 0);

const beforeOf = (parts: readonly ContextPart[]) => {
	const before = parts[0]?.before;
	return before ? { before } : {};
};

const groupWord = (kind: ContextKind) =>
	kind === "agent" ? "Subagents" : kindWord(kind);

const foldGroup = (part: ContextPart) =>
	ownKey(part.key) === "mcp" || part.key === "group:mcp"
		? "mcp"
		: ownKey(part.key).startsWith("program:") || part.key === "group:commands"
			? "commands"
			: part.kind;

const foldedKeys = (group: readonly ContextPart[]) =>
	group.flatMap((part) => part.folded ?? [part.key]);

function takeFolded(kept: ContextPart[], key: string): ContextPart[] {
	const at = kept.findIndex((part) => part.key === key);
	return at < 0 ? [] : kept.splice(at, 1);
}

export function foldByKind(
	parts: readonly ContextPart[],
	count: number,
): ContextPart[] {
	const sorted = [...parts].sort((a, b) => b.tokens - a.tokens);
	const kept = sorted.slice(0, Math.max(0, sorted.length - count));
	const byGroup = new Map<string, ContextPart[]>();
	for (const part of sorted.slice(kept.length))
		byGroup.set(foldGroup(part), [
			...(byGroup.get(foldGroup(part)) ?? []),
			part,
		]);
	const folded = [...byGroup].flatMap(([key, small]): ContextPart[] => {
		const group = [...takeFolded(kept, `group:${key}`), ...small];
		const kind = key === "commands" ? "shell" : (group[0]?.kind ?? "tools");
		return group.length === 1
			? group
			: [
					{
						...beforeOf(group),
						count: sum(group, (part) => part.count),
						items: group.flatMap(itemsOf),
						key: `group:${key}`,
						kind,
						label: key === "commands" ? "Commands" : groupWord(kind),
						parts: group.flatMap(itemsOf).length,
						folded: foldedKeys(group),
						tokens: sum(group, (part) => part.tokens),
					},
				];
	});
	return [...kept, ...folded];
}

export function foldAll(
	parts: readonly ContextPart[],
	count: number,
): ContextPart[] {
	const sorted = [...parts].sort((a, b) => b.tokens - a.tokens);
	const kept = sorted.slice(0, Math.max(0, sorted.length - count));
	const byCategory = new Map<string, ContextPart[]>();
	for (const part of sorted.slice(kept.length)) {
		const { key } = categoryOf(part.kind);
		byCategory.set(key, [...(byCategory.get(key) ?? []), part]);
	}
	const folded = [...byCategory].flatMap(([key, small]): ContextPart[] => {
		const group = [...takeFolded(kept, `other:${key}`), ...small];
		if (group.length === 1) return group;
		const items = group.flatMap(itemsOf);
		return [
			{
				...beforeOf(group),
				count: sum(group, (part) => part.count),
				items,
				key: `other:${key}`,
				kind: group[0]?.kind ?? "tools",
				label: key === "results" ? "Other tools" : "Other",
				parts: items.length,
				folded: foldedKeys(group),
				tokens: sum(group, (part) => part.tokens),
			},
		];
	});
	return [...kept, ...folded];
}

export function foldSmallest(parts: readonly ContextPart[]): ContextPart[] {
	if (parts.length < 2) return [...parts];
	const sorted = [...parts].sort((a, b) => b.tokens - a.tokens);
	const kept = sorted.slice(0, -2);
	const group = [...takeFolded(kept, "other:all"), ...sorted.slice(-2)].sort(
		(a, b) => b.tokens - a.tokens,
	);
	const items = group.flatMap(itemsOf);
	return [
		...kept,
		{
			...beforeOf(group),
			count: sum(group, (part) => part.count),
			items,
			key: "other:all",
			kind: group[0]?.kind ?? "tools",
			label: "Other",
			parts: items.length,
			folded: foldedKeys(group),
			tokens: sum(group, (part) => part.tokens),
		},
	];
}
