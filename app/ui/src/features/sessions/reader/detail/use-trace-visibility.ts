// biome-ignore lint/style/noRestrictedImports: subscribes the trace to a shared IntersectionObserver for the element it mounts.
import { useEffect, useState } from "react";
import { readerScrollerOf, turnElementOf } from "../reader-dom";

export type TraceVisibility = "far" | "near" | "visible";

const NEAR_MARGIN = "1200px 0px";

type Watcher = (entry: IntersectionObserverEntry) => void;
type Shared = {
	observer: IntersectionObserver;
	watchers: Map<Element, Set<Watcher>>;
};

const observers = new WeakMap<Element | Document, Map<string, Shared>>();

function watch(
	root: Element | null,
	margin: string,
	target: Element,
	watcher: Watcher,
): () => void {
	const key = root ?? document;
	let byMargin = observers.get(key);
	if (!byMargin) {
		byMargin = new Map();
		observers.set(key, byMargin);
	}
	let shared = byMargin.get(margin);
	if (!shared) {
		const watchers = new Map<Element, Set<Watcher>>();
		shared = {
			observer: new IntersectionObserver(
				(entries) => {
					for (const entry of entries)
						for (const each of watchers.get(entry.target) ?? []) each(entry);
				},
				{ root, rootMargin: margin },
			),
			watchers,
		};
		byMargin.set(margin, shared);
	}
	const { observer, watchers } = shared;
	let set = watchers.get(target);
	if (!set) {
		set = new Set();
		watchers.set(target, set);
		observer.observe(target);
	}
	set.add(watcher);
	return () => {
		set.delete(watcher);
		if (set.size > 0) return;
		watchers.delete(target);
		observer.unobserve(target);
	};
}

function targetOf(element: HTMLElement): Element {
	return turnElementOf(element) ?? element;
}

function rootOf(element: HTMLElement): Element | null {
	return readerScrollerOf(element);
}

export function useTraceVisibility(
	element: HTMLElement | null,
): TraceVisibility {
	const [near, setNear] = useState(false);
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		if (near || !element || typeof IntersectionObserver !== "function") return;
		return watch(rootOf(element), NEAR_MARGIN, targetOf(element), (entry) => {
			if (entry.isIntersecting) setNear(true);
		});
	}, [element, near]);
	useEffect(() => {
		if (visible || !element || typeof IntersectionObserver !== "function")
			return;
		return watch(rootOf(element), "0px", targetOf(element), (entry) => {
			if (entry.isIntersecting) setVisible(true);
		});
	}, [element, visible]);
	return visible ? "visible" : near ? "near" : "far";
}
