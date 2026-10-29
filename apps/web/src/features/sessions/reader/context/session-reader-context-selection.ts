import type { RunLit } from "./session-reader-context-run-tiles";

export type Selection = { lits: readonly RunLit[]; zoom: string | null };

export const EMPTY: Selection = { lits: [], zoom: null };

const notPart = (key: string) => key.startsWith("run:") || key === "free";

const isWhole = (lit: RunLit, key: string) =>
	lit.key === key && lit.thing === null;

export function isLit(
	lits: readonly RunLit[],
	key: string,
	thing: string | null,
): boolean {
	return lits.some(
		(lit) =>
			lit.key === key &&
			(lit.thing === thing || lit.thing === null) &&
			(thing !== null || lit.thing === null),
	);
}

export function clickBox(
	selection: Selection,
	key: string,
	more: boolean,
): Selection {
	const { lits, zoom } = selection;
	if (notPart(key)) {
		if (key === zoom) return more ? { lits, zoom: null } : EMPTY;
		return { lits: more ? lits : [], zoom: key };
	}
	const ofIt = lits.filter((lit) => lit.key === key);
	if (more) {
		if (ofIt.length > 0) {
			const rest = lits.filter((lit) => lit.key !== key);
			return { lits: rest, zoom: rest.at(-1)?.key ?? null };
		}
		return { lits: [...lits, { key, thing: null }], zoom: key };
	}
	if (zoom === key && lits.length === ofIt.length && ofIt.length > 0)
		return EMPTY;
	return { lits: [{ key, thing: null }], zoom: key };
}

export function clickThing(
	selection: Selection,
	key: string,
	thing: string,
	more: boolean,
): Selection {
	const { lits } = selection;
	const itself = lits.some((lit) => lit.key === key && lit.thing === thing);
	if (!more) {
		if (itself && lits.length === 1) return { lits: [], zoom: key };
		return { lits: [{ key, thing }], zoom: key };
	}
	if (itself || lits.some((lit) => isWhole(lit, key))) {
		const rest = lits.filter(
			(lit) =>
				!(lit.key === key && (lit.thing === thing || lit.thing === null)),
		);
		return { lits: rest, zoom: rest.at(-1)?.key ?? key };
	}
	return { lits: [...lits, { key, thing }], zoom: key };
}
