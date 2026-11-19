export type Part = {
	kind: "member" | "agent" | "subagent" | "talk";
	top: number;
	height: number;
	id?: string;
	lane?: number;
	reply?: number;
	errors?: { height: number; offset: number }[];
	marks?: { height: number; offset: number; tag: string }[];
	frustrated?: boolean;
	apologized?: boolean;
	pending?: boolean;
};

export function withLanes(parts: Part[]): Part[] {
	const busyUntil: number[] = [];
	return parts.map((part) => {
		if (part.kind !== "subagent") return part;
		const free = busyUntil.findIndex((until) => until <= part.top);
		const lane = free < 0 ? busyUntil.length : free;
		busyUntil[lane] = part.top + part.height;
		return { ...part, lane };
	});
}

const FOCUS_ROOM = 0.15;
const FOCUS_ROOM_MIN_PX = 160;

export function focusedOn(
	parts: readonly Part[],
	id: string,
	height: number,
): { parts: Part[]; scale: number } | null {
	const own = parts.find((part) => part.kind === "subagent" && part.id === id);
	if (!own) return null;
	const room = Math.max(own.height * FOCUS_ROOM, FOCUS_ROOM_MIN_PX);
	const from = own.top - room;
	return {
		parts: parts.map((part) => ({ ...part, top: part.top - from })),
		scale: height / (own.height + 2 * room),
	};
}

export function laneCount(parts: readonly Part[]): number {
	return parts.reduce(
		(most, part) =>
			part.kind === "subagent" ? Math.max(most, (part.lane ?? 0) + 1) : most,
		0,
	);
}

const FIRST_SUBAGENT_X = 0.44;

const SUBAGENT_STEP = 0.1;

export function subagentX(lane: number, lanes: number): number {
	if (lanes <= 1) return LANE_X.subagent;
	return FIRST_SUBAGENT_X + lane * Math.min(SUBAGENT_STEP, 0.52 / (lanes - 1));
}

export const LANE_X: Record<Part["kind"], number> = {
	agent: 0.28,
	member: 0.12,
	subagent: 0.5,
	talk: 0.28,
};

export function mainLaneX(lanes: number): { agent: number; member: number } {
	return lanes > 0
		? { agent: LANE_X.agent, member: LANE_X.member }
		: { agent: 0.66, member: 0.34 };
}

const TALL_PX = 18;

const MERGE_PX = 4;

const MIN_ERROR_PX = 4;

type Node = {
	alert?: boolean;
	id?: string;
	kind: "agent" | "member" | "subagent";
	x: number;
	y: number;
};

export function minimapLine(
	parts: readonly Part[],
	scale: number,
	width: number,
): {
	branches: string;
	errors: string;
	marks: { d: string; tag: string }[];
	nodes: Node[];
	rail: string;
	subagents: {
		bottom: number;
		d: string;
		edges: string;
		id: string | undefined;
		top: number;
	}[];
	talks: { d: string; id: string; y: number }[];
} {
	const px = (value: number) => Math.round(value * 100) / 100;
	const lanes = laneCount(parts);
	const main = mainLaneX(lanes);
	const agent = px(main.agent * width);
	const rails = parts.filter(
		(part) => part.kind === "member" || part.kind === "agent",
	);
	const first = rails[0];
	const last = rails.at(-1);
	if (!first || !last)
		return {
			branches: "",
			errors: "",
			marks: [],
			nodes: [],
			rail: "",
			subagents: [],
			talks: [],
		};
	const railTop = px(first.top * scale);
	let branches = "";
	const subagents: ReturnType<typeof minimapLine>["subagents"] = [];
	const nodes: Node[] = [];
	const spans = new Map<string, { bottom: number; top: number; x: number }>();
	const placed = new Set<string>();
	const addNode = (node: Node) => {
		const key = `${node.kind}:${node.x}:${node.y}`;
		if (placed.has(key)) return;
		placed.add(key);
		nodes.push(node);
	};
	const lastNode = new Map<Part["kind"], number>();
	let errors = "";
	const marks = new Map<string, string>();
	for (const part of parts) {
		for (const mark of part.kind === "agent" ? (part.marks ?? []) : []) {
			const from = (part.top + mark.offset) * scale;
			const to = from + mark.height * scale;
			const grow = Math.max(MIN_ERROR_PX - (to - from), 0) / 2;
			marks.set(
				mark.tag,
				`${marks.get(mark.tag) ?? ""} M ${agent} ${px(from - grow)} V ${px(to + grow)}`,
			);
		}
		for (const failed of part.kind === "agent" ? (part.errors ?? []) : []) {
			const from = (part.top + failed.offset) * scale;
			const to = from + failed.height * scale;
			const grow = Math.max(MIN_ERROR_PX - (to - from), 0) / 2;
			errors += ` M ${agent} ${px(from - grow)} V ${px(to + grow)}`;
		}
		if (part.kind === "agent") {
			if (part.pending) continue;
			const start = px(part.top * scale);
			const end = px((part.reply ?? part.top + part.height) * scale);
			const alert = part.apologized ? { alert: true } : {};
			if (end - start < MERGE_PX) {
				if (part.apologized)
					addNode({ ...alert, kind: "agent", x: agent, y: end });
				continue;
			}
			addNode({ kind: "agent", x: agent, y: start });
			addNode({ ...alert, kind: "agent", x: agent, y: end });
			continue;
		}
		if (part.kind === "talk") continue;
		const subagent = part.kind === "subagent";
		const lane = px(
			(subagent ? subagentX(part.lane ?? 0, lanes) : main.member) * width,
		);
		const top = px(part.top * scale);
		const bottom = px((part.top + part.height) * scale);
		const previous = lastNode.get(part.kind);
		const near =
			!subagent && previous !== undefined && top - previous < MERGE_PX;
		if (near) {
			const shared = [...nodes]
				.reverse()
				.find((node) => node.kind === part.kind);
			if (part.frustrated && shared) shared.alert = true;
			continue;
		}
		lastNode.set(part.kind, top);
		const id = subagent && part.id ? { id: part.id } : {};
		addNode({
			...id,
			...(part.frustrated ? { alert: true } : {}),
			kind: part.kind,
			x: lane,
			y: top,
		});
		if (subagent) addNode({ ...id, kind: part.kind, x: lane, y: bottom });
		let path = ` M ${agent} ${top} H ${lane}`;
		let edges = path;
		if (subagent ? bottom > top : bottom - top >= TALL_PX) {
			path += ` V ${bottom} H ${agent}`;
			edges += ` M ${lane} ${bottom} H ${agent}`;
		}
		if (subagent && part.id) spans.set(part.id, { bottom, top, x: lane });
		if (subagent)
			subagents.push({
				bottom,
				d: path.trim(),
				edges: edges.trim(),
				id: part.id,
				top,
			});
		else branches += path;
	}
	const railEnd = px((last.top + last.height) * scale);
	const rail = railEnd > railTop ? `M ${agent} ${railTop} V ${railEnd}` : "";
	const talks: { d: string; id: string; y: number }[] = [];
	for (const part of parts) {
		const span = part.kind === "talk" && part.id ? spans.get(part.id) : null;
		if (!span || !part.id) continue;
		const y = px(part.top * scale);
		if (y > span.top + 0.5 && y < span.bottom - 0.5)
			talks.push({ d: `M ${agent} ${y} H ${span.x}`, id: part.id, y });
	}
	return {
		branches: branches.trim(),
		errors: errors.trim(),
		marks: [...marks].map(([tag, d]) => ({ d: d.trim(), tag })),
		nodes,
		rail,
		subagents,
		talks,
	};
}
