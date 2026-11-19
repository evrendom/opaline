import {
	SESSION_DETAIL_STALE_REVISION_CODE,
	type SessionDetailWindow,
} from "@rudel/api-routes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionReaderBodies } from "./use-session-reader-bodies";

type Pending = {
	reject: (error: unknown) => void;
	resolve: (value: unknown) => void;
};

const fetched = vi.hoisted(() => ({
	turns: [] as (Pending & { bodyChunks: unknown; turnId: string })[],
	windows: [] as (Pending & { anchor: string })[],
}));

vi.mock("../../components/session-detail-fast-query", async (original) => ({
	...(await original<
		typeof import("../../components/session-detail-fast-query")
	>()),
	fetchSessionDetailTurn: (
		input: { turnId: string },
		_signal: AbortSignal,
		bodyChunks: unknown,
	) =>
		new Promise((resolve, reject) =>
			fetched.turns.push({ bodyChunks, reject, resolve, turnId: input.turnId }),
		),
	fetchSessionDetailWindow: (request: { anchorTurnId: string }) =>
		new Promise((resolve, reject) =>
			fetched.windows.push({ anchor: request.anchorTurnId, reject, resolve }),
		),
}));

const REVISION = "7";
const turns = Array.from({ length: 600 }, (_, index) => ({
	turnId: `turn-${index}`,
}));
const body = { responseItems: [], userItems: [] };
const bodyChunks = { sha256: "a".repeat(64), totalCodeUnits: 600_000 };

function windowOf(
	ids: readonly string[],
	oversized: Readonly<Record<string, typeof bodyChunks | undefined>> = {},
) {
	return {
		newerCursor: null,
		olderCursor: null,
		revision: REVISION,
		total: turns.length,
		turns: ids.map((turnId) =>
			turnId in oversized
				? {
						body: null,
						bodyOmitted: "oversized",
						turnId,
						...(oversized[turnId] ? { bodyChunks: oversized[turnId] } : {}),
					}
				: { body, bodyOmitted: null, turnId },
		),
	} as unknown as SessionDetailWindow;
}

function renderBodies(onStaleRevision = vi.fn()) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	const rendered = renderHook(
		() =>
			useSessionReaderBodies({
				initialWindow: undefined,
				onStaleRevision,
				revision: REVISION,
				sessionId: "session-1",
				turns,
			}),
		{ wrapper },
	);
	return { ...rendered, onStaleRevision };
}

beforeEach(() => {
	fetched.turns.length = 0;
	fetched.windows.length = 0;
});

describe("useSessionReaderBodies", () => {
	it("loads two far-apart windows at once and holds a turn the first will bring", async () => {
		const { result } = renderBodies();
		act(() => {
			result.current.requestBody("turn-10");
			result.current.requestBody("turn-12");
			result.current.requestBody("turn-500");
			result.current.requestBody("turn-300");
		});
		await waitFor(() =>
			expect(fetched.windows.map((each) => each.anchor)).toEqual([
				"turn-10",
				"turn-500",
			]),
		);
		await act(async () => {
			fetched.windows[0]?.resolve(windowOf(["turn-10", "turn-11", "turn-12"]));
		});
		await waitFor(() =>
			expect(result.current.getBody("turn-12").status).toBe("ready"),
		);
		await waitFor(() =>
			expect(fetched.windows.map((each) => each.anchor)).toEqual([
				"turn-10",
				"turn-500",
				"turn-300",
			]),
		);
	});

	it("asks for an oversized body with the chunk totals its window carried", async () => {
		const { result } = renderBodies();
		act(() => {
			result.current.requestBody("turn-10");
		});
		await waitFor(() => expect(fetched.windows).toHaveLength(1));
		await act(async () => {
			fetched.windows[0]?.resolve(
				windowOf(["turn-10", "turn-11"], {
					"turn-10": bodyChunks,
					"turn-11": undefined,
				}),
			);
		});
		await waitFor(() => expect(fetched.turns).toHaveLength(1));
		expect(fetched.turns[0]).toMatchObject({ bodyChunks, turnId: "turn-10" });
		act(() => {
			result.current.requestBody("turn-11");
		});
		await waitFor(() => expect(fetched.turns).toHaveLength(2));
		expect(fetched.turns[1]).toMatchObject({
			bodyChunks: undefined,
			turnId: "turn-11",
		});
		await act(async () => {
			fetched.turns[0]?.resolve({ ...body, revision: REVISION });
		});
		await waitFor(() =>
			expect(result.current.getBody("turn-10").status).toBe("ready"),
		);
	});

	it("hands a stale revision to the reader instead of failing the turn", async () => {
		const { onStaleRevision, result } = renderBodies();
		act(() => {
			result.current.requestBody("turn-10");
		});
		await waitFor(() => expect(fetched.windows).toHaveLength(1));
		const stale = { code: SESSION_DETAIL_STALE_REVISION_CODE };
		await act(async () => {
			fetched.windows[0]?.reject(stale);
		});
		await waitFor(() => expect(onStaleRevision).toHaveBeenCalledWith(stale));
		expect(result.current.getBody("turn-10").status).toBe("loading");
	});
});
