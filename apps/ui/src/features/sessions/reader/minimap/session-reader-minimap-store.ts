import type { AttemptShape } from "../detail/reader-layout";
import type { Part } from "./session-reader-minimap-line";
import type { TurnShape } from "./session-reader-minimap-measure";

type PackedAttempt = [
	height: number,
	rows: [
		id: string,
		startMs: string,
		top: number,
		height: number,
		failed: 0 | 1,
		tags?: string,
	][],
	subagents: [
		top: number,
		height: number,
		id: string | null,
		endMs: string | null,
		until: string | null,
	][],
	talks: [top: number, height: number, id: string][],
];

export type SessionMap = {
	pageHeight: number;
	parts: Part[];
	settled?: boolean;
	heights?: Record<string, number>;
	shapes?: Record<string, TurnShape>;
	attempts?: Record<string, PackedAttempt>;
	viewport?: number;
};

export type SessionMapKey = { revision: string; sessionId: string };

const PREFIX = "opaline:reader-map:";

const FORMAT = 3;

const storeKey = ({ revision, sessionId }: SessionMapKey) =>
	`${PREFIX}${FORMAT}:${sessionId}:${revision}`;

export function saveSessionMap(key: SessionMapKey, map: SessionMap) {
	const value = JSON.stringify({ ...map, viewport: window.innerWidth });
	try {
		sessionStorage.setItem(storeKey(key), value);
	} catch {
		try {
			for (const each of Object.keys(sessionStorage))
				if (each.startsWith(PREFIX)) sessionStorage.removeItem(each);
			sessionStorage.setItem(storeKey(key), value);
		} catch {}
	}
}

export function loadSessionMap(key: SessionMapKey): SessionMap | null {
	try {
		const stored = sessionStorage.getItem(storeKey(key));
		if (!stored) return null;
		const map = JSON.parse(stored) as SessionMap;
		if (map.viewport === window.innerWidth) return map;
		return { pageHeight: map.pageHeight, parts: map.parts };
	} catch {
		return null;
	}
}

const near = (value: number) => Math.round(value * 100) / 100;

export function keptOf(map: SessionMap | undefined): {
	shapes: Map<string, AttemptShape>;
	turns: string[];
} {
	return {
		shapes: unpackAttempts(map?.attempts),
		turns: Object.keys(map?.heights ?? {}),
	};
}

export function packAttempts(
	shapes: ReadonlyMap<string, AttemptShape>,
): Record<string, PackedAttempt> {
	const packed: Record<string, PackedAttempt> = {};
	for (const [id, shape] of shapes)
		packed[id] = [
			shape.height,
			shape.rows.map((row) => [
				row.id,
				row.startMs,
				near(row.top),
				near(row.height),
				row.failed ? 1 : 0,
				...(row.tags ? [row.tags] : []),
			]) as PackedAttempt[1],
			shape.subagents.map((each) => [
				near(each.top),
				near(each.height),
				each.id ?? null,
				each.endMs ?? null,
				each.until ?? null,
			]),
			shape.talks.map((talk) => [near(talk.top), near(talk.height), talk.id]),
		];
	return packed;
}

export function unpackAttempts(
	packed: Record<string, PackedAttempt> | undefined,
): Map<string, AttemptShape> {
	const shapes = new Map<string, AttemptShape>();
	for (const [id, [height, rows, subagents, talks]] of Object.entries(
		packed ?? {},
	))
		shapes.set(id, {
			height,
			rows: rows.map(([rowId, startMs, top, rowHeight, failed, tags]) => ({
				...(failed ? { failed: true } : {}),
				...(tags ? { tags } : {}),
				height: rowHeight,
				id: rowId,
				startMs,
				top,
			})),
			subagents: subagents.map(([top, subHeight, subId, endMs, until]) => ({
				endMs: endMs ?? undefined,
				height: subHeight,
				id: subId ?? undefined,
				top,
				until: until ?? undefined,
			})),
			talks: talks.map(([top, talkHeight, talkId]) => ({
				height: talkHeight,
				id: talkId,
				top,
			})),
		});
	return shapes;
}
