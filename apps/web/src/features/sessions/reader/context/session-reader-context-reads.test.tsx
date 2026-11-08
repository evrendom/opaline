import type {
	SessionDetailTurnSummary,
	SessionDetailWindow,
} from "@rudel/api-routes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import type { SessionReaderBody } from "../model/session-reader-model";
import { SummaryContext } from "./session-reader-context-card";
import { SessionContext } from "./session-reader-context-session";

const seen = vi.hoisted(() => ({
	maps: [] as object[],
	pending: new Map<string, (window: unknown) => void>(),
	tiles: [] as { map: object; problems: unknown }[],
}));

vi.mock("../../components/session-detail-fast-query", async (original) => ({
	...(await original<
		typeof import("../../components/session-detail-fast-query")
	>()),
	fetchSessionDetailWindow: (request: { anchorTurnId: string }) =>
		new Promise((resolve) => seen.pending.set(request.anchorTurnId, resolve)),
}));

vi.mock(
	"@rudel/api-routes/session-context/session-reader-context-runs",
	async (original) => {
		const actual =
			await original<
				typeof import("@rudel/api-routes/session-context/session-reader-context-runs")
			>();
		return {
			...actual,
			fullestCall: (turn: SessionDetailTurnSummary) =>
				turn.turnId === "t3"
					? { at: 0, model: null, share: 0.5, tokens: 50, window: 100 }
					: null,
			readRuns: vi.fn(actual.readRuns),
		};
	},
);

vi.mock("./session-reader-context-problems", async (original) => ({
	...(await original<typeof import("./session-reader-context-problems")>()),
	problemsByBox: vi.fn(() => new Map()),
}));

vi.mock(
	"@rudel/api-routes/session-context/session-reader-context-map",
	async (original) => ({
		...(await original<
			typeof import("@rudel/api-routes/session-context/session-reader-context-map")
		>()),
		getContextMap: vi.fn(() => {
			const map = { built: seen.maps.length + 1 };
			seen.maps.push(map);
			return map;
		}),
	}),
);

vi.mock("./session-reader-context-by-run", () => ({
	byRunMap: () => null,
	runsByPart: () => undefined,
}));

vi.mock("./session-reader-context-tiles", () => ({
	ContextTiles: (props: { map: object; problems: unknown }) => {
		seen.tiles.push({ map: props.map, problems: props.problems });
		return null;
	},
}));

vi.mock("./session-reader-context-bar", () => ({ ContextBar: () => null }));

vi.mock("../model/session-reader-model", async (original) => {
	const actual =
		await original<typeof import("../model/session-reader-model")>();
	const waterfalls = new WeakMap<object, { allSteps: []; steps: [] }>();
	return {
		...actual,
		getReaderWaterfall: (body: object) => {
			const held = waterfalls.get(body) ?? { allSteps: [], steps: [] };
			waterfalls.set(body, held);
			return held;
		},
	};
});

const FLAGS = new Map();
vi.mock("../rail/session-reader-run-flags", () => ({
	useRunFlags: () => FLAGS,
}));

const SETUP_RUNS = { data: undefined };
vi.mock("../../use-session-setup-runs", () => ({
	useSessionSetupRuns: () => SETUP_RUNS,
}));

const NO_BRANCHES = new Map();
vi.mock("../subagents/use-reader-subagent-branches", async (original) => ({
	...(await original<
		typeof import("../subagents/use-reader-subagent-branches")
	>()),
	useReaderSubagentBranches: () => NO_BRANCHES,
}));

const { readRuns } = await import("./session-reader-context-runs");
const { problemsByBox } = await import("./session-reader-context-problems");
const { getContextMap } = await import("./session-reader-context-map");

function turn(turnId: string, compactions = 0): SessionDetailTurnSummary {
	const summary: Partial<SessionDetailTurnSummary> = {
		compactions,
		errorCount: 0,
		estimatedCost: null,
		startedAt: null,
		turnId,
		usageCalls: [],
		userPreview: "",
	};
	return summary as SessionDetailTurnSummary;
}

const TURNS = [turn("t1"), turn("t2", 1), turn("t3")];

function body(): SessionReaderBody {
	return { responseItems: [], userItems: [] };
}

let sessionCount = 0;
let overview: NormalizedSessionDetailOverview;

beforeEach(() => {
	sessionCount += 1;
	const partial: Partial<NormalizedSessionDetailOverview> = {
		revision: "r1",
		session: {
			estimatedCost: null,
			modelUsed: null,
			sessionId: `session-${sessionCount}`,
		} as NormalizedSessionDetailOverview["session"],
		subagents: [],
	};
	overview = partial as NormalizedSessionDetailOverview;
	seen.maps.length = 0;
	seen.tiles.length = 0;
	seen.pending.clear();
	vi.mocked(readRuns).mockClear();
	vi.mocked(problemsByBox).mockClear();
	vi.mocked(getContextMap).mockClear();
});

afterEach(() => {
	vi.useRealTimers();
});

function withQueries(children: ReactNode, client: QueryClient) {
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function land(anchor: string, bodies: Record<string, SessionReaderBody>) {
	const resolve = seen.pending.get(anchor);
	expect(resolve, `a window asked for at ${anchor}`).toBeDefined();
	seen.pending.delete(anchor);
	const window: Partial<SessionDetailWindow> = {
		newerCursor: null,
		olderCursor: null,
		revision: "r1",
		total: TURNS.length,
		turns: Object.entries(bodies).map(
			([turnId, each]) =>
				({
					body: each,
					bodyOmitted: null,
					turnId,
				}) as SessionDetailWindow["turns"][number],
		),
	};
	await act(async () => {
		resolve?.(window);
		await new Promise((done) => setTimeout(done, 0));
	});
}

const distinct = (values: readonly unknown[]) => new Set(values).size;

describe("the session's context map", () => {
	it("reads each part once its bodies are in, and builds the map once", async () => {
		const client = new QueryClient();
		const props = {
			measure: "context" as const,
			overview,
			setup: [],
			turns: TURNS,
		};
		const view = render(withQueries(<SessionContext {...props} />, client));
		await land("t1", { t1: body(), t2: body() });
		expect(readRuns).toHaveBeenCalledTimes(1);
		expect(getContextMap).not.toHaveBeenCalled();

		await land("t3", { t1: body(), t2: body(), t3: body() });
		expect(readRuns).toHaveBeenCalledTimes(1);
		expect(problemsByBox).toHaveBeenCalledTimes(1);
		expect(getContextMap).toHaveBeenCalledTimes(1);

		view.rerender(withQueries(<SessionContext {...props} />, client));
		view.rerender(withQueries(<SessionContext {...props} />, client));
		expect(readRuns).toHaveBeenCalledTimes(1);
		expect(problemsByBox).toHaveBeenCalledTimes(1);
		expect(getContextMap).toHaveBeenCalledTimes(1);
		expect(seen.tiles.length).toBeGreaterThan(1);
		expect(distinct(seen.tiles.map((tile) => tile.map))).toBe(1);
		expect(distinct(seen.tiles.map((tile) => tile.problems))).toBe(1);
	});
});

describe("a run's context map", () => {
	it("reads its earlier and compacted runs once each, as they come in", async () => {
		const client = new QueryClient();
		const props = {
			agent: null,
			measure: "context" as const,
			overview,
			setup: [],
			turn: TURNS[2] as SessionDetailTurnSummary,
			turns: TURNS,
		};
		const view = render(withQueries(<SummaryContext {...props} />, client));
		await land("t3", { t3: body() });
		expect(readRuns).not.toHaveBeenCalled();
		expect(getContextMap).toHaveBeenCalledTimes(1);

		await land("t2", { t2: body() });
		expect(readRuns).toHaveBeenCalledTimes(1);
		expect(getContextMap).toHaveBeenCalledTimes(2);

		await land("t1", { t1: body(), t2: body() });
		expect(readRuns).toHaveBeenCalledTimes(2);
		expect(getContextMap).toHaveBeenCalledTimes(3);

		view.rerender(withQueries(<SummaryContext {...props} />, client));
		view.rerender(withQueries(<SummaryContext {...props} />, client));
		expect(readRuns).toHaveBeenCalledTimes(2);
		expect(getContextMap).toHaveBeenCalledTimes(3);
		expect(seen.tiles.at(-1)?.map).toBe(seen.maps[2]);
		expect(distinct(seen.tiles.map((tile) => tile.map))).toBe(3);
	});
});
