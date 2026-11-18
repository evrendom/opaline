import type { ComponentType } from "react";
import { getSessionDetailId } from "@/app/routes";
import { queryClient } from "@/lib/query-client";
import { sessionDetailInitialQueryOptions } from "./components/session-detail-fast-query";

export function prefetchSessionDetail(sessionId: string) {
	if (!sessionId) return;
	void queryClient.prefetchQuery(sessionDetailInitialQueryOptions(sessionId));
}

function readerSessionIdOf(path: string): string | null {
	return getSessionDetailId(path.split(/[?#]/u, 1)[0] ?? path);
}

type ReaderProps = Parameters<
	typeof import("./reader/SessionReaderView")["SessionReaderView"]
>[0];

let readerModule:
	| Promise<typeof import("./reader/SessionReaderView")>
	| undefined;
let loadedReader: ComponentType<ReaderProps> | null = null;

export function loadSessionReaderView() {
	readerModule ??= import("./reader/SessionReaderView").then(
		(module) => {
			loadedReader = module.SessionReaderView;
			return module;
		},
		(error: unknown) => {
			readerModule = undefined;
			throw error;
		},
	);
	return readerModule;
}

export function getLoadedSessionReaderView() {
	return loadedReader;
}

const ROW_INTENT_MS = 80;
let rowIntent: number | undefined;

export function intendSessionDetail(href: string) {
	window.clearTimeout(rowIntent);
	const sessionId = readerSessionIdOf(href);
	if (!sessionId) return;
	rowIntent = window.setTimeout(() => {
		prefetchSessionDetail(sessionId);
		void loadSessionReaderView().catch(() => undefined);
	}, ROW_INTENT_MS);
}

export function cancelSessionDetailIntent() {
	window.clearTimeout(rowIntent);
}

export function startSessionDetail(href: string) {
	window.clearTimeout(rowIntent);
	const sessionId = readerSessionIdOf(href);
	if (sessionId) prefetchSessionDetail(sessionId);
}
