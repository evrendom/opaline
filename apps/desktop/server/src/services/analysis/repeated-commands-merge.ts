import { COMMAND_VARIANTS } from "./retro-measure-sql.js";

type Row = Record<string, unknown>;

const number = (value: unknown) => Number(value ?? 0) || 0;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown) => String(value ?? "");

type Top = [number, string];

interface Family {
	family: string;
	calls: number;
	failed: number;
	minutes: number;
	sessions: number;
	members: Set<string>;
	counts: Map<string, number>;
	texts: Map<string, { text: string; top: Top }>;
	ex: unknown[];
}

const higher = (left: Top, right: Top) =>
	right[0] > left[0] || (right[0] === left[0] && right[1] > left[1]);

const order = (left: string, right: string) =>
	left < right ? -1 : left > right ? 1 : 0;

export function mergeRepeatedCommands(pieces: Row[][], limit: number): Row[] {
	const families = new Map<string, Family>();
	for (const tuple of pieces
		.flat()
		.flatMap((piece) => list(piece.families).map(list))) {
		const [name, calls, failed, minutes, sessions, uids, counts, texts, ex] =
			tuple;
		const family = families.get(text(name)) ?? {
			family: text(name),
			calls: 0,
			failed: 0,
			minutes: 0,
			sessions: 0,
			members: new Set<string>(),
			counts: new Map<string, number>(),
			texts: new Map<string, { text: string; top: Top }>(),
			ex: [],
		};
		family.calls += number(calls);
		family.failed += number(failed);
		family.minutes += number(minutes);
		family.sessions += number(sessions);
		for (const member of list(uids)) family.members.add(text(member));
		for (const item of list(counts)) {
			const [fingerprint, n] = list(item);
			family.counts.set(
				text(fingerprint),
				(family.counts.get(text(fingerprint)) ?? 0) + number(n),
			);
		}
		for (const item of list(texts)) {
			const [, fingerprint, said, top, callId] = list(item);
			const candidate: Top = [number(top), text(callId)];
			const seen = family.texts.get(text(fingerprint));
			if (!seen || higher(seen.top, candidate))
				family.texts.set(text(fingerprint), {
					text: text(said),
					top: candidate,
				});
		}
		const slowest = list(ex);
		if (family.ex.length === 0 || number(slowest[0]) > number(family.ex[0]))
			family.ex = slowest;
		families.set(family.family, family);
	}
	const rounded = (value: number) => Math.round(value * 10) / 10;
	return [...families.values()]
		.filter((family) => family.calls >= 2)
		.sort(
			(left, right) =>
				right.calls - left.calls ||
				rounded(right.minutes) - rounded(left.minutes) ||
				order(left.family, right.family),
		)
		.slice(0, limit)
		.map((family) => ({
			family: family.family,
			calls: family.calls,
			failed: family.failed,
			group_call_time: rounded(family.minutes),
			sessions: family.sessions,
			members: family.members.size,
			variants: [...family.counts]
				.sort((left, right) => right[1] - left[1])
				.slice(0, COMMAND_VARIANTS)
				.map(
					([fingerprint, calls]) =>
						`${calls}× ${family.texts.get(fingerprint)?.text ?? "(text not kept)"}`,
				),
			example: family.ex[1] ?? "",
			session_id: family.ex[2] ?? "",
			agent_id: family.ex[3] ?? "",
			turn_idx: family.ex[4] ?? 0,
		}));
}
