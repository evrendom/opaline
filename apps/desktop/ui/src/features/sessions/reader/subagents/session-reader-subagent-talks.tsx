import { getRawToolInput, parseTaskNotification } from "@rudel/api-routes";
import {
	createContext,
	type ReactNode,
	useContext,
	useLayoutEffect,
	useState,
	useSyncExternalStore,
} from "react";
import type { SessionReaderBodyState } from "../detail/use-session-reader-bodies";
import type { SessionReaderBody } from "../model/session-reader-model";

export type SubagentTalk = {
	atMs: number;
	direction: "from-main" | "to-main";
};

type SubagentTalksStore = {
	get: (subagentId: string) => readonly SubagentTalk[];
	set: (bodies: readonly SessionReaderBody[]) => void;
	subscribe: (listener: () => void) => () => void;
};

const NONE: readonly SubagentTalk[] = [];

const noSubscription = () => () => {};

const talksByBody = new WeakMap<
	SessionReaderBody,
	readonly (readonly [string, SubagentTalk])[]
>();

function talksOf(
	bodies: readonly SessionReaderBody[],
): Map<string, SubagentTalk[]> {
	const out = new Map<string, SubagentTalk[]>();
	for (const body of bodies)
		for (const [id, talk] of bodyTalks(body))
			out.set(id, [...(out.get(id) ?? []), talk]);
	for (const talks of out.values()) talks.sort((a, b) => a.atMs - b.atMs);
	return out;
}

function bodyTalks(
	body: SessionReaderBody,
): readonly (readonly [string, SubagentTalk])[] {
	const held = talksByBody.get(body);
	if (held) return held;
	const out: (readonly [string, SubagentTalk])[] = [];
	const add = (id: string, talk: SubagentTalk) => out.push([id, talk]);
	for (const item of body.responseItems) {
		if (item.kind === "system" && item.systemType === "notification") {
			const notice = parseTaskNotification(item.text);
			const atMs = Date.parse(item.timestamp);
			if (notice?.taskId && Number.isFinite(atMs))
				add(notice.taskId, { atMs, direction: "to-main" });
			continue;
		}
		if (item.kind !== "agent") continue;
		for (const event of item.events) {
			if (event.kind !== "tool" || event.toolName !== "SendMessage") continue;
			const to = getRawToolInput(event.input).to;
			const atMs = Date.parse(event.timestamp);
			if (typeof to === "string" && to && Number.isFinite(atMs))
				add(to, { atMs, direction: "from-main" });
		}
	}
	talksByBody.set(body, out);
	return out;
}

const sameTalks = (a: readonly SubagentTalk[], b: readonly SubagentTalk[]) =>
	a.length === b.length &&
	a.every(
		(talk, index) =>
			talk.atMs === b[index]?.atMs && talk.direction === b[index]?.direction,
	);

function createSubagentTalksStore(): SubagentTalksStore {
	let bodies: readonly SessionReaderBody[] = [];
	let talks = new Map<string, readonly SubagentTalk[]>();
	const listeners = new Set<() => void>();
	return {
		get: (subagentId) => talks.get(subagentId) ?? NONE,
		set: (next) => {
			if (
				next.length === bodies.length &&
				next.every((body, index) => body === bodies[index])
			)
				return;
			bodies = next;
			const read = talksOf(next);
			let changed = read.size !== talks.size;
			const kept = new Map<string, readonly SubagentTalk[]>();
			for (const [id, each] of read) {
				const last = talks.get(id);
				if (last && sameTalks(last, each)) kept.set(id, last);
				else {
					kept.set(id, each);
					changed = true;
				}
			}
			talks = kept;
			if (changed) for (const listener of listeners) listener();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

const SubagentTalksContext = createContext<SubagentTalksStore | null>(null);

export function SubagentTalks({
	children,
	getBody,
	turns,
}: {
	children: ReactNode;
	getBody: (turnId: string) => SessionReaderBodyState;
	turns: readonly { turnId: string }[];
}) {
	const [store] = useState(createSubagentTalksStore);
	const bodies = turns.flatMap((turn) => {
		const state = getBody(turn.turnId);
		return state.status === "ready" ? [state.body] : [];
	});
	useLayoutEffect(() => store.set(bodies));
	return (
		<SubagentTalksContext.Provider value={store}>
			{children}
		</SubagentTalksContext.Provider>
	);
}

export function useSubagentTalks(
	subagentId: string | null,
): readonly SubagentTalk[] {
	const store = useContext(SubagentTalksContext);
	const read = () => (store && subagentId ? store.get(subagentId) : NONE);
	return useSyncExternalStore(store?.subscribe ?? noSubscription, read, read);
}
