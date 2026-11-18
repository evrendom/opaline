import { type QueryClient, useQueryClient } from "@tanstack/react-query";
// biome-ignore lint/style/noRestrictedImports: installs a delegated listener on the scroller the trace mounts in, by its session.
import { useContext, useEffect } from "react";
import { readerScrollerOf } from "../reader-dom";
import {
	prefetchSubagentSteps,
	type ReaderSubagents,
	ReaderSubagentsContext,
} from "./use-reader-subagent-branches";

const INTENT_MS = 60;

type Installed = {
	context: ReaderSubagents;
	queryClient: QueryClient;
	users: number;
	remove: () => void;
};

const installed = new WeakMap<HTMLElement, Installed>();

function subagentOf(target: EventTarget | null): string | null {
	if (!(target instanceof Element)) return null;
	const chip = target.closest<HTMLElement>("[data-subagent-chip]");
	if (chip?.dataset.subagentChip) return chip.dataset.subagentChip;
	const line = target.closest("[data-rail-subagent]");
	return (
		line
			?.querySelector("[data-subagent-progress]")
			?.getAttribute("data-subagent-progress") ?? null
	);
}

function install(scroller: HTMLElement, entry: Omit<Installed, "remove">) {
	let timer: number | undefined;
	let pending: string | null = null;
	const over = (event: PointerEvent) => {
		const subagentId = subagentOf(event.target);
		if (subagentId === pending) return;
		window.clearTimeout(timer);
		pending = subagentId;
		if (!subagentId) return;
		timer = window.setTimeout(() => {
			const held = installed.get(scroller);
			if (held)
				prefetchSubagentSteps(held.queryClient, held.context, subagentId);
		}, INTENT_MS);
	};
	const leave = () => {
		window.clearTimeout(timer);
		pending = null;
	};
	scroller.addEventListener("pointerover", over, { passive: true });
	scroller.addEventListener("pointerleave", leave, { passive: true });
	installed.set(scroller, {
		...entry,
		remove: () => {
			window.clearTimeout(timer);
			scroller.removeEventListener("pointerover", over);
			scroller.removeEventListener("pointerleave", leave);
		},
	});
}

export function useSubagentHoverPrefetch(element: HTMLElement | null) {
	const context = useContext(ReaderSubagentsContext);
	const queryClient = useQueryClient();
	useEffect(() => {
		const scroller = readerScrollerOf(element);
		if (!scroller || !context) return;
		const held = installed.get(scroller);
		if (held) {
			held.users++;
			held.context = context;
			held.queryClient = queryClient;
		} else install(scroller, { context, queryClient, users: 1 });
		return () => {
			const entry = installed.get(scroller);
			if (!entry || --entry.users > 0) return;
			entry.remove();
			installed.delete(scroller);
		};
	}, [element, context, queryClient]);
}
